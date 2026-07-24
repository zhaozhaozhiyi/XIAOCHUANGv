"""End-to-end source-profile regression for the sealed Xiaochuang runtime.

This uses a real AIAgent loop and real local Xiaochuang tool bridge. The two
HTTP endpoints are test doubles only for the external Backend surfaces:
the Model Gateway returns a source-allowed function call, and the MCP endpoint
returns its JSON-RPC result. This verifies that the managed run cannot bypass
the service identities, per-run capability binding, or source tool profile.
"""

import asyncio
import base64
import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import PlatformConfig
from gateway.platforms.api_server import (
    APIServerAdapter,
    cors_middleware,
    security_headers_middleware,
)


API_PREFIX = "/api/v1"
MODEL_GATEWAY_PATH = "/internal/agent-runtime/model-gateway/v1"
MCP_PATH = "/internal/agent-runtime/xiaochuang-drama/mcp"
MODEL_GATEWAY_ROUTE = f"{API_PREFIX}{MODEL_GATEWAY_PATH}"
MCP_ROUTE = f"{API_PREFIX}{MCP_PATH}"
SOURCE_TOOLS = {
    "get_task_context",
    "list_source_chunks",
    "get_source_chunk",
    "submit_source_chunk_analysis",
    "submit_source_analysis",
    "report_progress",
    "complete_execution",
    "fail_execution",
}


def _create_runs_app(adapter: APIServerAdapter) -> web.Application:
    middlewares = [
        middleware
        for middleware in (cors_middleware, security_headers_middleware)
        if middleware is not None
    ]
    app = web.Application(middlewares=middlewares)
    app["api_server_adapter"] = adapter
    app.router.add_post("/v1/runs", adapter._handle_runs)
    app.router.add_get("/v1/runs/{run_id}", adapter._handle_get_run)
    return app


def _write_skill(root: Path, ref: str, content: str) -> dict[str, str]:
    skill_id = ref.split("@", 1)[0]
    target = root.joinpath(*skill_id.split("/"), "SKILL.md")
    target.parent.mkdir(parents=True, exist_ok=True)
    raw = content.encode("utf-8")
    target.write_bytes(raw)
    return {
        "ref": ref,
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def _manifest_header(entries: list[dict[str, str]]) -> str:
    raw = json.dumps(entries, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _headers(base_url: str, manifest: str) -> dict[str, str]:
    return {
        "X-Xiaochuang-Capability": "capability-secret",
        "X-Xiaochuang-MCP-Capability-Header": "X-Xiaochuang-Capability",
        "X-Xiaochuang-Backend-Base-Url": base_url,
        "X-Xiaochuang-Execution-Id": "123",
        "X-Xiaochuang-Tool-Profile": "xiaochuang-drama-source",
        "X-Xiaochuang-Skill-Manifest": manifest,
    }


async def _write_stream(
    request: web.Request, chunks: list[dict[str, Any]]
) -> web.StreamResponse:
    response = web.StreamResponse(
        status=200,
        headers={"Content-Type": "text/event-stream"},
    )
    await response.prepare(request)
    for chunk in chunks:
        await response.write(
            f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n".encode(
                "utf-8"
            )
        )
    await response.write(b"data: [DONE]\n\n")
    await response.write_eof()
    return response


async def _wait_for_terminal(client: TestClient, run_id: str) -> dict[str, Any]:
    for _ in range(100):
        response = await client.get(f"/v1/runs/{run_id}")
        body = await response.json()
        if body["status"] in {"completed", "failed", "cancelled"}:
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"Run {run_id} did not reach a terminal status")


@pytest.mark.asyncio
async def test_source_profile_real_agent_loop_uses_only_model_gateway_and_mcp(
    monkeypatch, tmp_path
):
    """Run a source Agent through fake Gateway/MCP endpoints without mocks."""
    model_requests: list[dict[str, Any]] = []
    mcp_requests: list[dict[str, Any]] = []
    unexpected_gateway_requests: list[str] = []

    async def model_gateway(request: web.Request) -> web.StreamResponse:
        payload = await request.json()
        headers = {key.lower(): value for key, value in request.headers.items()}
        model_requests.append({"headers": headers, "payload": payload})

        assert headers["authorization"] == "Bearer model-gateway-service-key"
        assert headers["x-xiaochuang-capability"] == "capability-secret"
        assert headers["x-xiaochuang-execution-id"] == "123"
        assert "provider-user-key" not in json.dumps(
            {"headers": headers, "payload": payload}
        )
        assert payload["model"] == "xiaochuang-managed"
        assert payload["stream"] is True
        assert {
            tool["function"]["name"]
            for tool in payload.get("tools", [])
            if isinstance(tool, dict) and isinstance(tool.get("function"), dict)
        } == SOURCE_TOOLS

        if len(model_requests) == 1:
            return await _write_stream(
                request,
                [
                    {
                        "id": "chatcmpl-source-tool",
                        "object": "chat.completion.chunk",
                        "created": 0,
                        "model": "xiaochuang-managed",
                        "choices": [
                            {
                                "index": 0,
                                "delta": {
                                    "role": "assistant",
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "call_source_context",
                                            "type": "function",
                                            "function": {
                                                "name": "get_task_context",
                                                "arguments": "{}",
                                            },
                                        }
                                    ],
                                },
                                "finish_reason": None,
                            }
                        ],
                    },
                    {
                        "id": "chatcmpl-source-tool",
                        "object": "chat.completion.chunk",
                        "created": 0,
                        "model": "xiaochuang-managed",
                        "choices": [
                            {
                                "index": 0,
                                "delta": {},
                                "finish_reason": "tool_calls",
                            }
                        ],
                    },
                ],
            )

        assert any(
            message.get("role") == "tool"
            and "source_task_context" in str(message.get("content"))
            for message in payload["messages"]
            if isinstance(message, dict)
        )
        return await _write_stream(
            request,
            [
                {
                    "id": "chatcmpl-source-final",
                    "object": "chat.completion.chunk",
                    "created": 0,
                    "model": "xiaochuang-managed",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {
                                "role": "assistant",
                                "content": "Source task context received.",
                            },
                            "finish_reason": None,
                        }
                    ],
                },
                {
                    "id": "chatcmpl-source-final",
                    "object": "chat.completion.chunk",
                    "created": 0,
                    "model": "xiaochuang-managed",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop",
                        }
                    ],
                },
            ],
        )

    async def mcp(request: web.Request) -> web.Response:
        payload = await request.json()
        headers = {key.lower(): value for key, value in request.headers.items()}
        mcp_requests.append({"headers": headers, "payload": payload})

        assert headers["x-xiaochuang-mcp-service-key"] == "mcp-service-key"
        assert headers["x-xiaochuang-capability"] == "capability-secret"
        assert headers["mcp-protocol-version"] == "2025-03-26"
        assert payload["method"] == "tools/call"
        assert payload["params"] == {
            "name": "get_task_context",
            "arguments": {},
        }
        return web.json_response(
            {
                "jsonrpc": "2.0",
                "id": payload["id"],
                "result": {
                    "structuredContent": {
                        "phase": "source",
                        "source_task_context": True,
                    },
                    "content": [
                        {
                            "type": "text",
                            "text": '{"phase":"source","source_task_context":true}',
                        }
                    ],
                },
            }
        )

    async def unexpected_gateway_request(request: web.Request) -> web.Response:
        unexpected_gateway_requests.append(
            f"{request.method} {request.path_qs}"
        )
        return web.json_response({"error": "unexpected gateway request"}, status=404)

    upstream = web.Application()
    upstream.router.add_post(
        f"{MODEL_GATEWAY_ROUTE}/chat/completions", model_gateway
    )
    upstream.router.add_post(MCP_ROUTE, mcp)
    upstream.router.add_route("*", "/{tail:.*}", unexpected_gateway_request)
    skills_root = tmp_path / "skills"
    manifest = _manifest_header(
        [
            _write_skill(
                skills_root,
                "xiaochuang_runtime_policy@1.0.0",
                "---\nname: xiaochuang_runtime_policy\n---\nUse MCP only.",
            ),
            _write_skill(
                skills_root,
                "drama_source_understanding@1.0.0",
                "---\nname: drama_source_understanding\n---\nRead source context.",
            ),
        ]
    )
    monkeypatch.setenv("XIAOCHUANG_MCP_SERVICE_KEY", "mcp-service-key")
    monkeypatch.setenv("XIAOCHUANG_SKILLS_ROOT", str(skills_root))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes-home"))
    monkeypatch.setenv("HERMES_API_TIMEOUT", "5")
    monkeypatch.setenv("HERMES_STREAM_READ_TIMEOUT", "5")

    adapter = APIServerAdapter(PlatformConfig(enabled=True))
    monkeypatch.setattr(adapter, "_ensure_session_db", lambda: None)
    monkeypatch.setattr(
        "gateway.run._resolve_gateway_model", lambda: "xiaochuang-managed"
    )
    monkeypatch.setattr(
        "gateway.run._load_gateway_config",
        lambda: {"platform_toolsets": {"api_server": ["xiaochuang-drama"]}},
    )
    monkeypatch.setattr(
        "gateway.run.GatewayRunner._load_reasoning_config",
        staticmethod(lambda: {}),
    )
    monkeypatch.setattr(
        "gateway.run.GatewayRunner._load_fallback_model",
        staticmethod(lambda: []),
    )

    async with TestServer(upstream) as upstream_server:
        backend_base_url = (
            str(upstream_server.make_url("/")).rstrip("/") + API_PREFIX
        )
        model_gateway_url = f"{backend_base_url}{MODEL_GATEWAY_PATH}"
        runtime = {
            "provider": "custom",
            "base_url": model_gateway_url,
            "api_key": "model-gateway-service-key",
            "api_mode": "chat_completions",
            "command": None,
            "args": [],
            "credential_pool": None,
        }
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as client:
            with patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama"},
            ), patch(
                "gateway.platforms.api_server._xiaochuang_runtime_agent_kwargs",
                return_value=runtime,
            ):
                response = await client.post(
                    "/v1/runs",
                    json={
                        "input": "Begin the current source-understanding task.",
                        "instructions": "Stay in the source phase.",
                    },
                    headers=_headers(backend_base_url, manifest),
                )
                assert response.status == 202
                run_id = (await response.json())["run_id"]
                status = await _wait_for_terminal(client, run_id)

    assert status["status"] == "completed"
    assert status["output"] == "Source task context received."
    assert len(model_requests) == 2
    assert len(mcp_requests) == 1
    assert unexpected_gateway_requests == []
    assert "capability-secret" not in json.dumps(model_requests[0]["payload"])
    assert "mcp-service-key" not in json.dumps(model_requests[0]["payload"])

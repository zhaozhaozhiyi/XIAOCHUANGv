"""Tests for /v1/runs endpoints: start, status, events, and stop.

Covers:
- POST /v1/runs — start a run (202)
- GET /v1/runs/{run_id} — poll run status
- GET /v1/runs/{run_id}/events — SSE event stream
- POST /v1/runs/{run_id}/stop — interrupt a running agent
- Auth, error handling, and cleanup
"""

import asyncio
import base64
import hashlib
import json
import threading
from unittest.mock import MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import PlatformConfig
from gateway.platforms.api_server import (
    APIServerAdapter,
    cors_middleware,
    security_headers_middleware,
)
from gateway.xiaochuang_runtime_context import (
    clear_xiaochuang_runtime_context,
    get_xiaochuang_runtime_context,
)

MODEL_GATEWAY_URL = (
    "http://backend.internal:3010/api/v1/internal/agent-runtime/model-gateway/v1"
)
SKILL_REF = "drama_adaptation_copilot@1.0.0"
SKILL_CONTENT = "---\nname: drama_adaptation_copilot\n---\nPinned skill body"
SKILL_SHA256 = hashlib.sha256(SKILL_CONTENT.encode("utf-8")).hexdigest()
SKILL_MANIFEST_HEADER = base64.urlsafe_b64encode(
    json.dumps(
        [{"ref": SKILL_REF, "sha256": SKILL_SHA256}],
        separators=(",", ":"),
    ).encode("utf-8")
).decode("ascii").rstrip("=")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_adapter(api_key: str = "") -> APIServerAdapter:
    """Create an adapter with optional API key."""
    extra = {}
    if api_key:
        extra["key"] = api_key
    config = PlatformConfig(enabled=True, extra=extra)
    adapter = APIServerAdapter(config)
    return adapter


def _xiaochuang_gateway_runtime():
    return {
        "provider": "openai",
        "base_url": MODEL_GATEWAY_URL,
        "api_key": "model-gateway-service-key",
        "api_mode": "chat_completions",
        "command": None,
        "args": [],
        "credential_pool": None,
    }


def _xiaochuang_headers(
    *,
    tool_profile: str = "xiaochuang-drama-source",
    capability: str = "capability-secret",
) -> dict[str, str]:
    return {
        "X-Xiaochuang-Capability": capability,
        "X-Xiaochuang-MCP-Capability-Header": "X-Xiaochuang-Capability",
        "X-Xiaochuang-Backend-Base-Url": "http://backend.internal:3010/api/v1",
        "X-Xiaochuang-Execution-Id": "123",
        "X-Xiaochuang-Tool-Profile": tool_profile,
        "X-Xiaochuang-Skill-Manifest": SKILL_MANIFEST_HEADER,
    }


def _create_runs_app(adapter: APIServerAdapter) -> web.Application:
    """Create an aiohttp app with /v1/runs routes registered."""
    mws = [mw for mw in (cors_middleware, security_headers_middleware) if mw is not None]
    app = web.Application(middlewares=mws)
    app["api_server_adapter"] = adapter
    app.router.add_post("/v1/runs", adapter._handle_runs)
    app.router.add_get("/v1/runs/{run_id}", adapter._handle_get_run)
    app.router.add_get("/v1/runs/{run_id}/events", adapter._handle_run_events)
    app.router.add_post("/v1/runs/{run_id}/approval", adapter._handle_run_approval)
    app.router.add_post("/v1/runs/{run_id}/stop", adapter._handle_stop_run)
    return app


def _make_slow_agent(**kwargs):
    """Create a mock agent that blocks in run_conversation until interrupted.

    Returns (mock_agent, agent_ready_event, interrupt_event) where
    agent_ready_event is set once run_conversation starts, and
    interrupt_event is set when interrupt() is called.
    """
    ready = threading.Event()
    interrupted = threading.Event()

    mock_agent = MagicMock()

    def _do_interrupt(message=None):
        interrupted.set()

    mock_agent.interrupt = MagicMock(side_effect=_do_interrupt)

    def _slow_run(user_message=None, conversation_history=None, task_id=None):
        ready.set()
        # Block until interrupt() is called
        interrupted.wait(timeout=10)
        return {"final_response": "interrupted"}

    mock_agent.run_conversation.side_effect = _slow_run
    mock_agent.session_prompt_tokens = 0
    mock_agent.session_completion_tokens = 0
    mock_agent.session_total_tokens = 0

    return mock_agent, ready, interrupted


@pytest.fixture
def adapter():
    return _make_adapter()


@pytest.fixture
def auth_adapter():
    return _make_adapter(api_key="sk-secret")


# ---------------------------------------------------------------------------
# POST /v1/runs — start a run
# ---------------------------------------------------------------------------


class TestStartRun:
    @pytest.mark.asyncio
    async def test_start_returns_202(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create, patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama"},
            ):
                mock_agent = MagicMock()
                mock_agent.run_conversation.return_value = {"final_response": "done"}
                mock_agent.session_prompt_tokens = 10
                mock_agent.session_completion_tokens = 5
                mock_agent.session_total_tokens = 15
                mock_create.return_value = mock_agent

                resp = await cli.post("/v1/runs", json={"input": "hello"})
                assert resp.status == 202
                data = await resp.json()
                assert data["status"] == "started"
                assert data["run_id"].startswith("run_")

                status_resp = await cli.get(f"/v1/runs/{data['run_id']}")
                assert status_resp.status == 200
                status = await status_resp.json()
                assert status["run_id"] == data["run_id"]
                assert status["status"] in {"queued", "running", "completed"}
                assert status["object"] == "hermes.run"

    @pytest.mark.asyncio
    async def test_start_invalid_json_returns_400(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/v1/runs",
                data="not json",
                headers={"Content-Type": "application/json"},
            )
        assert resp.status == 400

    @pytest.mark.asyncio
    async def test_start_missing_input_returns_400(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/v1/runs", json={"model": "test"})
            assert resp.status == 400
            data = await resp.json()
            assert "input" in data["error"]["message"]

    @pytest.mark.asyncio
    async def test_start_empty_input_returns_400(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/v1/runs", json={"input": ""})
        assert resp.status == 400

    @pytest.mark.asyncio
    async def test_start_invalid_history_does_not_allocate_run(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/v1/runs",
                json={"input": "hello", "conversation_history": {"role": "user"}},
            )
        assert resp.status == 400
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_requires_auth(self, auth_adapter):
        app = _create_runs_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/v1/runs", json={"input": "hello"})
        assert resp.status == 401

    @pytest.mark.asyncio
    async def test_start_with_valid_auth(self, auth_adapter):
        app = _create_runs_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_create_agent") as mock_create:
                mock_agent = MagicMock()
                mock_agent.run_conversation.return_value = {"final_response": "ok"}
                mock_agent.session_prompt_tokens = 0
                mock_agent.session_completion_tokens = 0
                mock_agent.session_total_tokens = 0
                mock_create.return_value = mock_agent

                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "hello"},
                    headers={"Authorization": "Bearer sk-secret"},
                )
                assert resp.status == 202

    @pytest.mark.asyncio
    async def test_start_rejects_xiaochuang_run_when_toolsets_are_not_restricted(self, adapter):
        """Managed Xiaochuang runs must not see file/terminal/browser toolsets."""
        app = _create_runs_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create, patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama", "file"},
            ):
                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers=_xiaochuang_headers(),
                )
                data = await resp.json()

        assert resp.status == 409
        assert data["error"]["code"] == "xiaochuang_toolset_not_restricted"
        assert "file" in data["error"]["message"]
        mock_create.assert_not_called()
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_rejects_incomplete_xiaochuang_runtime_headers(self, adapter):
        app = _create_runs_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers={
                        "X-Xiaochuang-Backend-Base-Url": "http://backend.internal:3010/api/v1",
                        "X-Xiaochuang-Execution-Id": "123",
                    },
                )
                data = await resp.json()

        assert resp.status == 400
        assert data["error"]["code"] == "invalid_xiaochuang_runtime"
        assert "capability_token" in data["error"]["message"]
        assert "tool_profile" in data["error"]["message"]
        mock_create.assert_not_called()
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_rejects_unknown_xiaochuang_tool_profile(self, adapter):
        app = _create_runs_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers=_xiaochuang_headers(
                        tool_profile="xiaochuang-drama-unknown"
                    ),
                )
                data = await resp.json()

        assert resp.status == 400
        assert data["error"]["code"] == "invalid_xiaochuang_runtime"
        assert "tool profile" in data["error"]["message"]
        mock_create.assert_not_called()
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_rejects_a_run_routed_to_the_wrong_profile_container(
        self, adapter, monkeypatch
    ):
        app = _create_runs_app(adapter)
        monkeypatch.setenv("XIAOCHUANG_TOOL_PROFILE", "xiaochuang-drama-plan")

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers=_xiaochuang_headers(
                        tool_profile="xiaochuang-drama-source"
                    ),
                )
                data = await resp.json()

        assert resp.status == 409
        assert data["error"]["code"] == "xiaochuang_tool_profile_mismatch"
        mock_create.assert_not_called()
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_rejects_xiaochuang_run_without_model_gateway(self, adapter):
        """Managed Xiaochuang runs must not call a local/provider model directly."""
        app = _create_runs_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create, patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama"},
            ), patch(
                "gateway.platforms.api_server._xiaochuang_runtime_agent_kwargs",
                return_value={
                    "provider": "openai",
                    "base_url": "https://api.openai.com/v1",
                    "api_key": "provider-key-that-must-not-be-used",
                    "api_mode": "chat_completions",
                },
            ):
                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers=_xiaochuang_headers(),
                )
                data = await resp.json()

        assert resp.status == 409
        assert data["error"]["code"] == "xiaochuang_model_gateway_not_configured"
        assert "Model Gateway" in data["error"]["message"]
        mock_create.assert_not_called()
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_rejects_xiaochuang_run_without_gateway_service_identity(self, adapter):
        app = _create_runs_app(adapter)
        runtime = _xiaochuang_gateway_runtime()
        runtime["api_key"] = ""

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create, patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama"},
            ), patch(
                "gateway.platforms.api_server._xiaochuang_runtime_agent_kwargs",
                return_value=runtime,
            ):
                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers=_xiaochuang_headers(),
                )
                data = await resp.json()

        assert resp.status == 409
        assert data["error"]["code"] == "xiaochuang_model_gateway_not_configured"
        assert "service identity" in data["error"]["message"]
        mock_create.assert_not_called()
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_hides_xiaochuang_model_gateway_runtime_errors(self, adapter):
        """Runtime configuration failures must not expose Provider secrets."""
        app = _create_runs_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create, patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama"},
            ), patch(
                "gateway.platforms.api_server._xiaochuang_runtime_agent_kwargs",
                side_effect=RuntimeError("provider-key-secret"),
            ):
                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers=_xiaochuang_headers(),
                )
                data = await resp.json()

        assert resp.status == 409
        assert data["error"]["code"] == "xiaochuang_model_gateway_not_configured"
        assert data["error"]["message"] == (
            "Xiaochuang Model Gateway runtime configuration is unavailable"
        )
        assert "provider-key-secret" not in str(data)
        mock_create.assert_not_called()
        assert adapter._run_streams == {}
        assert adapter._run_statuses == {}

    @pytest.mark.asyncio
    async def test_start_binds_xiaochuang_context_only_for_the_run(self, adapter):
        """Capability data travels through run context, never prompt text."""
        observed_contexts = []
        app = _create_runs_app(adapter)
        clear_xiaochuang_runtime_context()

        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create, patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama"},
            ), patch(
                "gateway.platforms.api_server._xiaochuang_runtime_agent_kwargs",
                return_value=_xiaochuang_gateway_runtime(),
            ), patch(
                "gateway.xiaochuang_skill_bundle.build_xiaochuang_pinned_skills_prompt",
                return_value="[Pinned Skill]",
            ):
                mock_agent = MagicMock()
                mock_agent.session_prompt_tokens = 0
                mock_agent.session_completion_tokens = 0
                mock_agent.session_total_tokens = 0

                def _create_agent(**kwargs):
                    assert "[Pinned Skill]" in kwargs["ephemeral_system_prompt"]
                    mock_agent.xiaochuang_backend_base_url = kwargs[
                        "xiaochuang_backend_base_url"
                    ]
                    mock_agent.xiaochuang_capability_header = kwargs[
                        "xiaochuang_capability_header"
                    ]
                    mock_agent.xiaochuang_capability_token = kwargs[
                        "xiaochuang_capability_token"
                    ]
                    mock_agent.xiaochuang_execution_id = kwargs[
                        "xiaochuang_execution_id"
                    ]
                    mock_agent.xiaochuang_tool_profile = kwargs[
                        "xiaochuang_tool_profile"
                    ]
                    return mock_agent

                def _run_conversation(**kwargs):
                    observed_contexts.append(get_xiaochuang_runtime_context())
                    assert "capability-secret" not in str(kwargs)
                    return {"final_response": "done"}

                mock_create.side_effect = _create_agent
                mock_agent.run_conversation.side_effect = _run_conversation

                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "analyze this source"},
                    headers=_xiaochuang_headers(),
                )
                assert resp.status == 202
                run_id = (await resp.json())["run_id"]

                for _ in range(20):
                    status = await (await cli.get(f"/v1/runs/{run_id}")).json()
                    if status["status"] == "completed":
                        break
                    await asyncio.sleep(0.05)

        assert observed_contexts == [
            {
                "backend_base_url": "http://backend.internal:3010/api/v1",
                "capability_header": "X-Xiaochuang-Capability",
                "capability_token": "capability-secret",
                "execution_id": "123",
                "tool_profile": "xiaochuang-drama-source",
            }
        ]
        assert get_xiaochuang_runtime_context()["capability_token"] == ""

    @pytest.mark.asyncio
    async def test_concurrent_runs_keep_xiaochuang_contexts_isolated(self, adapter):
        """Each executor thread receives only its own run capability context."""
        constructed_contexts = []
        executed_contexts = []
        app = _create_runs_app(adapter)
        clear_xiaochuang_runtime_context()

        def _create_agent(**_kwargs):
            constructed_contexts.append(get_xiaochuang_runtime_context())
            agent = MagicMock()
            agent.session_prompt_tokens = 0
            agent.session_completion_tokens = 0
            agent.session_total_tokens = 0

            def _run_conversation(**_run_kwargs):
                executed_contexts.append(get_xiaochuang_runtime_context())
                return {"final_response": "done"}

            agent.run_conversation.side_effect = _run_conversation
            return agent

        async with TestClient(TestServer(app)) as cli:
            with patch.object(
                adapter, "_create_agent", side_effect=_create_agent,
            ), patch(
                "gateway.platforms.api_server._xiaochuang_api_server_toolsets",
                return_value={"xiaochuang-drama"},
            ), patch(
                "gateway.platforms.api_server._xiaochuang_runtime_agent_kwargs",
                return_value=_xiaochuang_gateway_runtime(),
            ), patch(
                "gateway.xiaochuang_skill_bundle.build_xiaochuang_pinned_skills_prompt",
                return_value="[Pinned Skill]",
            ):
                request_headers = [
                    {
                        **_xiaochuang_headers(
                            tool_profile="xiaochuang-drama-source",
                            capability="capability-a",
                        ),
                        "X-Xiaochuang-Execution-Id": "701",
                    },
                    {
                        **_xiaochuang_headers(
                            tool_profile="xiaochuang-drama-plan",
                            capability="capability-b",
                        ),
                        "X-Xiaochuang-Execution-Id": "702",
                    },
                ]
                responses = await asyncio.gather(*[
                    cli.post(
                        "/v1/runs",
                        json={"input": f"run {index}"},
                        headers=headers,
                    )
                    for index, headers in enumerate(request_headers)
                ])
                run_ids = [(await response.json())["run_id"] for response in responses]

                for _ in range(20):
                    statuses = await asyncio.gather(*[
                        cli.get(f"/v1/runs/{run_id}") for run_id in run_ids
                    ])
                    payloads = [await response.json() for response in statuses]
                    if all(payload["status"] == "completed" for payload in payloads):
                        break
                    await asyncio.sleep(0.05)

        expected = {
            ("capability-a", "701", "xiaochuang-drama-source"),
            ("capability-b", "702", "xiaochuang-drama-plan"),
        }
        assert {
            (
                context["capability_token"],
                context["execution_id"],
                context["tool_profile"],
            )
            for context in constructed_contexts
        } == expected
        assert {
            (
                context["capability_token"],
                context["execution_id"],
                context["tool_profile"],
            )
            for context in executed_contexts
        } == expected
        assert get_xiaochuang_runtime_context()["capability_token"] == ""


# ---------------------------------------------------------------------------
# GET /v1/runs/{run_id} — poll run status
# ---------------------------------------------------------------------------


class TestRunStatus:
    @pytest.mark.asyncio
    async def test_status_completed_run_includes_output_and_usage(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent = MagicMock()
                mock_agent.run_conversation.return_value = {"final_response": "done"}
                mock_agent.session_prompt_tokens = 4
                mock_agent.session_completion_tokens = 2
                mock_agent.session_total_tokens = 6
                mock_create.return_value = mock_agent

                resp = await cli.post("/v1/runs", json={"input": "hello"})
                data = await resp.json()
                run_id = data["run_id"]

                for _ in range(20):
                    status_resp = await cli.get(f"/v1/runs/{run_id}")
                    assert status_resp.status == 200
                    status = await status_resp.json()
                    if status["status"] == "completed":
                        break
                    await asyncio.sleep(0.05)

                assert status["status"] == "completed"
                assert status["output"] == "done"
                assert status["usage"]["total_tokens"] == 6
                assert status["last_event"] == "run.completed"

    @pytest.mark.asyncio
    async def test_status_reflects_explicit_session_id(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent = MagicMock()
                mock_agent.run_conversation.return_value = {"final_response": "done"}
                mock_agent.session_prompt_tokens = 0
                mock_agent.session_completion_tokens = 0
                mock_agent.session_total_tokens = 0
                mock_create.return_value = mock_agent

                resp = await cli.post(
                    "/v1/runs",
                    json={"input": "hello", "session_id": "space-session"},
                )
                data = await resp.json()
                run_id = data["run_id"]

                for _ in range(20):
                    status_resp = await cli.get(f"/v1/runs/{run_id}")
                    status = await status_resp.json()
                    if status["status"] == "completed":
                        break
                    await asyncio.sleep(0.05)

                mock_agent.run_conversation.assert_called_once()
                assert mock_agent.run_conversation.call_args.kwargs["task_id"] == "space-session"
                assert status["session_id"] == "space-session"

    @pytest.mark.asyncio
    async def test_status_not_found_returns_404(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/v1/runs/run_nonexistent")
        assert resp.status == 404

    @pytest.mark.asyncio
    async def test_status_requires_auth(self, auth_adapter):
        app = _create_runs_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/v1/runs/run_any")
        assert resp.status == 401


# ---------------------------------------------------------------------------
# GET /v1/runs/{run_id}/events — SSE event stream
# ---------------------------------------------------------------------------


class TestRunEvents:
    @pytest.mark.asyncio
    async def test_events_stream_returns_completed(self, adapter):
        """Events stream should receive run.completed when agent finishes."""
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent = MagicMock()
                mock_agent.run_conversation.return_value = {"final_response": "Hello!"}
                mock_agent.session_prompt_tokens = 10
                mock_agent.session_completion_tokens = 5
                mock_agent.session_total_tokens = 15
                mock_create.return_value = mock_agent

                # Start run
                resp = await cli.post("/v1/runs", json={"input": "hello"})
                assert resp.status == 202
                data = await resp.json()
                run_id = data["run_id"]

                # Subscribe to events
                events_resp = await cli.get(f"/v1/runs/{run_id}/events")
                assert events_resp.status == 200
                body = await events_resp.text()

                # Should contain run.completed
                assert "run.completed" in body
                assert "Hello!" in body



    @pytest.mark.asyncio
    async def test_approval_response_without_pending_returns_409(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent = MagicMock()
                mock_agent.run_conversation.return_value = {"final_response": "done"}
                mock_agent.session_prompt_tokens = 0
                mock_agent.session_completion_tokens = 0
                mock_agent.session_total_tokens = 0
                mock_create.return_value = mock_agent

                resp = await cli.post("/v1/runs", json={"input": "hello"})
                data = await resp.json()
                run_id = data["run_id"]

                approval_resp = await cli.post(
                    f"/v1/runs/{run_id}/approval",
                    json={"choice": "once"},
                )
                assert approval_resp.status == 409
                approval_data = await approval_resp.json()
                assert approval_data["error"]["code"] in {
                    "approval_not_active",
                    "approval_not_pending",
                }

    @pytest.mark.asyncio
    async def test_approval_string_false_does_not_resolve_all(self, adapter):
        """Quoted false must not fan out approval resolution across the queue."""
        app = _create_runs_app(adapter)
        run_id = "run_bool_parse"
        adapter._run_statuses[run_id] = {"run_id": run_id, "status": "running"}
        adapter._run_approval_sessions[run_id] = "session-123"

        async with TestClient(TestServer(app)) as cli:
            with patch("tools.approval.resolve_gateway_approval", return_value=1) as mock_resolve:
                approval_resp = await cli.post(
                    f"/v1/runs/{run_id}/approval",
                    json={"choice": "once", "all": "false"},
                )

        assert approval_resp.status == 200
        mock_resolve.assert_called_once_with(
            "session-123",
            "once",
            resolve_all=False,
        )

    @pytest.mark.asyncio
    async def test_events_not_found_returns_404(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/v1/runs/run_nonexistent/events")
        assert resp.status == 404

    @pytest.mark.asyncio
    async def test_events_requires_auth(self, auth_adapter):
        app = _create_runs_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/v1/runs/run_any/events")
        assert resp.status == 401


# ---------------------------------------------------------------------------
# POST /v1/runs/{run_id}/stop — interrupt a running agent
# ---------------------------------------------------------------------------


class TestStopRun:
    @pytest.mark.asyncio
    async def test_stop_running_agent(self, adapter):
        """Stop should interrupt the agent and cancel the task."""
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent, agent_ready, _ = _make_slow_agent()
                mock_create.return_value = mock_agent

                # Start run
                resp = await cli.post("/v1/runs", json={"input": "hello"})
                assert resp.status == 202
                data = await resp.json()
                run_id = data["run_id"]

                # Wait for agent to start running in the thread
                agent_ready.wait(timeout=3.0)
                await asyncio.sleep(0.1)

                # Verify agent ref is stored
                assert run_id in adapter._active_run_agents

                # Stop the run
                stop_resp = await cli.post(f"/v1/runs/{run_id}/stop")
                assert stop_resp.status == 200
                stop_data = await stop_resp.json()
                assert stop_data["run_id"] == run_id
                assert stop_data["status"] == "stopping"

                # Agent interrupt should have been called
                mock_agent.interrupt.assert_called_once_with("Stop requested via API")

                status_resp = await cli.get(f"/v1/runs/{run_id}")
                assert status_resp.status == 200
                status_data = await status_resp.json()
                assert status_data["status"] in {"stopping", "cancelled"}

                # Refs should be cleaned up
                await asyncio.sleep(0.5)
                assert run_id not in adapter._active_run_agents
                assert run_id not in adapter._active_run_tasks

    @pytest.mark.asyncio
    async def test_stop_nonexistent_run_returns_404(self, adapter):
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/v1/runs/run_nonexistent/stop")
        assert resp.status == 404

    @pytest.mark.asyncio
    async def test_stop_requires_auth(self, auth_adapter):
        app = _create_runs_app(auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/v1/runs/run_any/stop")
        assert resp.status == 401

    @pytest.mark.asyncio
    async def test_stop_already_completed_run_returns_404(self, adapter):
        """Stopping a run that already finished should return 404 (refs cleaned up)."""
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent = MagicMock()
                mock_agent.run_conversation.return_value = {"final_response": "done"}
                mock_agent.session_prompt_tokens = 0
                mock_agent.session_completion_tokens = 0
                mock_agent.session_total_tokens = 0
                mock_create.return_value = mock_agent

                # Start and wait for completion
                resp = await cli.post("/v1/runs", json={"input": "hello"})
                assert resp.status == 202
                data = await resp.json()
                run_id = data["run_id"]

                await asyncio.sleep(0.3)

                # Run should be done, refs cleaned up
                assert run_id not in adapter._active_run_agents

                # Stop should return 404
                stop_resp = await cli.post(f"/v1/runs/{run_id}/stop")
                assert stop_resp.status == 404

    @pytest.mark.asyncio
    async def test_stop_interrupt_exception_does_not_crash(self, adapter):
        """If agent.interrupt() raises, stop should still succeed."""
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent, agent_ready, interrupted = _make_slow_agent()

                # Override the interrupt side_effect to raise. Still trip
                # ``interrupted`` so the slow_run thread unblocks at teardown
                # — without this the agent thread blocks the full 10s
                # timeout and the test teardown waits the same amount.
                def _raising_interrupt(message=None):
                    interrupted.set()
                    raise RuntimeError("interrupt failed")

                mock_agent.interrupt = MagicMock(side_effect=_raising_interrupt)
                mock_create.return_value = mock_agent

                resp = await cli.post("/v1/runs", json={"input": "hello"})
                assert resp.status == 202
                data = await resp.json()
                run_id = data["run_id"]

                agent_ready.wait(timeout=3.0)
                await asyncio.sleep(0.1)

                stop_resp = await cli.post(f"/v1/runs/{run_id}/stop")
                assert stop_resp.status == 200
                stop_data = await stop_resp.json()
                assert stop_data["status"] == "stopping"

    @pytest.mark.asyncio
    async def test_stop_sends_sentinel_to_events_stream(self, adapter):
        """After stop, the events stream should close."""
        app = _create_runs_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_create_agent") as mock_create:
                mock_agent, agent_ready, _ = _make_slow_agent()
                mock_create.return_value = mock_agent

                # Start run
                resp = await cli.post("/v1/runs", json={"input": "hello"})
                assert resp.status == 202
                data = await resp.json()
                run_id = data["run_id"]

                agent_ready.wait(timeout=3.0)
                await asyncio.sleep(0.1)

                # Subscribe to events in background
                events_task = asyncio.ensure_future(
                    cli.get(f"/v1/runs/{run_id}/events")
                )

                await asyncio.sleep(0.1)

                # Stop the run
                stop_resp = await cli.post(f"/v1/runs/{run_id}/stop")
                assert stop_resp.status == 200

                # Events stream should close
                events_resp = await asyncio.wait_for(events_task, timeout=5.0)
                assert events_resp.status == 200
                body = await events_resp.text()
                # Stream should have received run.failed and closed
                assert "run.failed" in body or "stream closed" in body

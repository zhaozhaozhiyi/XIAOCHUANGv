"""Security and transport tests for the Xiaochuang local tool bridge."""

import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from gateway.xiaochuang_runtime_context import (
    clear_xiaochuang_runtime_context,
    get_xiaochuang_model_gateway_headers,
    get_xiaochuang_runtime_context,
    set_xiaochuang_runtime_context,
)
from tools.registry import registry
from tools.xiaochuang_drama_tool import _call_xiaochuang_tool


class _FakeResponse:
    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return self._body


def _capability_token(expires_at: int) -> str:
    header = base64.urlsafe_b64encode(
        b'{"alg":"EdDSA","typ":"JWT"}'
    ).decode("ascii").rstrip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"exp": expires_at}).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"{header}.{payload}.signature"


def test_bridge_forwards_credentials_only_as_http_headers(monkeypatch):
    captured = {}
    monkeypatch.setenv("XIAOCHUANG_MCP_SERVICE_KEY", "mcp-service-secret")
    tokens = set_xiaochuang_runtime_context(
        backend_base_url="http://backend.internal:3010/api/v1",
        capability_header="X-Xiaochuang-Capability",
        capability_token="capability-secret",
        execution_id="123",
        tool_profile="xiaochuang-drama-source",
    )

    def _urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = {
            key.lower(): value for key, value in req.header_items()
        }
        captured["body"] = req.data.decode("utf-8")
        captured["timeout"] = timeout
        request_body = json.loads(captured["body"])
        return _FakeResponse(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": request_body["id"],
                    "result": {
                        "content": [{"type": "text", "text": '{"ok":true}'}],
                        "structuredContent": {"ok": True},
                    },
                }
            )
        )

    try:
        with patch("tools.xiaochuang_drama_tool.request.urlopen", side_effect=_urlopen):
            result = _call_xiaochuang_tool("get_source_chunk", {"chunk_no": 7})
    finally:
        clear_xiaochuang_runtime_context(tokens)

    assert json.loads(result) == {"ok": True}
    assert captured["url"].endswith(
        "/api/v1/internal/agent-runtime/xiaochuang-drama/mcp"
    )
    assert (
        captured["headers"]["x-xiaochuang-mcp-service-key"]
        == "mcp-service-secret"
    )
    assert captured["headers"]["x-xiaochuang-capability"] == "capability-secret"
    assert captured["headers"]["mcp-protocol-version"] == "2025-03-26"
    assert captured["headers"]["accept"] == "application/json, text/event-stream"
    assert json.loads(captured["body"])["method"] == "tools/call"
    assert json.loads(captured["body"])["params"] == {
        "name": "get_source_chunk",
        "arguments": {"chunk_no": 7},
    }
    assert "capability-secret" not in captured["body"]
    assert "mcp-service-secret" not in captured["body"]
    assert captured["timeout"] is None


def test_bridge_uses_a_deployment_timeout_only_when_explicitly_configured(monkeypatch):
    monkeypatch.setenv("XIAOCHUANG_MCP_SERVICE_KEY", "mcp-service-secret")
    tokens = set_xiaochuang_runtime_context(
        backend_base_url="http://backend.internal:3010/api/v1",
        capability_header="X-Xiaochuang-Capability",
        capability_token="capability-secret",
        execution_id="123",
        tool_profile="xiaochuang-drama-source",
    )
    captured = {}
    updated_context = {}
    monkeypatch.setenv("XIAOCHUANG_TOOL_TIMEOUT_SECONDS", "45")

    def _urlopen(req, timeout=None):
        captured["timeout"] = timeout
        return _FakeResponse('{"ok":true}')

    try:
        with patch("tools.xiaochuang_drama_tool.request.urlopen", side_effect=_urlopen):
            _call_xiaochuang_tool("get_task_context", {})
    finally:
        clear_xiaochuang_runtime_context(tokens)

    assert captured["timeout"] == 45


def test_model_gateway_headers_refresh_the_current_execution_capability(monkeypatch):
    """A nearing-expiry capability is renewed outside prompts and tool input."""
    monkeypatch.setenv("XIAOCHUANG_MCP_SERVICE_KEY", "mcp-service-secret")
    monkeypatch.setenv("XIAOCHUANG_CAPABILITY_REFRESH_SKEW_SECONDS", "60")
    current = _capability_token(1_050)
    renewed = _capability_token(2_000)
    tokens = set_xiaochuang_runtime_context(
        backend_base_url="http://backend.internal:3010/api/v1",
        capability_header="X-Xiaochuang-Capability",
        capability_token=current,
        execution_id="123",
        tool_profile="xiaochuang-drama-source",
    )
    captured = {}

    def _urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = {
            key.lower(): value for key, value in req.header_items()
        }
        captured["body"] = req.data.decode("utf-8")
        captured["timeout"] = timeout
        return _FakeResponse(
            json.dumps(
                {
                    "capability_token": renewed,
                    "expires_at": 2_000,
                }
            )
        )

    try:
        with patch(
            "gateway.xiaochuang_runtime_context.time.time",
            return_value=1_000,
        ), patch(
            "gateway.xiaochuang_runtime_context.request.urlopen",
            side_effect=_urlopen,
        ):
            headers = get_xiaochuang_model_gateway_headers(
                "http://backend.internal:3010/"
                "api/v1/internal/agent-runtime/model-gateway/v1"
            )
            updated_context = get_xiaochuang_runtime_context()
    finally:
        clear_xiaochuang_runtime_context(tokens)

    assert captured["url"].endswith(
        "/api/v1/internal/agent-runtime/capabilities/refresh"
    )
    assert (
        captured["headers"]["x-xiaochuang-mcp-service-key"]
        == "mcp-service-secret"
    )
    assert captured["headers"]["x-xiaochuang-capability"] == current
    assert captured["headers"]["x-xiaochuang-execution-id"] == "123"
    assert captured["body"] == "{}"
    assert current not in captured["body"]
    assert renewed not in captured["body"]
    assert captured["timeout"] is None
    assert headers == {
        "X-Xiaochuang-Capability": renewed,
        "X-Xiaochuang-Execution-Id": "123",
    }
    assert updated_context["capability_token"] == renewed


def test_bridge_requires_mcp_service_identity(monkeypatch):
    monkeypatch.delenv("XIAOCHUANG_MCP_SERVICE_KEY", raising=False)
    tokens = set_xiaochuang_runtime_context(
        backend_base_url="http://backend.internal:3010/api/v1",
        capability_header="X-Xiaochuang-Capability",
        capability_token="capability-secret",
        execution_id="123",
        tool_profile="xiaochuang-drama-source",
    )
    try:
        result = json.loads(_call_xiaochuang_tool("get_task_context", {}))
    finally:
        clear_xiaochuang_runtime_context(tokens)

    assert "service identity is missing" in result["error"]


def test_bridge_rejects_missing_run_context_and_hides_credential_fields():
    clear_xiaochuang_runtime_context()

    result = json.loads(_call_xiaochuang_tool("get_task_context", {}))
    entry = registry.get_entry("get_task_context")

    assert "runtime context is missing" in result["error"].lower()
    assert entry is not None
    assert entry.schema["parameters"]["properties"] == {}


def test_bridge_registers_story_graph_and_storyboard_tools():
    for name in (
        "list_episode_scripts",
        "get_episode_script",
        "submit_story_graph_batch",
        "get_storyboard_task_context",
        "list_episode_script_segments",
        "get_episode_script_segment",
        "get_storyboard_assets",
        "submit_storyboard_batch",
    ):
        assert registry.get_entry(name) is not None


def test_model_tools_registers_xiaochuang_bridge_in_a_fresh_process():
    """The managed toolset must not depend on a previous manual import."""
    expected = {
        "get_task_context",
        "list_source_chunks",
        "get_source_chunk",
        "submit_source_chunk_analysis",
        "submit_source_analysis",
        "submit_blueprint_batch",
        "submit_episode_script",
        "list_episode_scripts",
        "get_episode_script",
        "submit_story_graph_batch",
        "get_storyboard_task_context",
        "list_episode_script_segments",
        "get_episode_script_segment",
        "get_storyboard_assets",
        "submit_storyboard_batch",
        "report_progress",
        "complete_execution",
        "fail_execution",
    }
    script = """
import json
from model_tools import get_tool_definitions
from toolsets import resolve_toolset, validate_toolset

definitions = get_tool_definitions(
    enabled_toolsets=["xiaochuang-drama"],
    quiet_mode=True,
    skip_tool_search_assembly=True,
)
print("__XIAOCHUANG_RESULT__" + json.dumps({
    "valid": validate_toolset("xiaochuang-drama"),
    "resolved": resolve_toolset("xiaochuang-drama"),
    "definitions": [item["function"]["name"] for item in definitions],
}))
"""
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[2],
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    result_line = next(
        line
        for line in completed.stdout.splitlines()
        if line.startswith("__XIAOCHUANG_RESULT__")
    )
    result = json.loads(result_line.removeprefix("__XIAOCHUANG_RESULT__"))

    assert result["valid"] is True
    assert set(result["resolved"]) == expected
    assert set(result["definitions"]) == expected

"""Xiaochuang drama Agent tool bridge.

This module exposes a narrow, local Hermes toolset that forwards each tool call
to Xiaochuang Backend's Streamable HTTP MCP endpoint. The capability token is
read from the per-run context set by the API server; it is never accepted as a
model-visible argument.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict
from urllib import error, request
from uuid import uuid4

from tools.registry import registry

_TOOLSET = "xiaochuang-drama"
_MCP_SERVICE_KEY_HEADER = "X-Xiaochuang-MCP-Service-Key"
_MCP_PROTOCOL_VERSION = "2025-03-26"
_MCP_ENDPOINT_PATH = "/internal/agent-runtime/xiaochuang-drama/mcp"

_TOOL_DESCRIPTIONS: Dict[str, str] = {
    "get_task_context": "Read the scoped Xiaochuang drama task context, project configuration, coverage, and version pointers.",
    "list_source_chunks": "List source chunks available to the current Xiaochuang drama source-understanding task. Does not return source text.",
    "get_source_chunk": "Read one scoped Xiaochuang drama source chunk in an untrusted content envelope.",
    "submit_source_chunk_analysis": "Submit analysis for one Xiaochuang drama source chunk with evidence and source trace.",
    "submit_source_analysis": "Submit the global Xiaochuang drama source understanding result after all required chunks are ready.",
    "submit_blueprint_batch": "Submit one Agent-chosen continuous batch of episode blueprints for the current Xiaochuang drama planning task.",
    "submit_episode_script": "Submit one episode script for the current Xiaochuang drama script-writing task, bound to the current blueprint hash.",
    "list_episode_scripts": "List the scoped episode-script index for the current Xiaochuang drama story-map task.",
    "get_episode_script": "Read one scoped episode script in an untrusted content envelope.",
    "submit_story_graph_batch": "Submit a recoverable batch of Xiaochuang drama story-graph entities, relations, and events.",
    "get_storyboard_task_context": "Read the frozen script, story-map, and baseline contract for the current Xiaochuang storyboard task.",
    "list_episode_script_segments": "List scoped script segments available to the current Xiaochuang storyboard task.",
    "get_episode_script_segment": "Read one scoped script segment in an untrusted content envelope.",
    "get_storyboard_assets": "Read only the character, scene, and prop assets available to the current Xiaochuang storyboard task.",
    "submit_storyboard_batch": "Submit a recoverable batch of storyboard shots bound to the frozen task contract.",
    "report_progress": "Report concise, user-displayable progress facts for the current Xiaochuang drama Agent execution.",
    "complete_execution": "Declare the current Xiaochuang Agent execution complete. Business task completion remains backend-validated.",
    "fail_execution": "Declare the current Xiaochuang Agent execution failed with a sanitized reason.",
}


def _context() -> Dict[str, str]:
    try:
        from gateway.xiaochuang_runtime_context import get_xiaochuang_runtime_context

        return get_xiaochuang_runtime_context()
    except Exception:
        return {}


def _check_available() -> bool:
    return True


def _sanitize_error_text(text: str) -> str:
    ctx = _context()
    token = ctx.get("capability_token") or ""
    if token:
        text = text.replace(token, "[REDACTED]")
    service_key = (os.getenv("XIAOCHUANG_MCP_SERVICE_KEY") or "").strip()
    if service_key:
        text = text.replace(service_key, "[REDACTED]")
    return text[:2000]


def _configured_timeout_seconds() -> float | None:
    """Use an explicit deployment timeout only; business runs have no default cap."""
    raw = (os.getenv("XIAOCHUANG_TOOL_TIMEOUT_SECONDS") or "").strip()
    if not raw:
        return None
    try:
        timeout = float(raw)
    except ValueError:
        return None
    return timeout if timeout > 0 else None


def _mcp_result_to_tool_output(tool_name: str, body: str) -> str:
    """Return MCP structuredContent without exposing protocol or credentials."""
    try:
        response = json.loads(body)
    except json.JSONDecodeError:
        return json.dumps(
            {
                "error": (
                    f"Xiaochuang MCP tool {tool_name} returned an invalid "
                    "JSON-RPC response"
                )
            },
            ensure_ascii=False,
        )

    if not isinstance(response, dict):
        return json.dumps(
            {"error": f"Xiaochuang MCP tool {tool_name} returned an invalid response"},
            ensure_ascii=False,
        )
    rpc_error = response.get("error")
    if isinstance(rpc_error, dict):
        return json.dumps(
            {
                "error": (
                    f"Xiaochuang MCP tool {tool_name} rejected the request: "
                    f"{_sanitize_error_text(str(rpc_error.get('message') or 'unknown error'))}"
                )
            },
            ensure_ascii=False,
        )

    result = response.get("result")
    if not isinstance(result, dict):
        return json.dumps(
            {"error": f"Xiaochuang MCP tool {tool_name} returned no result"},
            ensure_ascii=False,
        )
    structured = result.get("structuredContent")
    if structured is not None:
        return json.dumps(structured, ensure_ascii=False)

    for block in result.get("content") or []:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        text = block.get("text")
        if not isinstance(text, str):
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return json.dumps({"result": text}, ensure_ascii=False)
        return json.dumps(parsed, ensure_ascii=False)

    return "{}"


def _call_xiaochuang_tool(tool_name: str, args: Dict[str, Any]) -> str:
    try:
        from gateway.xiaochuang_runtime_context import (
            refresh_xiaochuang_capability_if_needed,
        )

        ctx = refresh_xiaochuang_capability_if_needed()
    except Exception:
        return json.dumps(
            {
                "error": (
                    "Xiaochuang capability refresh failed. "
                    "The current managed execution cannot continue."
                )
            },
            ensure_ascii=False,
        )
    base_url = (ctx.get("backend_base_url") or "").rstrip("/")
    token = ctx.get("capability_token") or ""
    header = ctx.get("capability_header") or "X-Xiaochuang-MCP-Capability"
    service_key = (os.getenv("XIAOCHUANG_MCP_SERVICE_KEY") or "").strip()
    if not base_url or not token:
        return json.dumps(
            {
                "error": (
                    "Xiaochuang runtime context is missing. This tool is only "
                    "available inside a Xiaochuang-managed Agent run."
                )
            },
            ensure_ascii=False,
        )
    if not service_key:
        return json.dumps(
            {
                "error": (
                    "Xiaochuang MCP service identity is missing. Set "
                    "XIAOCHUANG_MCP_SERVICE_KEY in the Hermes deployment."
                )
            },
            ensure_ascii=False,
        )

    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": uuid4().hex,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": args or {},
            },
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = request.Request(
        f"{base_url}{_MCP_ENDPOINT_PATH}",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": _MCP_PROTOCOL_VERSION,
            _MCP_SERVICE_KEY_HEADER: service_key,
            header: token,
        },
    )
    try:
        timeout = _configured_timeout_seconds()
        request_kwargs = {"timeout": timeout} if timeout is not None else {}
        with request.urlopen(req, **request_kwargs) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return _mcp_result_to_tool_output(tool_name, body)
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return json.dumps(
            {
                "error": f"Xiaochuang tool {tool_name} failed with HTTP {exc.code}: {_sanitize_error_text(body)}",
                "status": exc.code,
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {
                "error": f"Xiaochuang tool {tool_name} failed: {type(exc).__name__}: {_sanitize_error_text(str(exc))}",
            },
            ensure_ascii=False,
        )


def _make_schema(tool_name: str) -> Dict[str, Any]:
    return {
        "name": tool_name,
        "description": _TOOL_DESCRIPTIONS[tool_name],
        "parameters": {
            "type": "object",
            "description": (
                "Business tool arguments only. Do not include user_id, "
                "organization_id, drama_id, execution_id, task_id, auth tokens, "
                "headers, URLs, file paths, or model configuration."
            ),
            "additionalProperties": True,
            "properties": {},
        },
    }


for _tool_name in _TOOL_DESCRIPTIONS:
    registry.register(
        name=_tool_name,
        toolset=_TOOLSET,
        schema=_make_schema(_tool_name),
        handler=lambda args, _name=_tool_name, **kw: _call_xiaochuang_tool(_name, args),
        check_fn=_check_available,
        description=_TOOL_DESCRIPTIONS[_tool_name],
        emoji="🎬",
    )

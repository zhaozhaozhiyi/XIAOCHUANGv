"""Per-run Xiaochuang runtime context for API-server Agent runs.

The values in this module are intentionally carried by a Python ContextVar,
not prompt text, tool arguments, process-global config, or environment
variables. Xiaochuang's backend issues a scoped capability for one Agent
execution; Hermes tools may read it only from this context while serving that
execution. Near expiry, Hermes exchanges it for another signed token with the
same execution JTI and scope, so long-running runs do not need a fixed product
time or batch limit.
"""

from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
from contextvars import ContextVar
from typing import Any, Dict
from urllib import request
from urllib.parse import urlsplit

_UNSET: Any = object()

_RUNTIME_CONTEXT: ContextVar = ContextVar(
    "XIAOCHUANG_RUNTIME_CONTEXT",
    default=_UNSET,
)
_CONTEXT_VARS = (_RUNTIME_CONTEXT,)
_REFRESH_LOCK = threading.RLock()

_MODEL_GATEWAY_PATH = "/api/v1/internal/agent-runtime/model-gateway/v1"
_CAPABILITY_REFRESH_PATH = "/internal/agent-runtime/capabilities/refresh"
_MCP_SERVICE_KEY_HEADER = "X-Xiaochuang-MCP-Service-Key"
_HEADER_NAME_RE = re.compile(r"[A-Za-z0-9-]{1,128}\Z")


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _read_capability_expiry(token: str) -> int:
    """Read the unsigned JWT expiry only to decide when to ask Backend to renew.

    Backend remains the signing and verification authority. An unreadable token
    is deliberately left alone: it will fail closed at the next protected
    Backend endpoint instead of making an unauthenticated refresh request.
    """
    parts = _clean(token).split(".")
    if len(parts) != 3:
        return 0
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        raw = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
        expires_at = int(raw.get("exp", 0))
        return expires_at if expires_at > 0 else 0
    except Exception:
        return 0


def _context_value() -> Dict[str, Any]:
    with _REFRESH_LOCK:
        raw = _RUNTIME_CONTEXT.get()
        return dict(raw) if isinstance(raw, dict) else {}


def get_xiaochuang_runtime_context_reference() -> Dict[str, Any] | None:
    """Return the private per-run state for a worker that lost ContextVar state.

    Hermes can start provider requests in worker threads that do not inherit
    ContextVars. The API adapter attaches this reference to the one Agent
    instance for the run; it is never made model-visible. Refresh updates it
    in place under the same lock, so later worker requests receive the latest
    token without widening scope or creating a process-global credential.
    """
    raw = _RUNTIME_CONTEXT.get()
    return raw if isinstance(raw, dict) else None


def bind_xiaochuang_runtime_context_reference(
    runtime_context: Dict[str, Any],
) -> list:
    """Temporarily bind an existing managed-run state in the current thread."""
    if not isinstance(runtime_context, dict):
        raise RuntimeError("Xiaochuang runtime context reference is invalid")
    return [_RUNTIME_CONTEXT.set(runtime_context)]


def set_xiaochuang_runtime_context(
    *,
    backend_base_url: str = "",
    capability_header: str = "X-Xiaochuang-MCP-Capability",
    capability_token: str = "",
    execution_id: str = "",
    tool_profile: str = "",
) -> list:
    """Set the current Xiaochuang runtime context and return reset tokens."""
    token = _clean(capability_token)
    state = {
        "backend_base_url": _clean(backend_base_url).rstrip("/"),
        "capability_header": _clean(capability_header)
        or "X-Xiaochuang-MCP-Capability",
        "capability_token": token,
        "capability_expires_at": _read_capability_expiry(token),
        "execution_id": _clean(execution_id),
        "tool_profile": _clean(tool_profile),
    }
    return [_RUNTIME_CONTEXT.set(state)]


def clear_xiaochuang_runtime_context(tokens: list | None = None) -> None:
    """Clear context values so a later run cannot inherit credentials."""
    if tokens and len(tokens) == len(_CONTEXT_VARS):
        for var, token in zip(_CONTEXT_VARS, tokens):
            try:
                var.reset(token)
            except Exception:
                var.set({})
        return
    for var in _CONTEXT_VARS:
        var.set({})


def get_xiaochuang_runtime_context() -> Dict[str, Any]:
    """Return public context values with no environment fallback.

    Keep this shape stable for tools and runtime tests. Expiry is internal
    transport state, not an input to a business tool or an observable run
    attribute.
    """
    state = _context_value()
    return {
        "backend_base_url": _clean(state.get("backend_base_url")).rstrip("/"),
        "capability_header": _clean(state.get("capability_header"))
        or "X-Xiaochuang-MCP-Capability",
        "capability_token": _clean(state.get("capability_token")),
        "execution_id": _clean(state.get("execution_id")),
        "tool_profile": _clean(state.get("tool_profile")),
    }


def _refresh_skew_seconds() -> int:
    raw = _clean(os.getenv("XIAOCHUANG_CAPABILITY_REFRESH_SKEW_SECONDS") or "60")
    try:
        return max(1, int(raw))
    except ValueError:
        return 60


def _refresh_timeout_seconds() -> float | None:
    raw = _clean(os.getenv("XIAOCHUANG_CAPABILITY_REFRESH_TIMEOUT_SECONDS"))
    if not raw:
        return None
    try:
        timeout = float(raw)
    except ValueError:
        return None
    return timeout if timeout > 0 else None


def _needs_refresh(context: Dict[str, Any]) -> bool:
    expires_at = int(context.get("capability_expires_at") or 0)
    return bool(
        expires_at
        and time.time() + _refresh_skew_seconds() >= expires_at
    )


def _replace_capability(token: str, expires_at: int) -> None:
    with _REFRESH_LOCK:
        state = _RUNTIME_CONTEXT.get()
        if not isinstance(state, dict) or not state:
            raise RuntimeError("Xiaochuang runtime context is missing")
        # Contexts copied into a run's provider workers retain this one state
        # object. Update the credential pair together while snapshots are
        # guarded by _REFRESH_LOCK so they cannot observe mixed values.
        state["capability_token"] = token
        state["capability_expires_at"] = expires_at


def refresh_xiaochuang_capability_if_needed() -> Dict[str, Any]:
    """Renew the current execution capability shortly before its expiry.

    The request carries only the old capability, immutable execution id and
    Hermes' deployment-level MCP service identity. It cannot alter user,
    project, Skill, tool, model, or task scope; Backend verifies those from the
    signed claims and active execution before returning the renewal.
    """
    context = _context_value()
    if not _needs_refresh(context):
        return get_xiaochuang_runtime_context()

    with _REFRESH_LOCK:
        context = _context_value()
        if not _needs_refresh(context):
            return get_xiaochuang_runtime_context()

        base_url = context["backend_base_url"]
        token = context["capability_token"]
        header = context["capability_header"]
        execution_id = context["execution_id"]
        service_key = _clean(os.getenv("XIAOCHUANG_MCP_SERVICE_KEY"))
        if (
            not base_url
            or not token
            or not service_key
            or not _HEADER_NAME_RE.fullmatch(header)
            or not execution_id.isdecimal()
            or int(execution_id) <= 0
        ):
            raise RuntimeError(
                "Xiaochuang capability refresh requires an active managed run context"
            )

        req = request.Request(
            f"{base_url}{_CAPABILITY_REFRESH_PATH}",
            data=b"{}",
            method="POST",
            headers={
                "Content-Type": "application/json",
                _MCP_SERVICE_KEY_HEADER: service_key,
                header: token,
                "X-Xiaochuang-Execution-Id": execution_id,
            },
        )
        try:
            timeout = _refresh_timeout_seconds()
            request_kwargs = {"timeout": timeout} if timeout is not None else {}
            with request.urlopen(req, **request_kwargs) as response:
                body = response.read().decode("utf-8", errors="replace")
            payload = json.loads(body)
            refreshed_token = _clean(payload.get("capability_token"))
            refreshed_expiry = int(payload.get("expires_at") or 0)
        except Exception as exc:
            raise RuntimeError(
                "Xiaochuang capability refresh request failed"
            ) from exc

        if not refreshed_token or refreshed_expiry <= int(time.time()):
            raise RuntimeError("Xiaochuang capability refresh response was invalid")
        _replace_capability(refreshed_token, refreshed_expiry)
        return get_xiaochuang_runtime_context()


def is_xiaochuang_model_gateway_base_url(base_url: Any) -> bool:
    """Return whether *base_url* is the Xiaochuang Model Gateway endpoint."""
    raw = _clean(base_url).rstrip("/")
    if not raw:
        return False
    try:
        return urlsplit(raw).path.rstrip("/") == _MODEL_GATEWAY_PATH
    except ValueError:
        return False


def get_xiaochuang_model_gateway_headers(base_url: Any) -> Dict[str, str]:
    """Build per-run Model Gateway headers or fail closed for a missing context.

    The capability is intentionally returned only as an HTTP header for the
    fixed Xiaochuang Model Gateway endpoint. It is never made available to a
    prompt, Skill, tool argument, process environment, or another Provider.
    """
    if not is_xiaochuang_model_gateway_base_url(base_url):
        return {}

    context = refresh_xiaochuang_capability_if_needed()
    header_name = context["capability_header"]
    capability_token = context["capability_token"]
    execution_id = context["execution_id"]
    if (
        not _HEADER_NAME_RE.fullmatch(header_name)
        or not capability_token
        or not execution_id.isdecimal()
        or int(execution_id) <= 0
    ):
        raise RuntimeError(
            "Xiaochuang Model Gateway requires an active per-run capability context"
        )
    return {
        header_name: capability_token,
        "X-Xiaochuang-Execution-Id": execution_id,
    }

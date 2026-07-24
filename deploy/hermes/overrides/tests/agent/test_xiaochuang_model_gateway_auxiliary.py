"""Security regression tests for Xiaochuang Model Gateway auxiliary calls."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import agent.auxiliary_client as auxiliary
from gateway.xiaochuang_runtime_context import (
    clear_xiaochuang_runtime_context,
    set_xiaochuang_runtime_context,
)


MODEL_GATEWAY_URL = (
    "http://xiaochuang-backend.internal/"
    "api/v1/internal/agent-runtime/model-gateway/v1"
)


def _runtime() -> dict:
    return {
        "provider": "openrouter",
        "model": "platform-managed-model",
        "base_url": MODEL_GATEWAY_URL,
        "api_key": "hermes-service-identity",
        "api_mode": "chat_completions",
    }


def _bind(capability: str, execution_id: str):
    return set_xiaochuang_runtime_context(
        backend_base_url="http://xiaochuang-backend.internal/api/v1",
        capability_header="X-Xiaochuang-MCP-Capability",
        capability_token=capability,
        execution_id=execution_id,
        tool_profile="xiaochuang-drama-source",
    )


@pytest.fixture(autouse=True)
def _clear_runtime_and_cache():
    clear_xiaochuang_runtime_context()
    with auxiliary._client_cache_lock:
        auxiliary._client_cache.clear()
    yield
    clear_xiaochuang_runtime_context()
    with auxiliary._client_cache_lock:
        auxiliary._client_cache.clear()


def test_gateway_runtime_overrides_task_provider_and_model():
    """A task-local provider override cannot escape a gateway-backed run."""
    tokens = _bind("capability-a", "701")
    try:
        created = MagicMock()
        with patch.object(auxiliary, "OpenAI", return_value=created) as mock_openai:
            client, model = auxiliary.resolve_provider_client(
                "openrouter",
                model="external-model-that-must-not-be-used",
                main_runtime=_runtime(),
            )

        assert client is created
        assert model == "platform-managed-model"
        kwargs = mock_openai.call_args.kwargs
        assert kwargs["api_key"] == "hermes-service-identity"
        assert kwargs["base_url"] == MODEL_GATEWAY_URL
        assert kwargs["default_headers"] == {
            "X-Xiaochuang-MCP-Capability": "capability-a",
            "X-Xiaochuang-Execution-Id": "701",
        }
    finally:
        clear_xiaochuang_runtime_context(tokens)


def test_gateway_clients_are_never_cached_across_executions():
    """Sequential runs must construct clients with their own capability header."""
    first = MagicMock()
    second = MagicMock()

    tokens_a = _bind("capability-a", "701")
    try:
        with patch.object(
            auxiliary,
            "OpenAI",
            side_effect=[first, second],
        ) as mock_openai:
            first_client, _ = auxiliary._get_cached_client(
                "auto",
                model="ignored",
                main_runtime=_runtime(),
            )
            clear_xiaochuang_runtime_context(tokens_a)

            tokens_b = _bind("capability-b", "702")
            try:
                second_client, _ = auxiliary._get_cached_client(
                    "auto",
                    model="ignored",
                    main_runtime=_runtime(),
                )
            finally:
                clear_xiaochuang_runtime_context(tokens_b)
    finally:
        # tokens_a may already have been reset above; clearing is idempotent.
        clear_xiaochuang_runtime_context()

    assert first_client is first
    assert second_client is second
    assert mock_openai.call_count == 2
    assert mock_openai.call_args_list[0].kwargs["default_headers"][
        "X-Xiaochuang-MCP-Capability"
    ] == "capability-a"
    assert mock_openai.call_args_list[1].kwargs["default_headers"][
        "X-Xiaochuang-MCP-Capability"
    ] == "capability-b"
    with auxiliary._client_cache_lock:
        assert auxiliary._client_cache == {}


def test_async_conversion_uses_current_gateway_capability_only():
    tokens = _bind("capability-a", "701")
    try:
        sync_client = SimpleNamespace(
            api_key="hermes-service-identity",
            base_url=MODEL_GATEWAY_URL,
        )
        async_client = MagicMock()
        with patch("openai.AsyncOpenAI", return_value=async_client) as mock_async:
            result, model = auxiliary._to_async_client(
                sync_client,
                "platform-managed-model",
            )

        assert result is async_client
        assert model == "platform-managed-model"
        assert mock_async.call_args.kwargs["default_headers"] == {
            "X-Xiaochuang-MCP-Capability": "capability-a",
            "X-Xiaochuang-Execution-Id": "701",
        }
    finally:
        clear_xiaochuang_runtime_context(tokens)


def test_non_gateway_async_client_never_receives_capability_header():
    tokens = _bind("capability-a", "701")
    try:
        sync_client = SimpleNamespace(
            api_key="ordinary-provider-key",
            base_url="https://provider.example/v1",
        )
        with patch("openai.AsyncOpenAI", return_value=MagicMock()) as mock_async:
            auxiliary._to_async_client(sync_client, "ordinary-model")

        headers = mock_async.call_args.kwargs.get("default_headers") or {}
        assert "X-Xiaochuang-MCP-Capability" not in headers
        assert "X-Xiaochuang-Execution-Id" not in headers
    finally:
        clear_xiaochuang_runtime_context(tokens)


def test_gateway_runtime_without_context_fails_closed_before_client_creation():
    with patch.object(auxiliary, "OpenAI") as mock_openai:
        with pytest.raises(
            RuntimeError,
            match="requires an active per-run capability context",
        ):
            auxiliary.resolve_provider_client(
                "custom",
                model="ignored",
                main_runtime=_runtime(),
            )

    mock_openai.assert_not_called()


def test_gateway_failure_does_not_fallback_to_another_provider():
    """A transient gateway failure remains in the platform-controlled path."""
    tokens = _bind("capability-a", "701")
    try:
        client = MagicMock()
        client.base_url = MODEL_GATEWAY_URL
        client.api_key = "hermes-service-identity"
        client.chat.completions.create.side_effect = RuntimeError(
            "connection refused"
        )
        with patch.object(auxiliary, "OpenAI", return_value=client), patch.object(
            auxiliary,
            "_try_payment_fallback",
        ) as payment_fallback, patch.object(
            auxiliary,
            "_try_configured_fallback_chain",
        ) as configured_fallback, patch.object(
            auxiliary,
            "_try_main_agent_model_fallback",
        ) as main_fallback:
            with pytest.raises(RuntimeError, match="connection refused"):
                auxiliary.call_llm(
                    provider="openrouter",
                    main_runtime=_runtime(),
                    messages=[{"role": "user", "content": "compress"}],
                )
    finally:
        clear_xiaochuang_runtime_context(tokens)

    payment_fallback.assert_not_called()
    configured_fallback.assert_not_called()
    main_fallback.assert_not_called()

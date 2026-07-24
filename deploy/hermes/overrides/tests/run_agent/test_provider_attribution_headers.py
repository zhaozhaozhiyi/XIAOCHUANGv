"""Attribution default_headers applied per provider via base-URL detection."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from gateway.xiaochuang_runtime_context import (
    clear_xiaochuang_runtime_context,
    get_xiaochuang_runtime_context_reference,
    set_xiaochuang_runtime_context,
)
from run_agent import AIAgent


_MODEL_GATEWAY_URL = (
    "http://xiaochuang-backend.internal/"
    "api/v1/internal/agent-runtime/model-gateway/v1"
)


def _new_agent(**kwargs):
    kwargs.setdefault("enabled_toolsets", [])
    kwargs.setdefault("quiet_mode", True)
    kwargs.setdefault("skip_context_files", True)
    kwargs.setdefault("skip_memory", True)
    return AIAgent(**kwargs)


def _bind_xiaochuang_context(capability: str = "capability-secret", execution_id: str = "123"):
    return set_xiaochuang_runtime_context(
        backend_base_url="http://xiaochuang-backend.internal/api/v1",
        capability_header="X-Xiaochuang-MCP-Capability",
        capability_token=capability,
        execution_id=execution_id,
        tool_profile="xiaochuang-drama-source",
    )


@pytest.fixture(autouse=True)
def _clear_xiaochuang_context():
    clear_xiaochuang_runtime_context()
    yield
    clear_xiaochuang_runtime_context()


@patch("run_agent.OpenAI")
def test_openrouter_base_url_applies_or_headers(mock_openai):
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://openrouter.ai/api/v1",
        model="test/model",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )

    agent._apply_client_headers_for_base_url("https://openrouter.ai/api/v1")

    headers = agent._client_kwargs["default_headers"]
    assert headers["HTTP-Referer"] == "https://hermes-agent.nousresearch.com"
    assert headers["X-Title"] == "Hermes Agent"


@patch("run_agent.OpenAI")
def test_routermint_base_url_applies_user_agent_header(mock_openai):
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://api.routermint.com/v1",
        model="test/model",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )

    agent._apply_client_headers_for_base_url("https://api.routermint.com/v1")

    headers = agent._client_kwargs["default_headers"]
    assert headers["User-Agent"].startswith("HermesAgent/")


@patch("run_agent.OpenAI")
def test_nvidia_cloud_base_url_applies_billing_origin_header(mock_openai):
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://integrate.api.nvidia.com/v1",
        model="nvidia/test-model",
        provider="nvidia",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )

    assert agent._client_kwargs["default_headers"]["X-BILLING-INVOKE-ORIGIN"] == "HermesAgent"

    agent._apply_client_headers_for_base_url("https://integrate.api.nvidia.com/v1")

    headers = agent._client_kwargs["default_headers"]
    assert headers["X-BILLING-INVOKE-ORIGIN"] == "HermesAgent"


@patch("run_agent.OpenAI")
def test_nvidia_local_base_url_does_not_apply_billing_origin_header(mock_openai):
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://integrate.api.nvidia.com/v1",
        model="nvidia/test-model",
        provider="nvidia",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )
    agent._client_kwargs["default_headers"] = {
        "X-BILLING-INVOKE-ORIGIN": "HermesAgent",
    }

    agent._apply_client_headers_for_base_url("http://localhost:8000/v1")

    assert "default_headers" not in agent._client_kwargs


@patch("run_agent.OpenAI")
def test_routed_client_preserves_openai_sdk_custom_headers(mock_openai):
    mock_openai.return_value = MagicMock()
    routed_client = SimpleNamespace(
        api_key="test-key",
        base_url="https://integrate.api.nvidia.com/v1",
        _custom_headers={"X-BILLING-INVOKE-ORIGIN": "HermesAgent"},
    )

    with patch("agent.auxiliary_client.resolve_provider_client", return_value=(
        routed_client,
        "nvidia/test-model",
    )):
        agent = _new_agent(
            provider="nvidia",
            model="nvidia/test-model",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )

    headers = agent._client_kwargs["default_headers"]
    assert headers["X-BILLING-INVOKE-ORIGIN"] == "HermesAgent"


@patch("run_agent.OpenAI")
def test_gmi_base_url_picks_up_profile_user_agent(mock_openai):
    """GMI declares User-Agent on its ProviderProfile.default_headers.

    The ``_apply_client_headers_for_base_url`` else-branch looks up the
    provider profile and applies its default_headers, so no GMI-specific
    branch is needed in run_agent.
    """
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://api.gmi-serving.com/v1",
        model="test/model",
        provider="gmi",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )

    agent._apply_client_headers_for_base_url("https://api.gmi-serving.com/v1")

    headers = agent._client_kwargs["default_headers"]
    assert headers["User-Agent"].startswith("HermesAgent/")


@patch("run_agent.OpenAI")
def test_unknown_base_url_clears_default_headers(mock_openai):
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://openrouter.ai/api/v1",
        model="test/model",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )
    agent._client_kwargs["default_headers"] = {"X-Stale": "yes"}

    agent._apply_client_headers_for_base_url("https://api.example.com/v1")

    assert "default_headers" not in agent._client_kwargs


@patch("run_agent.OpenAI")
def test_openrouter_headers_include_response_cache_when_enabled(mock_openai):
    """When openrouter.response_cache is True, the cache header is injected."""
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://openrouter.ai/api/v1",
        model="test/model",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )

    with patch("hermes_cli.config.load_config", return_value={
        "openrouter": {"response_cache": True, "response_cache_ttl": 600},
    }):
        agent._apply_client_headers_for_base_url("https://openrouter.ai/api/v1")

    headers = agent._client_kwargs["default_headers"]
    assert headers["HTTP-Referer"] == "https://hermes-agent.nousresearch.com"
    assert headers["X-OpenRouter-Cache"] == "true"
    assert headers["X-OpenRouter-Cache-TTL"] == "600"


@patch("run_agent.OpenAI")
def test_openrouter_headers_no_cache_when_disabled(mock_openai):
    """When openrouter.response_cache is False, no cache headers are sent."""
    mock_openai.return_value = MagicMock()
    agent = _new_agent(
        api_key="test-key",
        base_url="https://openrouter.ai/api/v1",
        model="test/model",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
    )

    with patch("hermes_cli.config.load_config", return_value={
        "openrouter": {"response_cache": False},
    }):
        agent._apply_client_headers_for_base_url("https://openrouter.ai/api/v1")

    headers = agent._client_kwargs["default_headers"]
    assert headers["HTTP-Referer"] == "https://hermes-agent.nousresearch.com"
    assert "X-OpenRouter-Cache" not in headers
    assert "X-OpenRouter-Cache-TTL" not in headers


@patch("run_agent.OpenAI")
def test_model_gateway_client_receives_active_run_capability(mock_openai):
    tokens = _bind_xiaochuang_context()
    try:
        agent = _new_agent(
            api_key="hermes-service-identity",
            base_url=_MODEL_GATEWAY_URL,
            model="platform-managed-model",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )
    finally:
        clear_xiaochuang_runtime_context(tokens)

    assert agent._client_kwargs["default_headers"] == {
        "X-Xiaochuang-MCP-Capability": "capability-secret",
        "X-Xiaochuang-Execution-Id": "123",
    }


@patch("run_agent.OpenAI")
def test_request_client_binds_the_agents_private_run_context_in_a_worker(
    mock_openai,
):
    """A provider worker gets only its own stored run context when needed."""
    tokens = _bind_xiaochuang_context()
    try:
        agent = _new_agent(
            api_key="hermes-service-identity",
            base_url=_MODEL_GATEWAY_URL,
            model="platform-managed-model",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )
        agent.xiaochuang_runtime_context_reference = (
            get_xiaochuang_runtime_context_reference()
        )
        agent.xiaochuang_backend_base_url = "http://xiaochuang-backend.internal/api/v1"
        agent.xiaochuang_capability_header = "X-Xiaochuang-MCP-Capability"
        agent.xiaochuang_capability_token = "capability-secret"
        agent.xiaochuang_execution_id = "123"
        agent.xiaochuang_tool_profile = "xiaochuang-drama-source"
    finally:
        clear_xiaochuang_runtime_context(tokens)

    agent.client = object()
    created_client = object()
    with patch.object(
        agent,
        "_create_openai_client",
        return_value=created_client,
    ) as mock_create:
        result = agent._create_request_openai_client(reason="worker")

    assert result is created_client
    assert mock_create.call_args.kwargs["shared"] is False
    assert mock_create.call_args.kwargs["reason"] == "worker"
    assert mock_create.call_args.args[0]["default_headers"] == {
        "X-Xiaochuang-MCP-Capability": "capability-secret",
        "X-Xiaochuang-Execution-Id": "123",
    }
    assert agent.xiaochuang_capability_token == "capability-secret"


@patch("run_agent.OpenAI")
def test_model_gateway_client_fails_closed_without_run_capability(mock_openai):
    with pytest.raises(
        RuntimeError,
        match="requires an active per-run capability context",
    ):
        _new_agent(
            api_key="hermes-service-identity",
            base_url=_MODEL_GATEWAY_URL,
            model="platform-managed-model",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )

    mock_openai.assert_not_called()


@patch("run_agent.OpenAI")
def test_non_gateway_client_does_not_receive_run_capability(mock_openai):
    tokens = _bind_xiaochuang_context()
    try:
        agent = _new_agent(
            api_key="ordinary-provider-key",
            base_url="https://api.example.com/v1",
            model="ordinary-model",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )
    finally:
        clear_xiaochuang_runtime_context(tokens)

    headers = agent._client_kwargs.get("default_headers") or {}
    assert "X-Xiaochuang-MCP-Capability" not in headers
    assert "X-Xiaochuang-Execution-Id" not in headers

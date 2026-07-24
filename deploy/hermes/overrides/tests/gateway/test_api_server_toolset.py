"""Tests for hermes-api-server toolset and API server tool availability."""
from unittest.mock import patch, MagicMock


from toolsets import resolve_toolset, get_toolset, validate_toolset


class TestHermesApiServerToolset:
    """Tests for the hermes-api-server toolset definition."""

    def test_toolset_exists(self):
        ts = get_toolset("hermes-api-server")
        assert ts is not None

    def test_toolset_validates(self):
        assert validate_toolset("hermes-api-server")

    def test_toolset_includes_web_tools(self):
        tools = resolve_toolset("hermes-api-server")
        assert "web_search" in tools
        assert "web_extract" in tools

    def test_toolset_includes_core_tools(self):
        tools = resolve_toolset("hermes-api-server")
        expected = [
            "terminal", "process",
            "read_file", "write_file", "patch", "search_files",
            "vision_analyze", "image_generate",
            "execute_code", "delegate_task",
            "todo", "memory", "session_search", "cronjob",
        ]
        for tool in expected:
            assert tool in tools, f"Missing expected tool: {tool}"

    def test_toolset_includes_browser_tools(self):
        tools = resolve_toolset("hermes-api-server")
        for tool in ["browser_navigate", "browser_snapshot", "browser_click",
                      "browser_type", "browser_scroll", "browser_back",
                      "browser_press"]:
            assert tool in tools, f"Missing browser tool: {tool}"

    def test_toolset_includes_homeassistant_tools(self):
        tools = resolve_toolset("hermes-api-server")
        for tool in ["ha_list_entities", "ha_get_state", "ha_list_services", "ha_call_service"]:
            assert tool in tools, f"Missing HA tool: {tool}"

    def test_toolset_excludes_clarify(self):
        tools = resolve_toolset("hermes-api-server")
        assert "clarify" not in tools

    def test_toolset_excludes_send_message(self):
        tools = resolve_toolset("hermes-api-server")
        assert "send_message" not in tools

    def test_toolset_excludes_text_to_speech(self):
        tools = resolve_toolset("hermes-api-server")
        assert "text_to_speech" not in tools


class TestApiServerPlatformConfig:
    def test_platforms_dict_includes_api_server(self):
        from hermes_cli.tools_config import PLATFORMS
        assert "api_server" in PLATFORMS
        assert PLATFORMS["api_server"]["default_toolset"] == "hermes-api-server"


class TestApiServerAdapterToolset:
    @patch("gateway.platforms.api_server.AIOHTTP_AVAILABLE", True)
    def test_create_agent_reads_config_toolsets(self):
        """API server resolves toolsets from config like all other platforms."""
        from gateway.platforms.api_server import APIServerAdapter
        from gateway.config import PlatformConfig

        adapter = APIServerAdapter(PlatformConfig())

        with patch("gateway.run._resolve_runtime_agent_kwargs") as mock_kwargs, \
             patch("gateway.run._resolve_gateway_model") as mock_model, \
             patch("gateway.run._load_gateway_config") as mock_config, \
             patch("run_agent.AIAgent") as mock_agent_cls:

            mock_kwargs.return_value = {"api_key": "test-key", "base_url": None,
                                        "provider": None, "api_mode": None,
                                        "command": None, "args": []}
            mock_model.return_value = "test/model"
            # No platform_toolsets override — should fall back to hermes-api-server default
            mock_config.return_value = {}
            mock_agent_cls.return_value = MagicMock()

            adapter._create_agent()

            mock_agent_cls.assert_called_once()
            call_kwargs = mock_agent_cls.call_args
            toolsets = call_kwargs.kwargs.get("enabled_toolsets")
            assert isinstance(toolsets, list)
            assert len(toolsets) > 0
            assert call_kwargs.kwargs.get("platform") == "api_server"

    @patch("gateway.platforms.api_server.AIOHTTP_AVAILABLE", True)
    def test_create_agent_respects_config_override(self):
        """User can override API server toolsets via platform_toolsets in config.yaml."""
        from gateway.platforms.api_server import APIServerAdapter
        from gateway.config import PlatformConfig

        adapter = APIServerAdapter(PlatformConfig())

        with patch("gateway.run._resolve_runtime_agent_kwargs") as mock_kwargs, \
             patch("gateway.run._resolve_gateway_model") as mock_model, \
             patch("gateway.run._load_gateway_config") as mock_config, \
             patch("run_agent.AIAgent") as mock_agent_cls:

            mock_kwargs.return_value = {"api_key": "test-key", "base_url": None,
                                        "provider": None, "api_mode": None,
                                        "command": None, "args": []}
            mock_model.return_value = "test/model"
            # User overrides with just web and terminal
            mock_config.return_value = {
                "platform_toolsets": {"api_server": ["web", "terminal"]}
            }
            mock_agent_cls.return_value = MagicMock()

            adapter._create_agent()

            mock_agent_cls.assert_called_once()
            call_kwargs = mock_agent_cls.call_args
            toolsets = call_kwargs.kwargs.get("enabled_toolsets")
            assert sorted(toolsets) == ["terminal", "web"]

    @patch("gateway.platforms.api_server.AIOHTTP_AVAILABLE", True)
    def test_managed_run_uses_exact_deployment_toolset_allowlist(
        self, monkeypatch
    ):
        """Managed runs do not inherit local credential-driven tool defaults."""
        from gateway.platforms.api_server import _xiaochuang_api_server_toolsets

        monkeypatch.setenv("XAI_API_KEY", "local-key-that-must-not-matter")
        monkeypatch.setattr(
            "gateway.run._load_gateway_config",
            lambda: {
                "platform_toolsets": {
                    "api_server": ["xiaochuang-drama"],
                },
            },
        )

        assert _xiaochuang_api_server_toolsets() == {"xiaochuang-drama"}

    @patch("gateway.platforms.api_server.AIOHTTP_AVAILABLE", True)
    def test_managed_run_exposes_only_its_tool_profile_tools(self, monkeypatch):
        """A source-analysis run must not even advertise graph/storyboard tools."""
        from gateway.config import PlatformConfig
        from gateway.platforms.api_server import APIServerAdapter

        all_tools = [
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
        ]

        class FakeAgent:
            def __init__(self, **_kwargs):
                self.tools = [
                    {"function": {"name": tool_name}}
                    for tool_name in all_tools
                ]
                self.valid_tool_names = set(all_tools)

        monkeypatch.setattr("run_agent.AIAgent", FakeAgent)
        monkeypatch.setattr(
            "gateway.run._resolve_runtime_agent_kwargs",
            lambda: {
                "provider": "openai",
                "base_url": (
                    "http://backend.internal:3010/"
                    "api/v1/internal/agent-runtime/model-gateway/v1"
                ),
                "api_key": "model-gateway-service-key",
                "api_mode": "chat_completions",
            },
        )
        monkeypatch.setattr(
            "gateway.run._resolve_gateway_model",
            lambda: "xiaochuang-text-project",
        )
        monkeypatch.setattr(
            "gateway.run._load_gateway_config",
            lambda: {
                "platform_toolsets": {
                    "api_server": ["xiaochuang-drama"],
                },
            },
        )
        monkeypatch.setattr(
            "gateway.run.GatewayRunner._load_reasoning_config",
            staticmethod(lambda: {}),
        )
        monkeypatch.setattr(
            "gateway.run.GatewayRunner._load_fallback_model",
            staticmethod(lambda: []),
        )

        adapter = APIServerAdapter(PlatformConfig(enabled=True))
        monkeypatch.setattr(adapter, "_ensure_session_db", lambda: None)
        agent = adapter._create_agent(
            xiaochuang_backend_base_url="http://backend.internal:3010/api/v1",
            xiaochuang_capability_header="X-Xiaochuang-Capability",
            xiaochuang_capability_token="capability-secret",
            xiaochuang_execution_id="123",
            xiaochuang_tool_profile="xiaochuang-drama-source",
        )

        assert agent.valid_tool_names == {
            "get_task_context",
            "list_source_chunks",
            "get_source_chunk",
            "submit_source_chunk_analysis",
            "submit_source_analysis",
            "report_progress",
            "complete_execution",
            "fail_execution",
        }
        assert {
            tool["function"]["name"] for tool in agent.tools
        } == agent.valid_tool_names

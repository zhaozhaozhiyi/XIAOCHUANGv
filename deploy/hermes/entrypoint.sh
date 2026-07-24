#!/bin/sh
set -eu

required_env() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "missing required Hermes runtime environment: $name" >&2
    exit 64
  fi
}

required_env API_SERVER_KEY
required_env XIAOCHUANG_TOOL_PROFILE
required_env XIAOCHUANG_MCP_SERVICE_KEY
required_env HERMES_MODEL_GATEWAY_SERVICE_KEY
required_env HERMES_MODEL_GATEWAY_BASE_URL

case "$XIAOCHUANG_TOOL_PROFILE" in
  xiaochuang-drama-source|xiaochuang-drama-plan|xiaochuang-drama-script|xiaochuang-drama-graph|xiaochuang-drama-storyboard)
    ;;
  *)
    echo "invalid XIAOCHUANG_TOOL_PROFILE: $XIAOCHUANG_TOOL_PROFILE" >&2
    exit 64
    ;;
esac

case "$HERMES_MODEL_GATEWAY_BASE_URL" in
  http://*|https://*)
    ;;
  *)
    echo "HERMES_MODEL_GATEWAY_BASE_URL must be an http(s) URL" >&2
    exit 64
    ;;
esac

mkdir -p "$HERMES_HOME"
cp /opt/xiaochuang-runtime/config.yaml "$HERMES_HOME/config.yaml"
: > "$HERMES_HOME/.no-bundled-skills"
chmod 700 "$HERMES_HOME"
chmod 600 "$HERMES_HOME/config.yaml"

exec hermes gateway run --replace

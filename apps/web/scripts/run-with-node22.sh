#!/bin/sh

set -eu

PREFERRED_NODE="/opt/homebrew/opt/node@22/bin/node"
PREFERRED_NPM="/opt/homebrew/opt/node@22/bin/npm"

if [ -x "$PREFERRED_NODE" ]; then
  NODE_BIN="$PREFERRED_NODE"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "Node.js is required but was not found." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" != "22" ]; then
  echo "Node 22 is required. Current: $("$NODE_BIN" -v)" >&2
  exit 1
fi

case "${1:-}" in
  npm)
    shift
    if [ -x "$PREFERRED_NPM" ]; then
      exec "$PREFERRED_NPM" "$@"
    fi
    exec "$NODE_BIN" "$(dirname "$NODE_BIN")/npm" "$@"
    ;;
  *)
    exec "$NODE_BIN" "$@"
    ;;
esac

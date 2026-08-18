#!/bin/sh
set -u

codex_home=${CODEX_HOME:-"$HOME/.codex"}
install_root=${NATIVE_GLM_INSTALL_ROOT:-"$codex_home/native-glm-worker"}
responses_port=${GLM_RESPONSES_BRIDGE_PORT:-47821}
failures=0

check() {
  if "$@" >/dev/null 2>&1; then printf 'PASS  %s\n' "$*"; else printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); fi
}

check command -v codex
check command -v bun
check command -v python3
check command -v litellm
check test -f "$codex_home/config.toml"
check test -f "$codex_home/agents/glm_worker.toml"
check test -f "$install_root/bridge/responses-bridge.mjs"
check grep -q '^model = "glm-5.3"$' "$codex_home/agents/glm_worker.toml"
check grep -q '^model_reasoning_effort = "max"$' "$codex_home/agents/glm_worker.toml"
check grep -q '^model_context_window = 1000000$' "$codex_home/agents/glm_worker.toml"
check grep -q '^\[agents.glm_worker\]$' "$codex_home/config.toml"
check grep -q '^\[model_providers.zai_glm_native\]$' "$codex_home/config.toml"
check curl --silent --fail --max-time 3 "http://127.0.0.1:$responses_port/health/liveliness"
check curl --silent --fail --max-time 3 "http://127.0.0.1:$responses_port/health/readiness"

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed. No secret values were printed." >&2
  exit 1
fi
echo "Native GLM bridge and Codex registration look healthy. Run native acceptance inside Codex next."

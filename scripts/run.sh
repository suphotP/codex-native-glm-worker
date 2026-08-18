#!/bin/sh
set -eu
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
config_file=${NATIVE_GLM_LITELLM_CONFIG:-"$install_root/bridge/litellm.config.yaml"}
responses_port=${GLM_RESPONSES_BRIDGE_PORT:-47821}
litellm_port=${NATIVE_GLM_LITELLM_PORT:-47825}
account_name=${NATIVE_GLM_KEYCHAIN_ACCOUNT:-$(id -un)}
api_service=${NATIVE_GLM_ZAI_KEY_SERVICE:-ai.z.native-glm.api-key}
master_service=${NATIVE_GLM_MASTER_KEY_SERVICE:-ai.codex.native-glm.bridge-token}

case "$responses_port:$litellm_port" in
  *[!0-9:]*|:*|*:) echo "bridge ports are invalid" >&2; exit 64 ;;
esac
if [ "$responses_port" -lt 1 ] || [ "$responses_port" -gt 65535 ] ||
   [ "$litellm_port" -lt 1 ] || [ "$litellm_port" -gt 65535 ] ||
   [ "$responses_port" -eq "$litellm_port" ]; then
  echo "bridge ports are invalid or collide" >&2
  exit 64
fi

if [ "$(uname -s)" = "Darwin" ]; then
  LITELLM_MASTER_KEY=$(/usr/bin/security find-generic-password -a "$account_name" -s "$master_service" -w)
  ZAI_API_KEY=$(/usr/bin/security find-generic-password -a "$account_name" -s "$api_service" -w)
else
  credentials_file=${NATIVE_GLM_CREDENTIALS_FILE:-"${XDG_CONFIG_HOME:-$HOME/.config}/codex-native-glm-worker/credentials.env"}
  if [ ! -f "$credentials_file" ] || [ -L "$credentials_file" ]; then
    echo "native GLM credentials file is missing or unsafe" >&2
    exit 78
  fi
  file_mode=$(stat -c '%a' "$credentials_file" 2>/dev/null || stat -f '%Lp' "$credentials_file")
  if [ "$file_mode" != "600" ]; then
    echo "native GLM credentials file must be mode 600" >&2
    exit 78
  fi
  LITELLM_MASTER_KEY=$(awk -F= '$1 == "LITELLM_MASTER_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$credentials_file")
  ZAI_API_KEY=$(awk -F= '$1 == "ZAI_API_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$credentials_file")
fi

case "$LITELLM_MASTER_KEY" in ''|*[!A-Za-z0-9._-]*) echo "bridge token is invalid" >&2; exit 78;; esac
case "$ZAI_API_KEY" in ''|*[!A-Za-z0-9._-]*) echo "Z.AI API key is invalid" >&2; exit 78;; esac
export LITELLM_MASTER_KEY ZAI_API_KEY
export LITELLM_LOG=ERROR

litellm_bin=${NATIVE_GLM_LITELLM_BIN:-$(command -v litellm || true)}
bun_bin=${NATIVE_GLM_BUN_BIN:-$(command -v bun || true)}
if [ -z "$litellm_bin" ] || [ -z "$bun_bin" ]; then
  echo "litellm and bun are required" >&2
  exit 69
fi

litellm_pid=
bridge_pid=
cleanup() {
  trap - EXIT INT TERM
  [ -z "$bridge_pid" ] || ! kill -0 "$bridge_pid" 2>/dev/null || kill "$bridge_pid"
  [ -z "$litellm_pid" ] || ! kill -0 "$litellm_pid" 2>/dev/null || kill "$litellm_pid"
  [ -z "$bridge_pid" ] || wait "$bridge_pid" 2>/dev/null || true
  [ -z "$litellm_pid" ] || wait "$litellm_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"$litellm_bin" --config "$config_file" --host 127.0.0.1 --port "$litellm_port" \
  --num_workers 1 --limit_concurrency 16 --telemetry False &
litellm_pid=$!

attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --silent --fail "http://127.0.0.1:$litellm_port/health/liveliness" >/dev/null; then break; fi
  kill -0 "$litellm_pid" 2>/dev/null || { echo "LiteLLM exited before readiness" >&2; exit 70; }
  attempt=$((attempt + 1))
  sleep 1
done
curl --silent --fail "http://127.0.0.1:$litellm_port/health/liveliness" >/dev/null || {
  echo "LiteLLM did not become ready" >&2
  exit 70
}

export LITELLM_BACKEND_URL="http://127.0.0.1:$litellm_port"
export GLM_RESPONSES_BRIDGE_PORT="$responses_port"
"$bun_bin" "$install_root/bridge/responses-bridge.mjs" &
bridge_pid=$!

attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --silent --fail "http://127.0.0.1:$responses_port/health/readiness" >/dev/null; then break; fi
  kill -0 "$bridge_pid" 2>/dev/null || { echo "Responses bridge exited before readiness" >&2; exit 70; }
  attempt=$((attempt + 1))
  sleep 1
done
curl --silent --fail "http://127.0.0.1:$responses_port/health/readiness" >/dev/null || {
  echo "Responses bridge did not become ready" >&2
  exit 70
}

while kill -0 "$litellm_pid" 2>/dev/null && kill -0 "$bridge_pid" 2>/dev/null; do sleep 2; done
echo "native GLM bridge dependency exited; supervisor will stop the pair" >&2
exit 70

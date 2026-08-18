#!/bin/sh
set -eu
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
codex_home=${CODEX_HOME:-"$HOME/.codex"}
install_root=
responses_port=47821
apply=0

usage() {
  echo "usage: install.sh [--apply] [--codex-home PATH] [--install-root PATH] [--responses-port PORT]"
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --codex-home) shift; codex_home=${1:?missing codex home} ;;
    --install-root) shift; install_root=${1:?missing install root} ;;
    --responses-port) shift; responses_port=${1:?missing port} ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
  shift
done
install_root=${install_root:-"$codex_home/native-glm-worker"}
case "$codex_home:$install_root" in /*:/*) ;; *) echo "install paths must be absolute" >&2; exit 64;; esac
case "$codex_home:$install_root" in *[!A-Za-z0-9_./:@+-]*|*..*) echo "unsafe install path" >&2; exit 64;; esac
case "$responses_port" in ''|*[!0-9]*) echo "invalid responses port" >&2; exit 64;; esac
[ "$responses_port" -ge 1 ] && [ "$responses_port" -le 65535 ] || { echo "invalid responses port" >&2; exit 64; }

command -v bun >/dev/null 2>&1 || { echo "bun is required" >&2; exit 69; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 69; }
skill_target="$codex_home/skills/codex-native-glm-worker"
manifest="$install_root/install.manifest"
if [ -L "$manifest" ] || [ -L "$install_root" ] || [ -L "$codex_home/config.toml" ]; then
  echo "symbolic links are not accepted for managed install state or Codex config" >&2
  exit 73
fi
if [ ! -f "$manifest" ]; then
  for unmanaged_target in "$install_root" "$codex_home/agents/glm_worker.toml" "$skill_target"; do
    if [ -e "$unmanaged_target" ] || [ -L "$unmanaged_target" ]; then
      echo "unmanaged target already exists; refusing overwrite: $unmanaged_target" >&2
      exit 73
    fi
  done
elif ! grep -Fxq "$skill_target" "$manifest"; then
  echo "existing install manifest does not own the skill target" >&2
  exit 73
fi

echo "Codex home: $codex_home"
echo "Install root: $install_root"
echo "Responses port: $responses_port"
if [ "$apply" -ne 1 ]; then
  echo "PLAN ONLY: rerun with --apply to install. Existing config will be backed up and conflicts refused."
  exit 0
fi

mkdir -p "$codex_home"
install_lock="$codex_home/.native-glm-install.lock"
if ! mkdir "$install_lock" 2>/dev/null; then
  echo "another native GLM install may be running: $install_lock" >&2
  exit 75
fi
cleanup_lock() { rmdir "$install_lock" 2>/dev/null || true; }
trap cleanup_lock EXIT INT TERM

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_root="$codex_home/backups/native-glm-$timestamp"
render_root=$(mktemp -d)
cleanup_render() { find "$render_root" -depth -delete; }
cleanup_all() { cleanup_render; cleanup_lock; }
trap cleanup_all EXIT INT TERM
bun "$repo_root/scripts/render-templates.mjs" \
  "$repo_root/templates/glm_worker.toml" "$render_root/glm_worker.toml" \
  "{\"__ASSIGNMENT_ROOT__\":\"$codex_home/glm-native-assignments\"}"
bun "$repo_root/scripts/render-templates.mjs" \
  "$repo_root/templates/codex-config.snippet.toml" "$render_root/config.snippet.toml" \
  "{\"__CODEX_HOME__\":\"$codex_home\",\"__INSTALL_ROOT__\":\"$install_root\",\"__BRIDGE_PORT__\":\"$responses_port\",\"__AUTH_COMMAND__\":\"$install_root/bin/bridge-auth\"}"
python3 "$repo_root/scripts/config-block.py" check "$codex_home/config.toml" "$render_root/config.snippet.toml"

mkdir -p "$install_root/bridge" "$install_root/bin" "$codex_home/agents" "$codex_home/glm-native-assignments" "$codex_home/skills"
if [ -f "$codex_home/config.toml" ]; then
  mkdir -p "$backup_root"
  cp "$codex_home/config.toml" "$backup_root/config.toml"
  chmod 600 "$backup_root/config.toml"
fi

install -m 600 "$repo_root/bridge/responses-bridge.mjs" "$install_root/bridge/responses-bridge.mjs"
install -m 600 "$repo_root/bridge/litellm.config.yaml" "$install_root/bridge/litellm.config.yaml"
install -m 700 "$repo_root/scripts/run.sh" "$install_root/bin/run"
install -m 700 "$repo_root/scripts/bridge-auth.sh" "$install_root/bin/bridge-auth"
install -m 700 "$repo_root/scripts/doctor.sh" "$install_root/bin/doctor"
install -m 600 "$repo_root/scripts/self-test.mjs" "$install_root/bin/self-test.mjs"
install -m 600 "$render_root/glm_worker.toml" "$codex_home/agents/glm_worker.toml"
install -m 600 "$render_root/config.snippet.toml" "$install_root/config.snippet.toml"
if [ -d "$skill_target" ]; then
  find "$skill_target" -depth -delete
fi
cp -R "$repo_root/skill/codex-native-glm-worker" "$skill_target"
find "$skill_target" -type d -exec chmod 700 {} \;
find "$skill_target" -type f -exec chmod 600 {} \;
cat > "$install_root/install.manifest" <<EOF
$codex_home/agents/glm_worker.toml
$codex_home/skills/codex-native-glm-worker
$install_root/bridge/responses-bridge.mjs
$install_root/bridge/litellm.config.yaml
$install_root/bin/run
$install_root/bin/bridge-auth
$install_root/bin/doctor
$install_root/bin/self-test.mjs
$install_root/config.snippet.toml
EOF
chmod 600 "$install_root/install.manifest"
python3 "$repo_root/scripts/config-block.py" apply "$codex_home/config.toml" "$install_root/config.snippet.toml"
echo "Installed native GLM files. Configure secrets and service, then run scripts/doctor.sh."

#!/bin/sh
set -eu
umask 077

apply=0
[ "${1:-}" = "--apply" ] && apply=1
codex_home=${CODEX_HOME:-"$HOME/.codex"}
install_root=${NATIVE_GLM_INSTALL_ROOT:-"$codex_home/native-glm-worker"}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

case "$codex_home:$install_root" in
  /*:/*) ;;
  *) echo "service paths must be absolute" >&2; exit 64 ;;
esac
case "$codex_home:$install_root" in
  *[!A-Za-z0-9_./:@+-]*|*..*) echo "unsafe service path" >&2; exit 64 ;;
esac

bun_bin=$(command -v bun || true)
litellm_bin=$(command -v litellm || true)
for binary in "$bun_bin" "$litellm_bin"; do
  case "$binary" in
    /*) ;;
    *) echo "bun and litellm must both resolve to absolute executable paths" >&2; exit 69 ;;
  esac
  [ -x "$binary" ] || { echo "required executable is not executable: $binary" >&2; exit 69; }
  case "$binary" in *[!A-Za-z0-9_./:@+-]*) echo "unsafe executable path: $binary" >&2; exit 64;; esac
done

if [ ! -x "$install_root/bin/run" ]; then
  echo "install the native GLM kit before installing its service" >&2
  exit 66
fi

case "$(uname -s)" in
  Darwin)
    target="$HOME/Library/LaunchAgents/com.codex.native-glm-worker.plist"
    { [ ! -e "$target" ] && [ ! -L "$target" ]; } || { echo "service target already exists: $target" >&2; exit 73; }
    echo "launchd target: $target"
    [ "$apply" -eq 1 ] || { echo "PLAN ONLY: rerun with --apply"; exit 0; }
    mkdir -p "$HOME/Library/LaunchAgents" "$codex_home/logs"
    "$bun_bin" "$repo_root/scripts/render-templates.mjs" \
      "$repo_root/service/macos/com.codex.native-glm-worker.plist.template" "$target" \
      "{\"__INSTALL_ROOT__\":\"$install_root\",\"__CODEX_HOME__\":\"$codex_home\",\"__BUN_BIN__\":\"$bun_bin\",\"__LITELLM_BIN__\":\"$litellm_bin\"}"
    chmod 600 "$target"
    if ! launchctl bootstrap "gui/$(id -u)" "$target"; then
      rm -f "$target"
      echo "launchd bootstrap failed; generated target was removed" >&2
      exit 70
    fi
    ;;
  Linux)
    target="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/codex-native-glm-worker.service"
    { [ ! -e "$target" ] && [ ! -L "$target" ]; } || { echo "service target already exists: $target" >&2; exit 73; }
    echo "systemd user target: $target"
    [ "$apply" -eq 1 ] || { echo "PLAN ONLY: rerun with --apply"; exit 0; }
    mkdir -p "$(dirname -- "$target")"
    "$bun_bin" "$repo_root/scripts/render-templates.mjs" \
      "$repo_root/service/linux/codex-native-glm-worker.service.template" "$target" \
      "{\"__INSTALL_ROOT__\":\"$install_root\",\"__BUN_BIN__\":\"$bun_bin\",\"__LITELLM_BIN__\":\"$litellm_bin\"}"
    chmod 600 "$target"
    systemctl --user daemon-reload
    if ! systemctl --user enable --now codex-native-glm-worker.service; then
      rm -f "$target"
      systemctl --user daemon-reload
      echo "systemd enable/start failed; generated target was removed" >&2
      exit 70
    fi
    ;;
  *) echo "automatic service installation is currently supported on macOS and Linux" >&2; exit 69 ;;
esac
echo "native GLM bridge service installed"

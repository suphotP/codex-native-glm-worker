#!/bin/sh
set -eu

apply=0
[ "${1:-}" = "--apply" ] && apply=1
case "$(uname -s)" in
  Darwin)
    target="$HOME/Library/LaunchAgents/com.codex.native-glm-worker.plist"
    echo "launchd target: $target"
    [ "$apply" -eq 1 ] || { echo "PLAN ONLY: rerun with --apply"; exit 0; }
    [ -f "$target" ] && [ ! -L "$target" ] && grep -Fq 'managed-by: codex-native-glm-worker v1' "$target" || {
      echo "managed launchd target is missing or has different ownership" >&2
      exit 66
    }
    launchctl bootout "gui/$(id -u)" "$target" 2>/dev/null || true
    rm -f "$target"
    ;;
  Linux)
    target="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/codex-native-glm-worker.service"
    echo "systemd user target: $target"
    [ "$apply" -eq 1 ] || { echo "PLAN ONLY: rerun with --apply"; exit 0; }
    [ -f "$target" ] && [ ! -L "$target" ] && grep -Fq 'managed-by: codex-native-glm-worker v1' "$target" || {
      echo "managed systemd target is missing or has different ownership" >&2
      exit 66
    }
    systemctl --user disable --now codex-native-glm-worker.service 2>/dev/null || true
    rm -f "$target"
    systemctl --user daemon-reload
    ;;
  *) echo "automatic service removal is currently supported on macOS and Linux" >&2; exit 69 ;;
esac
echo "native GLM bridge service removed"

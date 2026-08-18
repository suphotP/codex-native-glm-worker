#!/bin/sh
set -eu
umask 077

codex_home=${CODEX_HOME:-"$HOME/.codex"}
install_root=${NATIVE_GLM_INSTALL_ROOT:-"$codex_home/native-glm-worker"}
apply=0
[ "${1:-}" = "--apply" ] && apply=1
manifest="$install_root/install.manifest"
if [ ! -f "$manifest" ] || [ -L "$manifest" ] || [ -L "$install_root" ] || [ -L "$codex_home/config.toml" ]; then
  echo "managed install manifest is missing; refusing uninstall" >&2
  exit 66
fi
echo "Managed install root: $install_root"
if [ "$apply" -ne 1 ]; then
  echo "PLAN ONLY: rerun with --apply"
  exit 0
fi
install_lock="$codex_home/.native-glm-install.lock"
if ! mkdir "$install_lock" 2>/dev/null; then
  echo "another native GLM install operation may be running: $install_lock" >&2
  exit 75
fi
cleanup_lock() { rmdir "$install_lock" 2>/dev/null || true; }
trap cleanup_lock EXIT INT TERM
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
while IFS= read -r target; do
  [ -n "$target" ] || continue
  case "$target" in
    "$codex_home/agents/glm_worker.toml"|"$codex_home/skills/codex-native-glm-worker"|"$install_root"/*) ;;
    *) echo "unsafe manifest target refused: $target" >&2; exit 65 ;;
  esac
done < "$manifest"
python3 "$script_dir/config-block.py" remove "$codex_home/config.toml"
while IFS= read -r target; do
  [ -n "$target" ] || continue
  case "$target" in
    "$codex_home/agents/glm_worker.toml"|"$install_root"/*) [ -d "$target" ] && continue; rm -f "$target" ;;
    "$codex_home/skills/codex-native-glm-worker") find "$target" -depth -delete 2>/dev/null || true ;;
    *) exit 65 ;;
  esac
done < "$manifest"
rm -f "$manifest"
rmdir "$install_root/bridge" "$install_root/bin" "$install_root" 2>/dev/null || true
echo "Removed managed native GLM files. Backups and credentials were preserved."

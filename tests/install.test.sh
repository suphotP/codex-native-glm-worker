#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d)
cleanup() { find "$test_root" -depth -delete; }
trap cleanup EXIT INT TERM
file_mode() {
  if [ "$(uname -s)" = "Darwin" ]; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi
}

codex_home="$test_root/clean/.codex"
CODEX_HOME="$codex_home" "$repository_root/scripts/install.sh" >/dev/null
[ ! -e "$codex_home" ]
CODEX_HOME="$codex_home" "$repository_root/scripts/install.sh" --apply >/dev/null
python3 -c 'import pathlib,tomllib,sys; tomllib.loads(pathlib.Path(sys.argv[1]).read_text())' "$codex_home/config.toml"
grep -q '^\[agents.glm_worker\]$' "$codex_home/config.toml"
grep -q '^model = "glm-5.3"$' "$codex_home/agents/glm_worker.toml"
grep -q '^model_reasoning_effort = "max"$' "$codex_home/agents/glm_worker.toml"
[ "$(file_mode "$codex_home/config.toml")" = "600" ]
[ "$(file_mode "$codex_home/agents/glm_worker.toml")" = "600" ]
[ "$(file_mode "$codex_home/native-glm-worker/bin/run")" = "700" ]

# Reinstall is idempotent and does not duplicate the managed block.
CODEX_HOME="$codex_home" "$repository_root/scripts/install.sh" --apply >/dev/null
[ "$(grep -c '^# BEGIN codex-native-glm-worker v1$' "$codex_home/config.toml")" -eq 1 ]

# An unmanaged conflicting table is refused before installed files appear.
conflict_home="$test_root/conflict/.codex"
mkdir -p "$conflict_home"
printf '%s\n' '[agents.glm_worker]' 'description = "unmanaged"' > "$conflict_home/config.toml"
if CODEX_HOME="$conflict_home" "$repository_root/scripts/install.sh" --apply >/dev/null 2>&1; then
  echo "installer accepted unmanaged conflict" >&2
  exit 1
fi
[ ! -e "$conflict_home/native-glm-worker" ]
[ ! -e "$conflict_home/agents/glm_worker.toml" ]

# A dangling unmanaged symlink is a conflict, never an install destination.
symlink_home="$test_root/symlink/.codex"
mkdir -p "$symlink_home/agents"
ln -s "$test_root/outside-role.toml" "$symlink_home/agents/glm_worker.toml"
if CODEX_HOME="$symlink_home" "$repository_root/scripts/install.sh" --apply >/dev/null 2>&1; then
  echo "installer followed an unmanaged role symlink" >&2
  exit 1
fi
[ ! -e "$test_root/outside-role.toml" ]

# A config symlink is refused rather than rewriting an external file.
config_link_home="$test_root/config-link/.codex"
mkdir -p "$config_link_home"
printf '%s\n' '[outside]' 'preserved = true' > "$test_root/outside-config.toml"
ln -s "$test_root/outside-config.toml" "$config_link_home/config.toml"
if CODEX_HOME="$config_link_home" "$repository_root/scripts/install.sh" --apply >/dev/null 2>&1; then
  echo "installer followed a config symlink" >&2
  exit 1
fi
grep -q '^preserved = true$' "$test_root/outside-config.toml"

# A tampered manifest is validated before config removal or any deletion.
tampered_home="$test_root/tampered/.codex"
CODEX_HOME="$tampered_home" "$repository_root/scripts/install.sh" --apply >/dev/null
printf '%s\n' "$test_root/not-owned" >> "$tampered_home/native-glm-worker/install.manifest"
if CODEX_HOME="$tampered_home" "$repository_root/scripts/uninstall.sh" --apply >/dev/null 2>&1; then
  echo "uninstaller accepted an unsafe manifest target" >&2
  exit 1
fi
grep -q '^\[agents.glm_worker\]$' "$tampered_home/config.toml"
[ -f "$tampered_home/native-glm-worker/bin/run" ]

# Uninstall removes only managed files/block and preserves unrelated config.
printf '\n[unrelated]\nvalue = true\n' >> "$codex_home/config.toml"
CODEX_HOME="$codex_home" "$repository_root/scripts/uninstall.sh" --apply >/dev/null
grep -q '^\[unrelated\]$' "$codex_home/config.toml"
! grep -q '^\[agents.glm_worker\]$' "$codex_home/config.toml"
[ ! -e "$codex_home/agents/glm_worker.toml" ]
[ ! -e "$codex_home/skills/codex-native-glm-worker" ]

echo "TEMP_INSTALL_TEST_PASS"

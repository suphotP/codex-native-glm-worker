#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d)
test_root=$(CDPATH= cd -- "$test_root" && pwd -P)
cleanup() { find "$test_root" -depth -delete; }
trap cleanup EXIT INT TERM

test_home="$test_root/home/.codex"
package="$test_home/vendor_imports/codex-0.155.0-alpha.16-sol-glm"
state="$test_root/launchctl-state"
tools="$test_root/mock-bin"
mkdir -p "$package/bin" "$package/patches" "$package/source/codex-rs/core/src/agent" "$tools"
printf '%s\n' '/prior/codex' > "$state"

cat > "$package/bin/codex" <<'SH'
#!/bin/sh
[ "$1" = --version ] && { : > "$MOCK_VERSION_SENTINEL"; echo 'codex-cli 0.155.0-alpha.16'; exit 0; }
exit 64
SH
cat > "$package/bin/codex-code-mode-host" <<'SH'
#!/bin/sh
exit 0
SH
chmod 700 "$package/bin/codex" "$package/bin/codex-code-mode-host"
cp "$repo_root/patches/codex-0.155.0-alpha.16-subagent-provider.patch" "$package/patches/codex-0.155.0-alpha.16-subagent-provider.patch"
printf '%s\n' 'lock fixture' > "$package/source/codex-rs/Cargo.lock"
printf '%s\n' 'role fixture' > "$package/source/codex-rs/core/src/agent/role.rs"
printf '%s\n' 'role test fixture' > "$package/source/codex-rs/core/src/agent/role_tests.rs"
python3 - "$package" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
names = [
    'bin/codex', 'bin/codex-code-mode-host',
    'patches/codex-0.155.0-alpha.16-subagent-provider.patch',
    'source/codex-rs/Cargo.lock',
    'source/codex-rs/core/src/agent/role.rs',
    'source/codex-rs/core/src/agent/role_tests.rs',
]
files = {name: {'sha256': hashlib.sha256((root / name).read_bytes()).hexdigest()} for name in names}
manifest = {
    'schemaVersion': 1,
    'package': 'codex-native-glm-worker-backend',
    'sourceTag': 'rust-v0.155.0-alpha.16',
    'sourceCommit': '0e2f848bf4a4e8d41a02d848a851ba126c09d185',
    'providerId': 'zai_glm_native',
    'patch': {'path': names[2], 'sha256': files[names[2]]['sha256']},
    'patchScope': ['codex-rs/core/src/agent/role.rs', 'codex-rs/core/src/agent/role_tests.rs'],
    'lockNormalization': {'path': 'source/codex-rs/Cargo.lock', 'sha256': files['source/codex-rs/Cargo.lock']['sha256']},
    'files': files,
}
(root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
sums = [f"{files[name]['sha256']}  {name}" for name in names]
sums.append(f"{hashlib.sha256((root / 'manifest.json').read_bytes()).hexdigest()}  manifest.json")
(root / 'SHA256SUMS').write_text('\n'.join(sums) + '\n', encoding='utf-8')
PY

cat > "$tools/uname" <<'SH'
#!/bin/sh
printf '%s\n' "${MOCK_UNAME:-Darwin}"
SH
cat > "$tools/launchctl" <<'SH'
#!/bin/sh
case "$1:$2" in
  getenv:CODEX_CLI_PATH) [ -s "$MOCK_LAUNCHCTL_STATE" ] && cat "$MOCK_LAUNCHCTL_STATE" ;;
  setenv:CODEX_CLI_PATH) printf '%s\n' "$3" > "$MOCK_LAUNCHCTL_STATE" ;;
  unsetenv:CODEX_CLI_PATH) : > "$MOCK_LAUNCHCTL_STATE" ;;
  *) exit 64 ;;
esac
SH
cat > "$tools/ps" <<'SH'
#!/bin/sh
case "$*" in
  '-axo pid=,ppid=,comm=') printf '12345 999 %s\n' "$MOCK_PS_TARGET" ;;
  '-ww -p 12345 -o args=') printf '%s %s\n' "$MOCK_PS_TARGET" "${MOCK_PS_ARGS:-app-server}" ;;
  '-p 999 -o comm=') printf '%s\n' "${MOCK_PARENT_PATH:-/Applications/ChatGPT.app/Contents/MacOS/ChatGPT}" ;;
  *) exit 64 ;;
esac
SH
cat > "$tools/lsof" <<'SH'
#!/bin/sh
python3 - "$MOCK_PS_TARGET" <<'PY'
import os
import sys
inode = os.stat(sys.argv[1]).st_ino
if os.environ.get('MOCK_OLD_INODE') == '1':
    inode += 1
print(f'p12345\nftxt\ni{inode}\nn{sys.argv[1]}')
PY
SH
cat > "$tools/curl" <<'SH'
#!/bin/sh
exit 0
SH
for command_name in bun litellm codex; do
  printf '%s\n' '#!/bin/sh' 'exit 0' > "$tools/$command_name"
done
chmod 700 "$tools"/*

export PATH="$tools:$PATH" MOCK_LAUNCHCTL_STATE="$state" MOCK_PS_TARGET="$package/bin/codex" MOCK_VERSION_SENTINEL="$test_root/version-ran"
plan=$(CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh")
printf '%s\n' "$plan" | grep -Fq 'PLAN ONLY'
printf '%s\n' "$plan" | grep -Fq 'Current launchctl CODEX_CLI_PATH: /prior/codex'
[ "$(cat "$state")" = '/prior/codex' ]
[ ! -e "$MOCK_VERSION_SENTINEL" ]
[ ! -e "$test_home/backups" ]

CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh" --apply > "$test_root/apply.out"
[ -e "$MOCK_VERSION_SENTINEL" ]
[ "$(cat "$state")" = "$package/bin/codex" ]
receipt=$(find "$test_home/backups/native-glm-backend-activation" -type f -name '*.txt' -print)
[ -n "$receipt" ]
grep -Fq 'Previous CODEX_CLI_PATH: /prior/codex' "$receipt"
grep -Fq 'Restore previous override: launchctl setenv CODEX_CLI_PATH /prior/codex' "$receipt"
python3 - "$receipt" <<'PY'
import os
import stat
import sys
assert stat.S_IMODE(os.stat(sys.argv[1]).st_mode) == 0o600
PY
CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh" --apply > "$test_root/repeat.out"
[ "$(find "$test_home/backups/native-glm-backend-activation" -type f | wc -l | tr -d ' ')" -eq 1 ]

mkdir -p "$test_home/agents" "$test_home/native-glm-worker/bridge"
printf '%s\n' '[agents.glm_worker]' '[model_providers.zai_glm_native]' > "$test_home/config.toml"
printf '%s\n' 'model = "glm-5.3"' 'model_provider = "zai_glm_native"' 'model_reasoning_effort = "max"' 'model_context_window = 1000000' > "$test_home/agents/glm_worker.toml"
touch "$test_home/native-glm-worker/bridge/responses-bridge.mjs"
rm "$MOCK_VERSION_SENTINEL"
CODEX_HOME="$test_home" "$repo_root/scripts/doctor.sh" > "$test_root/doctor.out"
grep -Fq 'PASS  Active Desktop app-server at configured backend path' "$test_root/doctor.out"
grep -Fq 'PASS  Native GLM provider registered' "$test_root/doctor.out"
[ ! -e "$MOCK_VERSION_SENTINEL" ]

if MOCK_PS_ARGS='--version' CODEX_HOME="$test_home" "$repo_root/scripts/doctor.sh" > "$test_root/standalone.out" 2>&1; then
  echo 'doctor accepted an unrelated codex CLI process' >&2; exit 1
fi
grep -Fq 'no app-server process' "$test_root/standalone.out"

if MOCK_PARENT_PATH='/bin/zsh' CODEX_HOME="$test_home" "$repo_root/scripts/doctor.sh" > "$test_root/no-desktop.out" 2>&1; then
  echo 'doctor accepted a standalone app-server with shell parent' >&2; exit 1
fi
grep -Fq 'not a Codex/ChatGPT Desktop child' "$test_root/no-desktop.out"

if MOCK_OLD_INODE=1 CODEX_HOME="$test_home" "$repo_root/scripts/doctor.sh" > "$test_root/old-process.out" 2>&1; then
  echo 'doctor accepted a stale running backend inode' >&2; exit 1
fi
grep -Fq 'older/different binary inode' "$test_root/old-process.out"

if MOCK_UNAME=Linux CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh" --apply > "$test_root/linux.out" 2>&1; then
  echo 'Linux apply pretended to change the global environment' >&2; exit 1
fi
grep -Fq 'export CODEX_CLI_PATH=' "$test_root/linux.out"
[ "$(cat "$state")" = "$package/bin/codex" ]

mv "$package/manifest.json" "$test_root/saved-manifest.json"
printf '%s\n' '/prior/codex' > "$state"
if CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh" --apply > "$test_root/unmanaged.out" 2>&1; then
  echo 'activation accepted an unmanaged package' >&2; exit 1
fi
[ "$(cat "$state")" = '/prior/codex' ]
mv "$test_root/saved-manifest.json" "$package/manifest.json"

cp "$package/manifest.json" "$test_root/saved-manifest.json"
python3 - "$package/manifest.json" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text(path.read_text().replace('rust-v0.155.0-alpha.16', 'rust-v0.154.0'), encoding='utf-8')
PY
if CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh" --apply > "$test_root/version.out" 2>&1; then
  echo 'activation accepted a mismatched source version' >&2; exit 1
fi
[ "$(cat "$state")" = '/prior/codex' ]
mv "$test_root/saved-manifest.json" "$package/manifest.json"

mv "$package/bin/codex" "$test_root/saved-codex"
ln -s "$test_root/saved-codex" "$package/bin/codex"
if CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh" --apply > "$test_root/symlink.out" 2>&1; then
  echo 'activation accepted a linked backend binary' >&2; exit 1
fi
[ "$(cat "$state")" = '/prior/codex' ]
rm "$package/bin/codex"
mv "$test_root/saved-codex" "$package/bin/codex"

printf '%s\n' 'tampered' >> "$package/patches/codex-0.155.0-alpha.16-subagent-provider.patch"
if CODEX_HOME="$test_home" "$repo_root/scripts/activate-backend.sh" --apply > "$test_root/tamper.out" 2>&1; then
  echo 'activation accepted a tampered package' >&2; exit 1
fi
[ "$(cat "$state")" = '/prior/codex' ]
grep -Fq 'file hash does not match' "$test_root/tamper.out"

printf '%s\n' 'ACTIVATE_BACKEND_TEST_PASS'

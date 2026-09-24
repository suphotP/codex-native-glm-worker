#!/bin/sh
set -eu
umask 077

codex_home=${CODEX_HOME:-"$HOME/.codex"}
package_dir=
package_explicit=0
apply=0

usage() {
  echo 'usage: activate-backend.sh [--apply] [--codex-home PATH] [--package PATH]'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --codex-home) shift; codex_home=${1:?missing codex home} ;;
    --package) shift; package_dir=${1:?missing package path}; package_explicit=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
  shift
done

case "$codex_home" in /*) ;; *) echo 'Codex home must be absolute' >&2; exit 64 ;; esac
if [ "$package_explicit" -eq 0 ]; then
  package_dir="$codex_home/vendor_imports/codex-0.155.0-alpha.16-sol-glm"
fi
case "$package_dir" in /*) ;; *) echo 'backend package path must be absolute' >&2; exit 64 ;; esac
command -v python3 >/dev/null 2>&1 || { echo 'python3 is required to validate the backend package' >&2; exit 69; }

# The build publishes a complete directory atomically. A bare codex binary is
# deliberately not enough to take control of the desktop override.
target=$(python3 - "$package_dir" "$apply" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

package = Path(sys.argv[1])
apply = sys.argv[2] == '1'
expected_version = '0.155.0-alpha.16'
expected_patch_sha = '577706c89b1c5c3436e7940d63ec1ea32d44e5e90b000410d89ee16423148b6b'
required = {
    'bin/codex',
    'bin/codex-code-mode-host',
    'patches/codex-0.155.0-alpha.16-subagent-provider.patch',
    'source/codex-rs/Cargo.lock',
    'source/codex-rs/core/src/agent/role.rs',
    'source/codex-rs/core/src/agent/role_tests.rs',
}

def reject(message):
    raise ValueError(message)

try:
    if package.is_symlink() or not package.is_dir():
        reject('backend package directory is missing or is a symbolic link')
    package = package.resolve(strict=True)
    manifest_path = package / 'manifest.json'
    sums_path = package / 'SHA256SUMS'
    if any(path.is_symlink() or not path.is_file() for path in (manifest_path, sums_path)):
        reject('manifest.json or SHA256SUMS is missing or is a symbolic link')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if (manifest.get('schemaVersion') != 1 or
        manifest.get('package') != 'codex-native-glm-worker-backend' or
        manifest.get('sourceTag') != 'rust-v0.155.0-alpha.16' or
        manifest.get('sourceCommit') != '0e2f848bf4a4e8d41a02d848a851ba126c09d185' or
        manifest.get('providerId') != 'zai_glm_native'):
        reject('backend manifest ownership, provider, or source version does not match')
    files = manifest.get('files')
    if not isinstance(files, dict) or set(files) != required:
        reject('backend manifest does not list required package files')
    if manifest.get('patchScope') != ['codex-rs/core/src/agent/role.rs', 'codex-rs/core/src/agent/role_tests.rs']:
        reject('backend patch scope does not match the two native role files')
    lock = manifest.get('lockNormalization')
    if not isinstance(lock, dict) or lock.get('path') != 'source/codex-rs/Cargo.lock' or lock.get('sha256') != files['source/codex-rs/Cargo.lock'].get('sha256'):
        reject('backend lock metadata does not match the manifest')
    patch = manifest.get('patch')
    patch_path = 'patches/codex-0.155.0-alpha.16-subagent-provider.patch'
    if not isinstance(patch, dict) or patch.get('path') != patch_path or patch.get('sha256') != expected_patch_sha or patch.get('sha256') != files[patch_path].get('sha256'):
        reject('backend patch metadata does not match the manifest')

    sums = {}
    for line in sums_path.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match or match.group(2) in sums:
            reject('SHA256SUMS is malformed or has duplicate paths')
        sums[match.group(2)] = match.group(1)
    if set(sums) != set(files) | {'manifest.json'}:
        reject('SHA256SUMS and manifest files differ')
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != sums['manifest.json']:
        reject('backend manifest hash does not match SHA256SUMS')
    for name, entry in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or name != relative.as_posix() or not isinstance(entry, dict):
            reject('backend manifest has an unsafe file path')
        path = package / relative
        linked_component = any((package.joinpath(*relative.parts[:index])).is_symlink() for index in range(1, len(relative.parts) + 1))
        if linked_component or not path.is_file() or package not in path.resolve().parents:
            reject('backend package file is missing, linked, or escapes the package')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry.get('sha256') or digest != sums[name]:
            reject('backend package file hash does not match')
    executable = package / 'bin/codex'
    host = package / 'bin/codex-code-mode-host'
    if not os.access(executable, os.X_OK) or not os.access(host, os.X_OK):
        reject('backend binaries are not executable')
    if apply:
        version = subprocess.run([str(executable), '--version'], capture_output=True, text=True, timeout=10, check=True)
        if version.stdout.strip() != f'codex-cli {expected_version}':
            reject('backend binary reports a different Codex version')
    print(executable)
except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as exc:
    print(f'backend package validation failed: {exc}', file=sys.stderr)
    sys.exit(65)
PY
) || exit $?

echo "Package metadata/hash check passed: $(dirname -- "$(dirname -- "$target")")"
echo "Target CODEX_CLI_PATH: $target"

platform=$(uname -s)
if [ "$platform" = Darwin ]; then
  command -v launchctl >/dev/null 2>&1 || { echo 'launchctl is required on macOS' >&2; exit 69; }
  current=$(launchctl getenv CODEX_CLI_PATH 2>/dev/null || true)
  if [ -n "$current" ]; then
    echo "Current launchctl CODEX_CLI_PATH: $current"
  else
    echo 'Current launchctl CODEX_CLI_PATH: (unset)'
  fi
  if [ "$apply" -eq 0 ]; then
    echo 'PLAN ONLY: rerun with --apply to set the launchctl override. Restart Codex afterward.'
    exit 0
  fi
  if [ "$current" = "$target" ]; then
    echo 'Already configured. Restart Codex if it was running before this override was set.'
    exit 0
  fi
  receipt_dir="$codex_home/backups/native-glm-backend-activation"
  if [ -L "$codex_home/backups" ] || [ -L "$receipt_dir" ]; then
    echo 'activation receipt directory may not be a symbolic link' >&2
    exit 73
  fi
  mkdir -p "$receipt_dir"
  receipt=$(mktemp "$receipt_dir/activation-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.txt")
  python3 - "$receipt" "$current" "$target" <<'PY'
from pathlib import Path
import shlex
import sys

receipt, previous, target = sys.argv[1:]
restore = ('launchctl setenv CODEX_CLI_PATH ' + shlex.quote(previous)
           if previous else 'launchctl unsetenv CODEX_CLI_PATH')
Path(receipt).write_text(
    'Previous CODEX_CLI_PATH: ' + (previous or '(unset)') + '\n'
    'New CODEX_CLI_PATH: ' + target + '\n'
    'Restore previous override: ' + restore + '\n', encoding='utf-8')
PY
  if ! launchctl setenv CODEX_CLI_PATH "$target"; then
    echo "launchctl setenv failed. Previous override is recorded in $receipt" >&2
    exit 1
  fi
  verified=$(launchctl getenv CODEX_CLI_PATH 2>/dev/null || true)
  if [ "$verified" != "$target" ]; then
    echo "launchctl override could not be verified. Restore command is in $receipt" >&2
    exit 1
  fi
  echo "Applied and verified launchctl CODEX_CLI_PATH. Receipt: $receipt"
  echo 'Restart Codex, then run doctor and native child acceptance. Manifest checks alone do not prove provider behavior.'
elif [ "$platform" = Linux ]; then
  export_command=$(python3 - "$target" <<'PY'
import shlex
import sys
print('export CODEX_CLI_PATH=' + shlex.quote(sys.argv[1]))
PY
)
  echo "For this shell session: $export_command"
  echo 'Start Codex from that shell, then run doctor. No global environment was changed.'
  if [ "$apply" -eq 1 ]; then
    echo '--apply does not change a Linux user environment; use the export command above.' >&2
    exit 69
  fi
else
  echo "Unsupported platform: $platform" >&2
  exit 69
fi

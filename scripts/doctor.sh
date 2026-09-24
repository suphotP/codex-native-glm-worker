#!/bin/sh
set -u

codex_home=${CODEX_HOME:-"$HOME/.codex"}
install_root=${NATIVE_GLM_INSTALL_ROOT:-"$codex_home/native-glm-worker"}
backend_dir=${NATIVE_GLM_BACKEND_PACKAGE:-"$codex_home/vendor_imports/codex-0.155.0-alpha.16-sol-glm"}
backend_bin="$backend_dir/bin/codex"
responses_port=${GLM_RESPONSES_BRIDGE_PORT:-47821}
failures=0

check() {
  label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label"
    failures=$((failures + 1))
  fi
}

check 'Codex CLI available on PATH (not active-backend proof)' command -v codex
check 'Bun available' command -v bun
check 'Python 3 available' command -v python3
check 'LiteLLM available' command -v litellm
check 'Codex config exists' test -f "$codex_home/config.toml"
check 'GLM worker role exists' test -f "$codex_home/agents/glm_worker.toml"
check 'Responses bridge installed' test -f "$install_root/bridge/responses-bridge.mjs"
check 'GLM-5.3 role model registered' grep -q '^model = "glm-5.3"$' "$codex_home/agents/glm_worker.toml"
check 'GLM role provider registered' grep -q '^model_provider = "zai_glm_native"$' "$codex_home/agents/glm_worker.toml"
check 'GLM role max reasoning registered' grep -q '^model_reasoning_effort = "max"$' "$codex_home/agents/glm_worker.toml"
check 'GLM role 1M context registered' grep -q '^model_context_window = 1000000$' "$codex_home/agents/glm_worker.toml"
check 'Native GLM agent registered' grep -q '^\[agents.glm_worker\]$' "$codex_home/config.toml"
check 'Native GLM provider registered' grep -q '^\[model_providers.zai_glm_native\]$' "$codex_home/config.toml"
check 'Responses bridge live' curl --silent --fail --max-time 3 "http://127.0.0.1:$responses_port/health/liveliness"
check 'Responses bridge ready' curl --silent --fail --max-time 3 "http://127.0.0.1:$responses_port/health/readiness"

if command -v python3 >/dev/null 2>&1; then
  if python3 - "$backend_dir" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import re
import sys

package = Path(sys.argv[1])
required = {
    'bin/codex', 'bin/codex-code-mode-host',
    'patches/codex-0.155.0-alpha.16-subagent-provider.patch',
    'source/codex-rs/Cargo.lock',
    'source/codex-rs/core/src/agent/role.rs',
    'source/codex-rs/core/src/agent/role_tests.rs',
}
try:
    if package.is_symlink() or not package.is_dir():
        raise ValueError('backend package is missing or linked')
    package = package.resolve(strict=True)
    manifest_path = package / 'manifest.json'
    sums_path = package / 'SHA256SUMS'
    if any(p.is_symlink() or not p.is_file() for p in (manifest_path, sums_path)):
        raise ValueError('backend manifest or SHA256SUMS is missing or linked')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if (manifest.get('schemaVersion') != 1 or
        manifest.get('package') != 'codex-native-glm-worker-backend' or
        manifest.get('sourceTag') != 'rust-v0.155.0-alpha.16' or
        manifest.get('sourceCommit') != '0e2f848bf4a4e8d41a02d848a851ba126c09d185' or
        manifest.get('providerId') != 'zai_glm_native'):
        raise ValueError('backend manifest ownership, provider or version differs')
    files = manifest.get('files')
    if not isinstance(files, dict) or set(files) != required:
        raise ValueError('required package files are not listed')
    if manifest.get('patchScope') != ['codex-rs/core/src/agent/role.rs', 'codex-rs/core/src/agent/role_tests.rs']:
        raise ValueError('backend patch scope differs')
    lock = manifest.get('lockNormalization')
    if not isinstance(lock, dict) or lock.get('path') != 'source/codex-rs/Cargo.lock' or lock.get('sha256') != files['source/codex-rs/Cargo.lock'].get('sha256'):
        raise ValueError('backend lock metadata differs')
    patch = manifest.get('patch')
    patch_path = 'patches/codex-0.155.0-alpha.16-subagent-provider.patch'
    if not isinstance(patch, dict) or patch.get('path') != patch_path or patch.get('sha256') != '577706c89b1c5c3436e7940d63ec1ea32d44e5e90b000410d89ee16423148b6b' or patch.get('sha256') != files[patch_path].get('sha256'):
        raise ValueError('backend patch metadata differs')
    sums = {}
    for line in sums_path.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match or match.group(2) in sums:
            raise ValueError('SHA256SUMS is malformed')
        sums[match.group(2)] = match.group(1)
    if set(sums) != set(files) | {'manifest.json'}:
        raise ValueError('SHA256SUMS and manifest list different files')
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != sums['manifest.json']:
        raise ValueError('manifest hash differs')
    for name, entry in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or name != relative.as_posix() or not isinstance(entry, dict):
            raise ValueError('unsafe manifest path')
        path = package / relative
        linked_component = any((package.joinpath(*relative.parts[:index])).is_symlink() for index in range(1, len(relative.parts) + 1))
        if linked_component or not path.is_file() or package not in path.resolve().parents:
            raise ValueError('package file is missing, linked or escapes the package')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry.get('sha256') or digest != sums[name]:
            raise ValueError('package file hash differs')
    if not os.access(package / 'bin/codex', os.X_OK) or not os.access(package / 'bin/codex-code-mode-host', os.X_OK):
        raise ValueError('backend binaries are not executable')
except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
    print(f'FAIL  Managed patched backend package: {exc}')
    sys.exit(1)
print('PASS  Backend package metadata, declared file hashes, and pinned patch digest')
PY
  then :; else failures=$((failures + 1)); fi
else
  printf 'FAIL  Managed patched backend package: Python 3 unavailable\n'
  failures=$((failures + 1))
fi

# Activation records the canonical binary path. Resolve harmless ancestor
# aliases such as /var -> /private/var before comparing runtime state.
if [ -d "$backend_dir" ] && [ ! -L "$backend_dir" ]; then
  backend_dir=$(CDPATH= cd -- "$backend_dir" && pwd -P)
  backend_bin="$backend_dir/bin/codex"
fi

platform=$(uname -s)
if [ "$platform" = Darwin ]; then
  current=$(launchctl getenv CODEX_CLI_PATH 2>/dev/null || true)
  if [ "$current" = "$backend_bin" ]; then
    printf 'PASS  launchctl CODEX_CLI_PATH points to managed backend\n'
  else
    printf 'FAIL  launchctl CODEX_CLI_PATH does not point to managed backend\n'
    if [ -n "$current" ]; then printf '      Current override: %s\n' "$current"; else printf '      Current override: (unset)\n'; fi
    failures=$((failures + 1))
  fi
fi

# A launchctl setting or a stock `codex --version` cannot prove what the
# desktop loaded. Require a running app-server, the managed inode, and on
# macOS a Codex/ChatGPT Desktop parent (not a standalone CLI shell).
if python3 - "$platform" "$backend_bin" <<'PY'
import os
from pathlib import Path
import re
import subprocess
import sys

platform, target = sys.argv[1:]
try:
    expected_inode = os.stat(target).st_ino
    if platform == 'Darwin':
        output = subprocess.run(['ps', '-axo', 'pid=,ppid=,comm='], capture_output=True, text=True, check=True).stdout
        candidates = []
        for line in output.splitlines():
            parts = line.strip().split(maxsplit=2)
            if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit() and parts[2] == target:
                candidates.append((int(parts[0]), int(parts[1])))
    elif platform == 'Linux':
        candidates = []
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit():
                continue
            try:
                executable = os.readlink(proc / 'exe')
            except OSError:
                continue
            if executable in (target, target + ' (deleted)'):
                candidates.append((int(proc.name), None))
    else:
        raise ValueError('unsupported process inspection platform')
    if not candidates:
        raise ValueError('no running Codex process uses the managed backend path')
    live = 0
    app_servers = 0
    desktop_children = 0
    for pid, ppid in candidates:
        if platform == 'Darwin':
            args = subprocess.run(['ps', '-ww', '-p', str(pid), '-o', 'args='], capture_output=True, text=True, check=True).stdout.strip()
            if not args.startswith(target + ' ') or 'app-server' not in args[len(target):].split():
                continue
            app_servers += 1
            parent = subprocess.run(['ps', '-p', str(ppid), '-o', 'comm='], capture_output=True, text=True, check=True).stdout.strip()
            if not re.search(r'/(?:Codex|ChatGPT)\.app/Contents/MacOS/(?:Codex|ChatGPT)$', parent):
                continue
            desktop_children += 1
            listed = subprocess.run(['lsof', '-nP', '-a', '-p', str(pid), '-d', 'txt', '-Fni'], capture_output=True, text=True, check=True).stdout
            inode = None
            for line in listed.splitlines():
                if line.startswith('i') and line[1:].isdigit():
                    inode = int(line[1:])
                elif line == 'n' + target and inode == expected_inode:
                    live += 1
                    break
        else:
            link = Path(f'/proc/{pid}/exe')
            try:
                arguments = (Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0'))
            except OSError:
                continue
            if b'app-server' not in arguments:
                continue
            app_servers += 1
            if link.exists() and os.stat(link).st_ino == expected_inode:
                live += 1
    if not app_servers:
        raise ValueError('managed binary is running, but no app-server process was found')
    if platform == 'Darwin' and not desktop_children:
        raise ValueError('managed app-server is not a Codex/ChatGPT Desktop child')
    if not live:
        raise ValueError('running process has an older/different binary inode; restart Codex')
except (OSError, ValueError, subprocess.SubprocessError) as exc:
    print(f'FAIL  Active app-server at configured backend path: {exc}')
    sys.exit(1)
scope = 'Desktop app-server' if platform == 'Darwin' else 'app-server'
print(f'PASS  Active {scope} at configured backend path: {live} matching process(es)')
PY
then :; else failures=$((failures + 1)); fi

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed. No secret values were printed." >&2
  exit 1
fi
echo 'Managed package app-server is running; GLM role/provider registration and bridge health checks pass. Native child acceptance is still a separate test.'

#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d)
cleanup() { find "$test_root" -depth -delete; }
trap cleanup EXIT INT TERM

bun "$repository_root/scripts/render-templates.mjs" \
  "$repository_root/service/macos/com.codex.native-glm-worker.plist.template" \
  "$test_root/service.plist" \
  '{"__INSTALL_ROOT__":"/tmp/native-glm-worker","__CODEX_HOME__":"/tmp/codex-home","__BUN_BIN__":"/opt/bin/bun","__LITELLM_BIN__":"/opt/bin/litellm"}'
python3 - "$test_root/service.plist" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as source:
    document = plistlib.load(source)
environment = document["EnvironmentVariables"]
assert environment["NATIVE_GLM_BUN_BIN"] == "/opt/bin/bun"
assert environment["NATIVE_GLM_LITELLM_BIN"] == "/opt/bin/litellm"
assert document["ProgramArguments"] == ["/tmp/native-glm-worker/bin/run"]
PY
grep -Fq 'managed-by: codex-native-glm-worker v1' "$test_root/service.plist"

bun "$repository_root/scripts/render-templates.mjs" \
  "$repository_root/service/linux/codex-native-glm-worker.service.template" \
  "$test_root/service.unit" \
  '{"__INSTALL_ROOT__":"/tmp/native-glm-worker","__BUN_BIN__":"/opt/bin/bun","__LITELLM_BIN__":"/opt/bin/litellm"}'
grep -Fxq 'ExecStart=/tmp/native-glm-worker/bin/run' "$test_root/service.unit"
grep -Fxq 'Environment=NATIVE_GLM_BUN_BIN=/opt/bin/bun' "$test_root/service.unit"
grep -Fxq 'Environment=NATIVE_GLM_LITELLM_BIN=/opt/bin/litellm' "$test_root/service.unit"
grep -Fq 'managed-by: codex-native-glm-worker v1' "$test_root/service.unit"
! grep -Eq '__[A-Z0-9_]+__' "$test_root/service.unit"

# The generic renderer refuses to follow an output symlink.
printf '%s\n' 'outside' > "$test_root/outside"
ln -s "$test_root/outside" "$test_root/render-link"
if bun "$repository_root/scripts/render-templates.mjs" \
  "$repository_root/service/linux/codex-native-glm-worker.service.template" \
  "$test_root/render-link" \
  '{"__INSTALL_ROOT__":"/tmp/native-glm-worker","__BUN_BIN__":"/opt/bin/bun","__LITELLM_BIN__":"/opt/bin/litellm"}' >/dev/null 2>&1; then
  echo "renderer followed an output symlink" >&2
  exit 1
fi
grep -Fxq 'outside' "$test_root/outside"

echo "SERVICE_TEMPLATE_TEST_PASS"

#!/bin/sh
set -eu
umask 077

account_name=${NATIVE_GLM_KEYCHAIN_ACCOUNT:-$(id -un)}
master_service=${NATIVE_GLM_MASTER_KEY_SERVICE:-ai.codex.native-glm.bridge-token}

if [ "$(uname -s)" = "Darwin" ]; then
  exec /usr/bin/security find-generic-password -a "$account_name" -s "$master_service" -w
fi

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
master_key=$(awk -F= '$1 == "LITELLM_MASTER_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$credentials_file")
case "$master_key" in
  ''|*[!A-Za-z0-9._-]*) echo "native GLM bridge token is invalid" >&2; exit 78 ;;
esac
printf '%s\n' "$master_key"

#!/bin/sh
# Build the pinned, source-backed Codex backend. See --help for options.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$script_dir/build-patched-codex.py" "$@"

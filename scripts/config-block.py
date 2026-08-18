#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import pathlib
import stat
import sys
import tempfile
import tomllib

START = "# BEGIN codex-native-glm-worker v1"
END = "# END codex-native-glm-worker v1"


def parse_toml(label: str, text: str) -> dict:
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise SystemExit(f"{label} is not valid TOML: {error}")


def refuse_symlink(label: str, path: pathlib.Path) -> None:
    if path.is_symlink():
        raise SystemExit(f"{label} must not be a symbolic link")


def atomic_write(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = pathlib.Path(temporary_name)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("check", "apply", "remove"))
    parser.add_argument("config", type=pathlib.Path)
    parser.add_argument("snippet", type=pathlib.Path, nargs="?")
    args = parser.parse_args()

    refuse_symlink("Codex config", args.config)
    existing = args.config.read_text() if args.config.exists() else ""
    if existing:
        parse_toml("Codex config", existing)

    if args.mode == "remove":
        if START not in existing and END not in existing:
            return 0
        if existing.count(START) != 1 or existing.count(END) != 1:
            raise SystemExit("managed config block is malformed; refusing removal")
        before, rest = existing.split(START, 1)
        _managed, after = rest.split(END, 1)
        candidate = (before.rstrip() + "\n" + after.lstrip()).strip() + "\n"
        if candidate.strip():
            parse_toml("config after managed block removal", candidate)
        atomic_write(args.config, candidate)
        return 0

    if args.snippet is None:
        raise SystemExit("snippet is required")
    refuse_symlink("native GLM snippet", args.snippet)
    snippet = args.snippet.read_text().strip()
    snippet_data = parse_toml("native GLM snippet", snippet)
    existing_data = parse_toml("Codex config", existing) if existing else {}
    managed_agent = existing_data.get("agents", {}).get("glm_worker")
    managed_provider = existing_data.get("model_providers", {}).get("zai_glm_native")
    if START in existing or END in existing:
        if existing.count(START) != 1 or existing.count(END) != 1:
            raise SystemExit("managed config block is malformed")
        before, rest = existing.split(START, 1)
        _managed, after = rest.split(END, 1)
        candidate = before.rstrip() + "\n\n" + START + "\n" + snippet + "\n" + END + "\n" + after.lstrip()
        parse_toml("updated Codex config", candidate)
        if args.mode == "apply":
            atomic_write(args.config, candidate)
        return 0
    if managed_agent is not None or managed_provider is not None:
        raise SystemExit("existing glm_worker or zai_glm_native config is unmanaged; refusing overwrite")
    if "agents" in snippet_data and not isinstance(snippet_data["agents"], dict):
        raise SystemExit("snippet agents table is invalid")

    candidate = existing.rstrip() + ("\n\n" if existing.strip() else "") + START + "\n" + snippet + "\n" + END + "\n"
    parse_toml("merged Codex config", candidate)
    if args.mode == "apply":
        atomic_write(args.config, candidate)
    return 0


if __name__ == "__main__":
    sys.exit(main())

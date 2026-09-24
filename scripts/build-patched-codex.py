#!/usr/bin/env python3
"""Build an inspectable Codex backend with the pinned native child-provider patch.

The default mode only prints a plan. --apply materializes source, builds both
binaries, and publishes an owned package after every verification has passed.
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

try:
    import tomllib
except ModuleNotFoundError as exc:
    raise SystemExit("Python 3.11 or newer is required to parse pinned Cargo manifests") from exc

TAG = "rust-v0.155.0-alpha.16"
VERSION = "0.155.0-alpha.16"
COMMIT = "0e2f848bf4a4e8d41a02d848a851ba126c09d185"
UPSTREAM = "https://github.com/openai/codex.git"
PROVIDER = "zai_glm_native"
PACKAGE_NAME = "codex-native-glm-worker-backend"
APP_RESOURCE_DIRS = (
    Path("/Applications/ChatGPT.app/Contents/Resources"),
    Path("/Applications/Codex.app/Contents/Resources"),
)
PATCH_SHA256 = "577706c89b1c5c3436e7940d63ec1ea32d44e5e90b000410d89ee16423148b6b"
PATCH_REL = "patches/codex-0.155.0-alpha.16-subagent-provider.patch"
ROLE_FILES = (
    "codex-rs/core/src/agent/role.rs",
    "codex-rs/core/src/agent/role_tests.rs",
)
LOCK_REL = "codex-rs/Cargo.lock"
EXPECTED_LOCK_CHANGES = 154
REPO = Path(__file__).resolve().parent.parent
PATCH = REPO / PATCH_REL


class BuildError(Exception):
    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category = category


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def command(argv: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None,
            category: str = "command") -> str:
    try:
        result = subprocess.run(argv, cwd=cwd, env=env, text=True, encoding="utf-8",
                                errors="replace", stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=True)
        return result.stdout.strip()
    except FileNotFoundError as exc:
        raise BuildError("toolchain", f"required executable is missing: {argv[0]}") from exc
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or "").strip().splitlines()
        tail = "\n".join(details[-18:])
        if category == "compile" and ("No space left on device" in tail or "Disk quota exceeded" in tail):
            category = "disk"
        raise BuildError(category, f"{' '.join(argv[:4])} exited {exc.returncode}\n{tail}") from exc


def ensure_safe_target(output: Path, source_input: Path | None, codex_home: Path) -> None:
    if not output.is_absolute():
        raise BuildError("stale-output", "output path must be absolute")
    if ".." in output.parts or (source_input and ".." in source_input.parts):
        raise BuildError("stale-output", "output and source paths must not contain parent traversal")
    if source_input and (source_input.is_symlink() or any(parent.is_symlink() for parent in source_input.parents)):
        raise BuildError("upstream-source", "source path must not contain a symbolic link")
    if any(parent.is_symlink() for parent in output.parents):
        raise BuildError("stale-output", "output ancestor must not be a symbolic link")
    real_output = output.resolve(strict=False)
    real_home = codex_home.resolve(strict=False)
    real_repo = REPO.resolve(strict=False)
    real_source = source_input.resolve(strict=False) if source_input else None
    if real_output == Path(real_output.anchor) or real_output in (Path.home().resolve(), real_home, real_repo):
        raise BuildError("stale-output", "output path is too broad")
    if output.exists() or output.is_symlink():
        raise BuildError("stale-output", f"output already exists; refusing to overwrite: {output}")
    if real_source and (real_output == real_source or real_source in real_output.parents
                        or real_output in real_source.parents):
        raise BuildError("stale-output", "output and input source directories must be separate")
    if real_output == real_repo or real_repo in real_output.parents:
        raise BuildError("stale-output", "output must be outside this repository")
    if any(part.endswith(".app") for part in real_output.parts):
        raise BuildError("stale-output", "output must be outside application bundles")


def ensure_pinned_patch() -> None:
    if not PATCH.is_file() or sha256(PATCH) != PATCH_SHA256:
        raise BuildError("patch", f"repository patch is missing or differs from pinned SHA-256: {PATCH}")
    text = PATCH.read_text(encoding="utf-8")
    paths = re.findall(r"^diff --git a/(\S+) b/(\S+)$", text, re.MULTILINE)
    if sorted(paths) != sorted((path, path) for path in ROLE_FILES):
        raise BuildError("patch", "provider patch changes files outside the two pinned role files")


def source_head(path: Path) -> str:
    return command(["git", "-C", str(path), "rev-parse", "HEAD"], category="upstream-source")


def check_source_input(source_input: Path) -> None:
    if not source_input.is_dir():
        raise BuildError("upstream-source", f"local source directory does not exist: {source_input}")
    if source_head(source_input) != COMMIT:
        raise BuildError("upstream-source", f"local source HEAD must be pinned commit {COMMIT}")
    dirty = command(["git", "-C", str(source_input), "status", "--porcelain",
                     "--untracked-files=normal"], category="upstream-source")
    if dirty:
        raise BuildError("upstream-source", "local source has changes; provide a clean pinned checkout")


def clone_source(source: Path, source_input: Path | None) -> None:
    if source_input:
        command(["git", "clone", "--quiet", "--no-local", "--no-checkout",
                 str(source_input), str(source)], category="upstream-source")
        command(["git", "-C", str(source), "checkout", "--quiet", "--detach", COMMIT],
                category="upstream-source")
        command(["git", "-C", str(source), "remote", "set-url", "origin", UPSTREAM],
                category="upstream-source")
    else:
        command(["git", "clone", "--quiet", "--depth", "1", "--branch", TAG,
                 UPSTREAM, str(source)], category="upstream-source")
    if source_head(source) != COMMIT:
        raise BuildError("upstream-source", f"upstream tag {TAG} did not resolve to {COMMIT}")


def apply_provider_patch(source: Path, package_patch: Path) -> None:
    shutil.copy2(PATCH, package_patch)
    command(["git", "-C", str(source), "apply", "--check", str(package_patch)],
            category="patch")
    command(["git", "-C", str(source), "apply", str(package_patch)], category="patch")
    changed = set(command(["git", "-C", str(source), "diff", "--name-only"],
                          category="patch").splitlines())
    if changed != set(ROLE_FILES):
        raise BuildError("patch", f"unexpected provider patch scope: {sorted(changed)}")


def local_workspace_packages(source: Path) -> dict[str, str]:
    root = source / "codex-rs"
    manifest = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf-8"))
    version = manifest["workspace"]["package"]["version"]
    if version != VERSION:
        raise BuildError("upstream-source", f"workspace version {version!r} != {VERSION!r}")
    packages: dict[str, str] = {}
    # The release lock also includes five local path crates excluded from
    # workspace.members. Inspect every manifest, not only declared members.
    for member_manifest in root.rglob("Cargo.toml"):
        if "target" in member_manifest.relative_to(root).parts:
            continue
        data = tomllib.loads(member_manifest.read_text(encoding="utf-8"))
        package = data.get("package")
        if not package:
            continue
        local_version = package.get("version")
        if isinstance(local_version, dict) and local_version.get("workspace") is True:
            local_version = version
        if local_version == VERSION:
            packages[package["name"]] = local_version
    if len(packages) < EXPECTED_LOCK_CHANGES:
        raise BuildError("upstream-source", "pinned workspace package inventory is incomplete")
    return packages


def normalize_local_lock(source: Path) -> int:
    """Change only source-less lock entries for pinned local workspace packages."""
    local = local_workspace_packages(source)
    lock = source / LOCK_REL
    original = lock.read_text(encoding="utf-8")
    blocks = re.split(r"(?=^\[\[package\]\]$)", original, flags=re.MULTILINE)
    changed = 0
    updated: list[str] = []
    for block in blocks:
        if not block.startswith("[[package]]"):
            updated.append(block)
            continue
        name_match = re.search(r'^name = "([^"]+)"$', block, re.MULTILINE)
        version_match = re.search(r'^version = "([^"]+)"$', block, re.MULTILINE)
        if not name_match or not version_match:
            raise BuildError("upstream-source", "Cargo.lock has an unrecognized package entry")
        name = name_match.group(1)
        if name in local and not re.search(r"^source = ", block, re.MULTILINE):
            if version_match.group(1) != "0.0.0":
                raise BuildError("upstream-source", f"unexpected lock version for local package {name}")
            start, end = version_match.span(1)
            block = block[:start] + VERSION + block[end:]
            changed += 1
        updated.append(block)
    if changed != EXPECTED_LOCK_CHANGES:
        raise BuildError("upstream-source", f"expected {EXPECTED_LOCK_CHANGES} local lock versions; found {changed}")
    lock.write_text("".join(updated), encoding="utf-8")
    if len(updated) != len(blocks):
        raise BuildError("upstream-source", "Cargo.lock reconstruction failed")
    return changed


def check_diff(source: Path) -> None:
    changed = set(command(["git", "-C", str(source), "diff", "--name-only"],
                          category="patch").splitlines())
    expected = set(ROLE_FILES) | {LOCK_REL}
    if changed != expected:
        raise BuildError("patch", f"patched source has unexpected changed files: {sorted(changed)}")
    command(["git", "-C", str(source), "diff", "--check"], category="patch")


def cargo_environment(target_dir: Path) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update({
        "CARGO_TARGET_DIR": str(target_dir),
        "CARGO_PROFILE_RELEASE_DEBUG": "0",
        "CARGO_PROFILE_RELEASE_LTO": "false",
        "CARGO_PROFILE_RELEASE_CODEGEN_UNITS": "16",
    })
    return environment


def check_toolchain(source: Path) -> None:
    for binary in ("git", "cargo", "rustc"):
        if not shutil.which(binary):
            raise BuildError("toolchain", f"{binary} is missing from PATH")
    version_line = command(["rustc", "--version"], cwd=source, category="toolchain")
    match = re.search(r"rustc (\d+)\.(\d+)\.(\d+)", version_line)
    if not match or tuple(map(int, match.groups())) < (1, 95, 0):
        raise BuildError("toolchain", f"Rust 1.95.0 or newer is required; found {version_line}")


def codesign_valid(path: Path) -> bool:
    if not shutil.which("codesign"):
        return False
    result = subprocess.run(["codesign", "--verify", "--strict", str(path)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            check=False)
    return result.returncode == 0


def matching_app_host(resource_dirs: tuple[Path, ...] = APP_RESOURCE_DIRS,
                      platform_name: str = sys.platform) -> tuple[Path, dict[str, object]] | None:
    """Return a signed host bundled with an installed app at this exact CLI version."""
    if platform_name != "darwin":
        return None
    for resources in resource_dirs:
        bundled_cli = resources / "codex"
        bundled_host = resources / "codex-code-mode-host"
        if any(not path.is_file() or path.is_symlink() or not os.access(path, os.X_OK)
               for path in (bundled_cli, bundled_host)):
            continue
        if not codesign_valid(bundled_cli) or not codesign_valid(bundled_host):
            continue
        try:
            bundled_version = command([str(bundled_cli), "--version"], category="app-host")
        except BuildError:
            continue
        if bundled_version != f"codex-cli {VERSION}":
            continue
        return bundled_host, {
            "kind": "app-bundled",
            "appResources": str(resources),
            "bundledCodexVersion": bundled_version,
            "bundledCodexSha256": sha256(bundled_cli),
            "codesignVerified": True,
        }
    return None


def build(source: Path, bin_dir: Path, target_dir: Path) -> dict[str, object]:
    env = cargo_environment(target_dir)
    print("BUILD codex-cli/codex", flush=True)
    command(["cargo", "build", "--locked", "--release", "-p", "codex-cli",
             "--bin", "codex"], cwd=source / "codex-rs", env=env, category="compile")
    built_cli = target_dir / "release" / "codex"
    if not built_cli.is_file():
        raise BuildError("compile", "cargo succeeded but codex is absent")
    shutil.copy2(built_cli, bin_dir / "codex")
    (bin_dir / "codex").chmod((bin_dir / "codex").stat().st_mode | 0o111)
    actual = command([str(bin_dir / "codex"), "--version"], category="compile")
    if actual != f"codex-cli {VERSION}":
        raise BuildError("compile", f"unexpected built CLI version: {actual!r}")
    app_host = matching_app_host()
    if app_host:
        host_path, origin = app_host
        print(f"HOST matching signed app resource: {host_path}", flush=True)
        shutil.copy2(host_path, bin_dir / "codex-code-mode-host")
        return origin
    print("HOST no matching signed installed app resource; compiling from pinned source", flush=True)
    try:
        command(["cargo", "build", "--locked", "--release", "-p", "codex-code-mode-host",
                 "--bin", "codex-code-mode-host"], cwd=source / "codex-rs", env=env,
                category="compile")
    except BuildError as exc:
        details = str(exc)
        if any(token in details for token in ("rusty_v8", "V8 prebuilt", "CERTIFICATE_VERIFY_FAILED")):
            raise BuildError(
                "v8-download",
                "code-mode host could not obtain the pinned rusty_v8 archive. "
                "On macOS, install the signed Codex app whose bundled codex reports "
                f"codex-cli {VERSION}; on other systems, make the matching V8 archive "
                "and CA certificates available before retrying. The upstream archive may "
                f"also be unavailable. Original failure:\n{details}",
            ) from exc
        raise
    built_host = target_dir / "release" / "codex-code-mode-host"
    if not built_host.is_file():
        raise BuildError("compile", "cargo succeeded but code-mode host is absent")
    shutil.copy2(built_host, bin_dir / "codex-code-mode-host")
    (bin_dir / "codex-code-mode-host").chmod(
        (bin_dir / "codex-code-mode-host").stat().st_mode | 0o111)
    return {"kind": "source-built", "sourceCommit": COMMIT,
            "package": "codex-code-mode-host"}


def write_receipt(staging: Path, source: Path, lock_changes: int,
                  host_origin: dict[str, object]) -> None:
    paths = ["bin/codex", "bin/codex-code-mode-host", PATCH_REL,
             *(f"source/{path}" for path in ROLE_FILES), f"source/{LOCK_REL}"]
    files = {path: {"sha256": sha256(staging / path)} for path in paths}
    host_origin = dict(host_origin)
    host_origin["hostSha256"] = files["bin/codex-code-mode-host"]["sha256"]
    manifest = {
        "schemaVersion": 1,
        "package": PACKAGE_NAME,
        "sourceTag": TAG,
        "sourceCommit": COMMIT,
        "sourceUrl": f"https://github.com/openai/codex/tree/{COMMIT}",
        "providerId": PROVIDER,
        "codeModeHostOrigin": host_origin,
        "patch": {"path": PATCH_REL, "sha256": PATCH_SHA256},
        "patchScope": list(ROLE_FILES),
        "lockNormalization": {
            "path": f"source/{LOCK_REL}",
            "localPackagesChanged": lock_changes,
            "from": "0.0.0",
            "to": VERSION,
            "sha256": files[f"source/{LOCK_REL}"]["sha256"],
            "externalDependenciesChanged": False,
        },
        "files": files,
    }
    (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n",
                                           encoding="utf-8")
    checksum_paths = [*paths, "manifest.json"]
    (staging / "SHA256SUMS").write_text(
        "".join(f"{sha256(staging / path)}  {path}\n" for path in checksum_paths),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="fetch, patch, build, and publish")
    parser.add_argument("--source-dir", type=Path,
                        help="optional clean local checkout at the pinned upstream commit")
    parser.add_argument("--output-dir", type=Path,
                        help="package destination (default: CODEX_HOME/vendor_imports/<version>)")
    parser.add_argument("--cargo-target-dir", type=Path,
                        help="optional reusable Cargo build cache outside the package")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    codex_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex").expanduser().absolute()
    output = (args.output_dir or codex_home / "vendor_imports" /
              f"codex-{VERSION}-sol-glm").expanduser().absolute()
    source_input = args.source_dir.expanduser().absolute() if args.source_dir else None
    target_dir = args.cargo_target_dir.expanduser().absolute() if args.cargo_target_dir else None
    plan = {
        "mode": "apply" if args.apply else "plan-only",
        "sourceTag": TAG,
        "sourceCommit": COMMIT,
        "sourceInput": str(source_input) if source_input else UPSTREAM,
        "outputDir": str(output),
        "patchedSourceDir": str(output / "source"),
        "binary": str(output / "bin" / "codex"),
        "codeModeHost": str(output / "bin" / "codex-code-mode-host"),
        "patchSha256": PATCH_SHA256,
        "outputAlreadyExists": output.exists() or output.is_symlink(),
        "cargoTargetDir": str(target_dir) if target_dir else "temporary outside package",
    }
    print(json.dumps(plan, indent=2), flush=True)
    if not args.apply:
        return 0
    staging: Path | None = None
    try:
        ensure_safe_target(output, source_input, codex_home)
        ensure_pinned_patch()
        if source_input:
            check_source_input(source_input)
        if target_dir and (target_dir == output or output in target_dir.parents
                           or target_dir == source_input
                           or (source_input and source_input in target_dir.parents)
                           or target_dir == REPO or REPO in target_dir.parents):
            raise BuildError("stale-output", "Cargo target cache must be separate from output/source")
        if target_dir and (".." in target_dir.parts or target_dir.is_symlink()
                           or any(parent.is_symlink() for parent in target_dir.parents)):
            raise BuildError("stale-output", "Cargo target cache must have a canonical non-linked path")
        output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.build-", dir=output.parent))
        source = staging / "source"
        (staging / "bin").mkdir()
        (staging / "patches").mkdir()
        print(f"FETCH {TAG}", flush=True)
        clone_source(source, source_input)
        print("PATCH pinned child provider", flush=True)
        apply_provider_patch(source, staging / PATCH_REL)
        lock_changes = normalize_local_lock(source)
        check_diff(source)
        print(f"LOCK normalized {lock_changes} local package versions", flush=True)
        check_toolchain(source)
        if target_dir:
            target_dir.mkdir(parents=True, exist_ok=True)
            host_origin = build(source, staging / "bin", target_dir)
        else:
            with tempfile.TemporaryDirectory(prefix=f".{output.name}.cargo-", dir=output.parent) as cache:
                host_origin = build(source, staging / "bin", Path(cache))
        write_receipt(staging, source, lock_changes, host_origin)
        ensure_safe_target(output, source_input, codex_home)
        staging.rename(output)
        staging = None
        print(f"READY binary={output / 'bin' / 'codex'}")
        print(f"READY source={output / 'source'}")
        print(f"READY manifest={output / 'manifest.json'}")
        return 0
    except BuildError as exc:
        if staging and staging.exists():
            failed = output.parent / f".{output.name}.failed-{int(time.time())}-{os.getpid()}"
            try:
                staging.rename(failed)
                print(f"FAILED_SOURCE={failed}", file=sys.stderr)
            except OSError:
                print(f"FAILED_SOURCE={staging}", file=sys.stderr)
        print(f"ERROR[{exc.category}]: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        category = "disk" if exc.errno in (errno.ENOSPC, errno.EDQUOT) else "filesystem"
        if staging and staging.exists():
            print(f"FAILED_SOURCE={staging}", file=sys.stderr)
        print(f"ERROR[{category}]: {exc}", file=sys.stderr)
        return 1
    except (KeyError, ValueError, UnicodeError) as exc:
        if staging and staging.exists():
            print(f"FAILED_SOURCE={staging}", file=sys.stderr)
        print(f"ERROR[upstream-source]: pinned source format mismatch: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

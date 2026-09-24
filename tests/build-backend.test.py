#!/usr/bin/env python3
"""Credential-free checks for the pinned source package builder."""

from __future__ import annotations

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from contextlib import redirect_stdout


REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "build-patched-codex.py"
spec = importlib.util.spec_from_file_location("backend_builder", SCRIPT)
assert spec and spec.loader
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BackendBuilderTests(unittest.TestCase):
    def test_plan_has_no_write_and_prints_pinned_source(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / "uncreated-home"
            env = dict(os.environ, CODEX_HOME=str(home))
            result = subprocess.run([str(REPO / "scripts" / "build-patched-codex.sh")],
                                    env=env, text=True, capture_output=True, check=True)
            plan = json.loads(result.stdout)
            self.assertEqual(plan["mode"], "plan-only")
            self.assertEqual(plan["sourceCommit"], builder.COMMIT)
            self.assertEqual(plan["patchSha256"], builder.PATCH_SHA256)
            self.assertEqual(plan["outputDir"], str(home / "vendor_imports" /
                                                     f"codex-{builder.VERSION}-sol-glm"))
            self.assertFalse(home.exists())

    def test_plan_never_probes_or_executes_app_binaries(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "new-package"
            with mock.patch.object(sys, "argv", [str(SCRIPT), "--output-dir", str(output)]), \
                 mock.patch.object(builder, "matching_app_host",
                                   side_effect=AssertionError("app binary was probed")), \
                 mock.patch.object(builder, "command",
                                   side_effect=AssertionError("subprocess was run")), \
                 redirect_stdout(io.StringIO()):
                self.assertEqual(builder.main(), 0)
            self.assertFalse(output.exists())

    def test_patch_is_exact_and_has_only_two_child_role_files(self):
        builder.ensure_pinned_patch()
        self.assertEqual(builder.sha256(builder.PATCH), builder.PATCH_SHA256)

    def test_tampered_patch_and_unsafe_target_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_root = Path(temp).resolve()
            patch = temp_root / "tampered.patch"
            patch.write_bytes(builder.PATCH.read_bytes() + b"\n")
            old_patch = builder.PATCH
            try:
                builder.PATCH = patch
                with self.assertRaisesRegex(builder.BuildError, "pinned SHA-256"):
                    builder.ensure_pinned_patch()
            finally:
                builder.PATCH = old_patch
            with self.assertRaisesRegex(builder.BuildError, "too broad"):
                builder.ensure_safe_target(temp_root, None, temp_root)
            with self.assertRaisesRegex(builder.BuildError, "outside this repository"):
                builder.ensure_safe_target(REPO / "generated-package", None, temp_root)
            aliased_repo_path = REPO / ".." / REPO.name / "generated-package"
            with self.assertRaisesRegex(builder.BuildError, "parent traversal"):
                builder.ensure_safe_target(aliased_repo_path, None, temp_root)
            real = temp_root / "real"
            real.mkdir()
            alias = temp_root / "alias"
            alias.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(builder.BuildError, "output ancestor"):
                builder.ensure_safe_target(alias / "newpkg", None, temp_root / "home")

    def test_existing_output_fails_before_source_or_toolchain_activity(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "existing"
            output.mkdir()
            (output / "keep.txt").write_text("keep", encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), "--apply",
                                     "--output-dir", str(output)],
                                    text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("ERROR[stale-output]", result.stderr)
            self.assertEqual((output / "keep.txt").read_text(encoding="utf-8"), "keep")
            self.assertEqual(sorted(path.name for path in output.iterdir()), ["keep.txt"])

    def test_missing_local_source_fails_before_output_is_created(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "new-package"
            missing = Path(temp) / "missing-source"
            result = subprocess.run([sys.executable, str(SCRIPT), "--apply",
                                     "--source-dir", str(missing), "--output-dir", str(output)],
                                    text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("ERROR[upstream-source]", result.stderr)
            self.assertFalse(output.exists())

    def test_local_lock_normalization_does_not_change_external_dependency(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            root = source / "codex-rs"
            root.mkdir()
            (root / "Cargo.toml").write_text(
                '[workspace]\nmembers = ["one", "two"]\n'
                f'[workspace.package]\nversion = "{builder.VERSION}"\n', encoding="utf-8")
            for name in ("one", "two"):
                member = root / name
                member.mkdir()
                (member / "Cargo.toml").write_text(
                    f'[package]\nname = "{name}"\nversion.workspace = true\n', encoding="utf-8")
            lock = root / "Cargo.lock"
            external = ('[[package]]\nname = "one"\nversion = "0.0.0"\n'
                        'source = "registry+https://example.test"\n'
                        'checksum = "unchanged"\n\n')
            lock.write_text('version = 4\n\n[[package]]\nname = "one"\nversion = "0.0.0"\n\n'
                            '[[package]]\nname = "two"\nversion = "0.0.0"\n\n' + external,
                            encoding="utf-8")
            old_count = builder.EXPECTED_LOCK_CHANGES
            try:
                builder.EXPECTED_LOCK_CHANGES = 2
                self.assertEqual(builder.normalize_local_lock(source), 2)
            finally:
                builder.EXPECTED_LOCK_CHANGES = old_count
            updated = lock.read_text(encoding="utf-8")
            self.assertEqual(updated.count(f'version = "{builder.VERSION}"'), 2)
            self.assertIn(external, updated)

    def test_matching_signed_app_host_uses_exact_version_and_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            resources = Path(temp) / "ChatGPT.app" / "Contents" / "Resources"
            resources.mkdir(parents=True)
            cli = resources / "codex"
            host = resources / "codex-code-mode-host"
            cli.write_text(f"#!/bin/sh\necho 'codex-cli {builder.VERSION}'\n", encoding="utf-8")
            host.write_text("#!/bin/sh\necho host\n", encoding="utf-8")
            cli.chmod(0o755)
            host.chmod(0o755)
            with mock.patch.object(builder, "codesign_valid", return_value=True):
                result = builder.matching_app_host((resources,), "darwin")
                self.assertIsNotNone(result)
                path, origin = result
                self.assertEqual(path, host)
                self.assertEqual(origin["kind"], "app-bundled")
                self.assertEqual(origin["bundledCodexSha256"], builder.sha256(cli))
                self.assertTrue(origin["codesignVerified"])
                self.assertIsNone(builder.matching_app_host((resources,), "linux"))
                cli.write_text("#!/bin/sh\necho 'codex-cli 0.0.0'\n", encoding="utf-8")
                self.assertIsNone(builder.matching_app_host((resources,), "darwin"))

    def test_app_host_skips_source_host_build(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            (source / "codex-rs").mkdir(parents=True)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            target = root / "target"
            (target / "release").mkdir(parents=True)
            built_cli = target / "release" / "codex"
            built_cli.write_text("built cli", encoding="utf-8")
            host = root / "app-host"
            host.write_text("matching signed host", encoding="utf-8")
            commands = []

            def fake_command(argv, **kwargs):
                commands.append(argv)
                if argv[-1] == "--version":
                    return f"codex-cli {builder.VERSION}"
                return ""

            with mock.patch.object(builder, "command", side_effect=fake_command), \
                 mock.patch.object(builder, "matching_app_host", return_value=(
                     host, {"kind": "app-bundled", "codesignVerified": True})):
                origin = builder.build(source, bin_dir, target)
            self.assertEqual(origin["kind"], "app-bundled")
            self.assertEqual((bin_dir / "codex-code-mode-host").read_text(),
                             "matching signed host")
            self.assertEqual(sum("cargo" == argv[0] for argv in commands), 1)

    def test_v8_download_failure_has_actionable_diagnostic(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            (source / "codex-rs").mkdir(parents=True)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            target = root / "target"
            (target / "release").mkdir(parents=True)
            (target / "release" / "codex").write_text("built cli", encoding="utf-8")

            def fake_command(argv, **kwargs):
                if argv[-1] == "--version":
                    return f"codex-cli {builder.VERSION}"
                if "codex-code-mode-host" in argv:
                    raise builder.BuildError("compile", "rusty_v8 SSL CERTIFICATE_VERIFY_FAILED")
                return ""

            with mock.patch.object(builder, "command", side_effect=fake_command), \
                 mock.patch.object(builder, "matching_app_host", return_value=None):
                with self.assertRaises(builder.BuildError) as raised:
                    builder.build(source, bin_dir, target)
            self.assertEqual(raised.exception.category, "v8-download")
            self.assertIn("matching V8 archive", str(raised.exception))
            self.assertIn("signed Codex app", str(raised.exception))

    def test_receipt_covers_binaries_patch_source_and_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            staging = Path(temp)
            names = ("bin/codex", "bin/codex-code-mode-host", builder.PATCH_REL,
                     *(f"source/{path}" for path in builder.ROLE_FILES),
                     f"source/{builder.LOCK_REL}")
            for name in names:
                path = staging / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")
            builder.write_receipt(staging, staging / "source", 154,
                                  {"kind": "app-bundled", "codesignVerified": True})
            manifest = json.loads((staging / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["sourceCommit"], builder.COMMIT)
            self.assertEqual(manifest["providerId"], builder.PROVIDER)
            self.assertEqual(set(manifest["files"]), set(names))
            self.assertEqual(manifest["lockNormalization"]["localPackagesChanged"], 154)
            self.assertEqual(manifest["codeModeHostOrigin"]["hostSha256"],
                             manifest["files"]["bin/codex-code-mode-host"]["sha256"])
            sums = (staging / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(sums), len(names) + 1)
            for line in sums:
                digest, rel = line.split("  ", 1)
                self.assertEqual(digest, builder.sha256(staging / rel))


if __name__ == "__main__":
    unittest.main()

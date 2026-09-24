# Installation

This kit has three parts: a patched Codex backend, a local Responses bridge, and the `glm_worker` role. Installing only the role and bridge does not make stock Codex `0.155.0-alpha.16` switch providers for a child.

## 1. Install prerequisites

Install Codex, Git, Rust 1.95.0 with Cargo, Bun 1.3.3+, Python 3.11+, and LiteLLM. The measured macOS path also uses the signed installed Codex/ChatGPT app whose bundled CLI reports exactly `0.155.0-alpha.16`, so its matching code-mode host can be copied. A CLI-only machine needs a qualified matching V8 source/archive path; the pinned macOS arm64 prebuilt host archive was unavailable in the measured run. Confirm the tools on `PATH`:

```bash
codex --version
git --version
rustc --version
cargo --version
bun --version
python3 --version
litellm --version
```

The patched backend is pinned to official source tag `rust-v0.155.0-alpha.16`, commit `0e2f848bf4a4e8d41a02d848a851ba126c09d185`. The measured macOS setup used Bun 1.3.3 and LiteLLM 1.96.2. Install the measured LiteLLM proxy version with the upstream-recommended `uv` tool flow:

```bash
uv tool install 'litellm[proxy]==1.96.2'
```

The source build downloads dependencies, takes time, and needs several GiB of temporary disk space. Later Codex/LiteLLM versions need their own bridge and native acceptance proof before being treated as compatible.

## 2. Run credential-free tests

```bash
bun run check
```

The battery uses fake services and temporary homes, including ports 47921/47925 for the bridge. It does not read a real API key.

## 3. Review the install plan

```bash
./scripts/install.sh
./scripts/build-patched-codex.sh
```

Use a disposable Codex home for the first applied test:

```bash
TEST_CODEX_HOME="$(mktemp -d)/.codex"
CODEX_HOME="$TEST_CODEX_HOME" ./scripts/install.sh --apply
CODEX_HOME="$TEST_CODEX_HOME" ./scripts/uninstall.sh --apply
```

## 4. Apply to your real Codex home

```bash
./scripts/install.sh --apply
./scripts/build-patched-codex.sh --apply
```

The installer refuses unmanaged conflicting agent/provider tables and saves a timestamped config backup.

The builder verifies the pinned upstream commit, applies the narrow child-provider source patch, normalizes only local workspace versions in `Cargo.lock`, builds the `codex` executable, and packages it with a matching code-mode host, the **full patched source**, a manifest, and SHA-256 checksums under `$CODEX_HOME/vendor_imports/codex-0.155.0-alpha.16-sol-glm`. On macOS it copies a code-mode host from a signed installed Codex app only when that app's bundled CLI reports exactly `0.155.0-alpha.16`; otherwise it attempts the host build from source. It never edits the signed app bundle. Optional `--source-dir ABS` accepts a clean checkout of the pinned commit; `--output-dir ABS` selects another new package path, and `--cargo-target-dir ABS` reuses a separate Cargo cache.

The host source build needs the pinned rusty_v8 prebuilt archive or a local V8 source build. The 150.4.0 macOS arm64 archive was unavailable in the measured run, so the matching signed app resource was used. A host build or certificate failure reports `ERROR[v8-download]` and preserves inspectable failed source without publishing a valid package. Do not treat that failed directory as an installed backend.

The generated block contains only `[agents.glm_worker]` and `[model_providers.zai_glm_native]`. It does not set a top-level/root model, change default agent selection, or modify any existing agent/provider table. The installer also copies the checkpoint helper and tool-discipline instructions used for long or interrupted child work.

## 5. Configure secrets

Use Keychain on macOS or a mode-600 credentials file on Linux as described in README. The Z.AI key and local bridge token are separate secrets. Generate and enter them yourself in a private terminal or password manager, never in assistant tool output.

Generate the local bridge token with `openssl rand -hex 32`. Never reuse the Z.AI key as the local token.

## 6. Start foreground and diagnose

```bash
~/.codex/native-glm-worker/bin/run
~/.codex/native-glm-worker/bin/doctor
```

## 7. Install a user service

```bash
./scripts/install-service.sh --apply
```

The installer resolves `bun` and `litellm` to absolute executable paths and pins those paths into the user-service definition. This avoids the reduced `PATH` commonly used by launchd and systemd user managers. Reinstall the service if either executable moves.

Restart Codex after agent/provider config changes.

## 8. Select the patched backend and prove it

After the bridge and package are ready, review and apply the activation plan on macOS:

```bash
./scripts/activate-backend.sh
./scripts/activate-backend.sh --apply
```

This validates the owned package and sets `CODEX_CLI_PATH` for the current GUI login session. Fully quit and reopen Codex, run doctor again, and follow [native acceptance](NATIVE_ACCEPTANCE.md). The acceptance check must show an OpenAI parent and a native `glm-5.3` / `zai_glm_native` child doing a real shell command and nonce round trip. A healthy bridge or fake test alone does not prove the child path.

The public bridge defaults to **zero upstream retries** because even a pre-stream failure can consume quota. `GLM_RESPONSES_MAX_TRANSIENT_RETRIES` explicitly enables bounded 502/503/504 and high-demand 429 retries. A usage-window 1308 reset several hours away also needs a longer `GLM_RESPONSES_UPSTREAM_TIMEOUT_MS` as well as a sufficient `GLM_RESPONSES_MAX_RETRY_DELAY_MS`; the default upstream deadline is 30 minutes. Fair Usage 1313 is terminal. See [troubleshooting](TROUBLESHOOTING.md).

429 error-body inspection has a separate deadline: `GLM_RESPONSES_ERROR_INSPECTION_TIMEOUT_MS` defaults to 2,000 ms (range 100–10,000). An oversized or stalled 429 returns a sanitized local `UPSTREAM_429_UNINSPECTABLE` without a retry. This is an unknown provider result, not an accepted child completion.

## Linux

The systemd user template reads `~/.config/codex-native-glm-worker/credentials.env`. Set it to mode 600 before starting the service.

On macOS, launchd writes redacted process output under `~/.codex/logs`. The bridge disables message/body logging, but operators should still include these files in normal local log-retention or disk-monitoring practice.

Stop any existing listener on the same bridge/LiteLLM ports before installing a second service. The service does not replace another listener automatically.

## Windows

Windows native Codex can use the same provider/agent TOML and bridge source, but this release does not claim a hardened automatic Windows service/credential installer. Use a temporary Codex home, configure a loopback LiteLLM/Bun process manually, and run all fake/native acceptance checks. Contributions should not claim parity without Credential Manager, service lifecycle, path, and teardown tests.

## Upgrade

Re-run credential-free tests and a temporary-home cycle before changing the backend pin or bridge. Stop the service, run `install.sh --apply`, inspect its marked config block, restart the service, run doctor, restart Codex, then repeat native acceptance. A new app-bundled Codex version needs a matching reviewed patch and code-mode host; this `0.155.0-alpha.16` package does not automatically patch future releases.

## Uninstall

```bash
./scripts/uninstall-service.sh --apply
./scripts/uninstall.sh --apply
```

Only manifest-owned files and the marked config block are removed. Backups and credentials are preserved.
The backend package is built separately, so review it separately before removing it. On macOS, `launchctl unsetenv CODEX_CLI_PATH` followed by a full Codex quit/reopen returns to the unmodified app-bundled backend, which does not contain the GLM child-provider patch.

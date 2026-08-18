# Installation

## 1. Install prerequisites

Install Codex, Bun, Python 3.11+, and LiteLLM. Confirm each is on `PATH`:

```bash
codex --version
bun --version
python3 --version
litellm --version
```

The repository was validated with Codex CLI 0.147.0, Bun 1.3.3, and LiteLLM 1.96.2. Install the measured LiteLLM proxy version with the upstream-recommended `uv` tool flow:

```bash
uv tool install 'litellm[proxy]==1.96.2'
```

Later versions may work, but repeat the full fake, temporary-home, foreground and native acceptance layers before treating an upgrade as compatible.

## 2. Run credential-free tests

```bash
bun run check:bridge
```

The test uses fake services and ports 47921/47925. It does not read a real API key.

## 3. Review the install plan

```bash
./scripts/install.sh
```

Use a disposable Codex home for the first applied test:

```bash
TEST_CODEX_HOME="$(mktemp -d)/.codex"
CODEX_HOME="$TEST_CODEX_HOME" ./scripts/install.sh --apply
CODEX_HOME="$TEST_CODEX_HOME" ./scripts/doctor.sh
```

## 4. Apply to your real Codex home

```bash
./scripts/install.sh --apply
```

The installer refuses unmanaged conflicting agent/provider tables and saves a timestamped config backup.

The generated block contains only `[agents.glm_worker]` and `[model_providers.zai_glm_native]`. It does not set a top-level/root model, change default agent selection, or modify any existing agent/provider table.

## 5. Configure secrets

Use Keychain on macOS or a mode-600 credentials file on Linux as described in README. The Z.AI key and local bridge token are separate secrets.

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

## Linux

The systemd user template reads `~/.config/codex-native-glm-worker/credentials.env`. Set it to mode 600 before starting the service.

On macOS, launchd writes redacted process output under `~/.codex/logs`. The bridge disables message/body logging, but operators should still include these files in normal local log-retention or disk-monitoring practice.

## Windows

Windows native Codex can use the same provider/agent TOML and bridge source, but this release does not claim a hardened automatic Windows service/credential installer. Use a temporary Codex home, configure a loopback LiteLLM/Bun process manually, and run all fake/native acceptance checks. Contributions should not claim parity without Credential Manager, service lifecycle, path, and teardown tests.

## Upgrade

Re-run credential-free tests, stop the service, run `install.sh --apply`, inspect the marked config block, restart the service, run doctor, restart Codex, then repeat native acceptance.

## Uninstall

```bash
./scripts/uninstall-service.sh --apply
./scripts/uninstall.sh --apply
```

Only manifest-owned files and the marked config block are removed. Backups and credentials are preserved.

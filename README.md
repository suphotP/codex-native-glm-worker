# Native GLM-5.3 workers for Codex

[![verify](https://github.com/suphotP/codex-native-glm-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/suphotP/codex-native-glm-worker/actions/workflows/ci.yml)

Run **GLM-5.3 as a real native Codex sub-agent**—created by Codex `spawn_agent`, visible in the Agents panel, and controlled through native message/wait/interrupt tools. This release targets Codex `0.155.0-alpha.16` and includes the source patch needed to select GLM only for that child role.

This is not `codex exec`, not a second CLI hidden in a shell, not an external controller, and not a custom agent orchestrator. Codex remains the parent runtime. A small loopback bridge translates the API protocol only.

## GLM is optional—not a replacement

This kit adds one extra native agent type named `glm_worker`. It does **not** change the root model, default sub-agent, existing agent roles, or their providers. All native Codex agents you already use remain available exactly as before. The modified Codex executable is built from a pinned upstream source commit; only the child-provider override path receives a code change.

- Omit `agent_type="glm_worker"` and Codex uses its normal/default agent behavior.
- Select any existing native role and that role keeps its existing model/provider.
- Select `agent_type="glm_worker"` only for a task you intentionally want to send to GLM-5.3.
- Mix OpenAI-backed and GLM-backed children in the same root task when the work divides honestly.
- Uninstalling this kit removes only its marked `glm_worker`/`zai_glm_native` configuration and managed files.

The intended pattern is **Codex root + whichever native sub-agents fit the task + optional GLM workers for bounded bulk work**. It is not an all-or-nothing provider switch.

> Status: the `0.155.0-alpha.16` backend patch and native GLM child were tested on macOS arm64 with a GPT-6 Sol parent. The repository bridge and installer have credential-free tests. Linux needs a live native machine check; Windows setup is manual. Use a separate test Codex home first.

## Current backend and source

The bundled backend builder pins OpenAI Codex source tag `rust-v0.155.0-alpha.16` at commit `0e2f848bf4a4e8d41a02d848a851ba126c09d185`. The [child-provider patch](patches/codex-0.155.0-alpha.16-subagent-provider.patch) permits exactly the configured `zai_glm_native` provider for a custom child role. It preserves the parent's OpenAI provider and blocks other role-supplied providers. The repository includes the patch and build script; `--apply` also materializes the **full patched source** beside the runnable binary and records checksums. On macOS, the builder uses a signed code-mode host from an installed Codex app only when its bundled CLI reports the exact pinned version; otherwise it attempts to build the host from source. No private credentials or compiled binary are committed.

Stock Codex `0.155.0-alpha.16` does not apply this custom child provider override. Installing only the agent TOML and bridge therefore does not complete the setup. Build the pinned backend, select it with `CODEX_CLI_PATH`, and restart Codex. A later Codex app update needs a new pinned source review, patch and native proof before changing the version in this repository.

## Why this is worth doing

Frontier Codex models are excellent root integrators, reviewers, and UI owners—but using the same expensive model for every repository census, backend implementation, migration, test repair, and independent review can burn premium capacity quickly.

GLM-5.3 is unusually useful for this worker role:

- large 1,000,000-token context;
- strong repository reading and long-horizon implementation;
- native shell/tool use through Codex;
- up to four parallel workers without four premium Codex threads doing all the bulk work;
- materially lower worker cost for high-volume non-UI tasks;
- root Codex keeps the judgment-heavy work: architecture, integration, UI, Git, live proof, and final acceptance.

### A real workload anecdote—not a guarantee

The setup came from a production-minded repository workflow where routing bounded worker packets to native GLM-5.3 children reduced pressure on premium Codex capacity.

That is one workload, not a benchmark or savings promise. Pricing, plan quotas, peak-hour multipliers, model quality, and account eligibility change. Compare current terms with your own workload before spending money.

## What “native” means

```text
OpenAI Codex root
  └─ native spawn_agent(agent_type="glm_worker")
       └─ native Codex child thread/session
            ├─ native shell and workspace tools
            ├─ native message / follow-up / wait / interrupt lifecycle
            ├─ visible in Codex Agents UI
            └─ model provider: local Responses bridge -> Z.AI GLM-5.3
```

The bridge does not plan, delegate, edit files, own tools, or impersonate a child. It only lets Codex speak its Responses wire protocol to a local LiteLLM adapter that targets Z.AI's OpenAI-compatible Coding endpoint.

## Why a bridge is needed

Codex custom model providers expect a Responses-compatible endpoint. Z.AI's Coding Plan exposes an OpenAI-compatible Chat Completions endpoint. LiteLLM performs the protocol translation; the bundled loopback Responses bridge adds:

- loopback-only binding;
- bearer authentication;
- health/readiness endpoints;
- request-size and concurrency limits;
- long-turn timeout handling;
- optional bounded pre-body retry;
- streaming pass-through;
- redacted errors and no body logging;
- explicit 429 usage-window and fair-usage handling, plus bounded opt-in 502/503/504 and high-demand retries;
- fail-closed `UPSTREAM_429_UNINSPECTABLE` when a 429 body is oversized or stalls during a short error-inspection deadline;
- narrow stops for repeated no-progress native tool loops;
- one supervisor fate for both local processes.

Z.AI documents the dedicated Coding endpoint as `https://api.z.ai/api/coding/paas/v4`, distinct from the General API. Its current tool guide explicitly lists Codex as supported. See [Other Tools](https://docs.z.ai/scenario-example/develop-tools/others) and [Tool Integration](https://docs.z.ai/devpack/tool/others).

Z.AI now also documents a direct OpenAI Responses endpoint at `https://api.z.ai/api/v1`. This kit intentionally retains the measured Chat-compatible bridge path: Z.AI's [GLM-5.3 guide](https://docs.z.ai/guides/llm/glm-5.3) says some previously subscribed accounts currently receive model API access only through the Chat Completions-compatible protocol. A future direct mode should not replace the proven path until it passes the same native 1+4, tool, stream, quota and teardown acceptance.

Z.AI also limits Coding Plan quota to eligible tools/scenarios and warns that unsupported usage may be restricted. Verify your current plan and tool eligibility in the [Usage Policy](https://docs.z.ai/devpack/usage-policy). This project does not bypass quota, eligibility, risk controls, or account rules and must not be operated as a proxy service for other people.

## Requirements

- Codex desktop/CLI version with native multi-agent roles and `spawn_agent` support;
- for the measured macOS build, a signed installed Codex/ChatGPT app whose bundled CLI reports exactly `0.155.0-alpha.16`; a CLI-only machine needs a working matching V8 source/archive path for the code-mode host;
- Rust 1.95.0 and Git to build the pinned Codex source;
- Bun 1.3.3+;
- Python 3.11+;
- LiteLLM CLI;
- a Z.AI account with **GLM-5.3** access and current eligible Coding Plan/API usage;
- macOS or Linux for automated service setup.

The current macOS acceptance used the patched Codex CLI `0.155.0-alpha.16`, Bun 1.3.3, and LiteLLM 1.96.2. See [Validation](docs/VALIDATION.md) for exactly which layers were measured, and [Installation](docs/INSTALLATION.md) for prerequisite and build steps.

This kit intentionally pins `glm-5.3`. It does not silently fall back to an older GLM model because the quality difference matters for large coding tasks.

Z.AI currently documents GLM-5.3 as text-only with a 1M-token context, maximum 128K output, always-on reasoning and `low`/`high`/`max` effort. The role and upstream configuration pin `max`.

## Safe quick start

Clone the repository, then test it in a temporary Codex home first:

```bash
git clone https://github.com/suphotP/codex-native-glm-worker.git
cd codex-native-glm-worker

# All credential-free protocol, installer, source-build and activation checks.
bun run check

# Plans only; these do not mutate your Codex home.
CODEX_HOME="$(mktemp -d)/.codex" ./scripts/install.sh
./scripts/build-patched-codex.sh
```

Install the managed role/bridge files and build the patched backend after reviewing those plans:

```bash
./scripts/install.sh --apply
./scripts/build-patched-codex.sh --apply
```

Configure the Z.AI and local bridge credentials, start the bridge, then select the validated backend. On macOS, `./scripts/activate-backend.sh` prints the planned `CODEX_CLI_PATH` change; `--apply` selects it for the current GUI login session. Quit and reopen Codex, then run `scripts/doctor.sh` and the native acceptance flow below. Linux users can launch Codex with the printed `CODEX_CLI_PATH` environment value. [Installation](docs/INSTALLATION.md) covers the full order and safe rollback.

The installer:

- backs up an existing `config.toml`;
- refuses unmanaged `glm_worker` or `zai_glm_native` entries;
- installs an exact native role file;
- appends one marked TOML block only after strict TOML validation;
- installs the optional skill and filesystem assignment-envelope directory;
- installs a checkpoint helper and tool-discipline instructions for retries and long tasks;
- never asks for or writes your Z.AI key.

It does not edit any root/default model selection or any unrelated agent/provider table. The backend builder also leaves the signed Codex application bundle untouched.

### Already running a native GLM setup?

This installer does not adopt unmanaged `glm_worker` or `zai_glm_native` entries, and the builder will not overwrite an existing backend package. Keep a working setup running while you test this repository with a temporary `CODEX_HOME`. If you want a second source-backed package, use a fresh `--output-dir` and review its manifest before selecting it with `activate-backend.sh --package ABS --apply`. Reconcile existing role, bridge service and credential names separately; do not delete a working install until its replacement passes native acceptance.

Read [Installation](docs/INSTALLATION.md) before configuring secrets or a background service.

## Configure secrets

### macOS Keychain

Store the Z.AI key without putting it in shell history:

```bash
/usr/bin/security add-generic-password -U -a "$USER" -s ai.z.native-glm.api-key -w
```

Create a separate random local bridge token **in your own terminal or password manager**, then store it using the same prompt-only pattern. Do not run the generation command through an assistant tool that records stdout:

```bash
openssl rand -hex 32
/usr/bin/security add-generic-password -U -a "$USER" -s ai.codex.native-glm.bridge-token -w
```

Paste the generated token at the Keychain prompt. Do not paste it into a Codex chat/tool output or pass it as a command-line argument.

### Linux

Copy `service/linux/credentials.env.example` to:

```text
~/.config/codex-native-glm-worker/credentials.env
```

Set real values and run `chmod 600` on the file. Never commit it.

## Start and diagnose

Run in the foreground first:

```bash
~/.codex/native-glm-worker/bin/run
~/.codex/native-glm-worker/bin/doctor
```

Then install a user service:

```bash
./scripts/install-service.sh --apply
```

Restart Codex after changing `config.toml` or agent-role files.

## Prove the child is native

Inside a Codex root thread, create a plain-text assignment envelope named exactly after the task:

```text
~/.codex/glm-native-assignments/native_accept_1.md
```

Then ask the root to call native multi-agent tooling:

```text
spawn_agent(
  agent_type="glm_worker",
  fork_turns="none",
  task_name="native_accept_1",
  message="Read the exact assignment envelope, echo its nonce, run pwd and git status, and report model/provider metadata."
)
```

Acceptance requires:

1. the child appears in the native Agents panel;
2. the nonce round-trips from the filesystem envelope;
3. the child uses native shell tools for `pwd`, Git status, a focused test, and Docker client/server metadata;
4. root metadata remains OpenAI while child role/model is GLM-5.3;
5. no `codex exec` or external controller exists in the path;

A separate concurrency check can add four distinct children when quota and the current platform limit permit. The single native child is the minimum functional proof.

See [Native acceptance](docs/NATIVE_ACCEPTANCE.md).

## Use it well

GLM-5.3 is most valuable for cohesive, bounded worker packets:

- repository exploration and source census;
- backend implementation;
- migrations and infrastructure;
- focused test repair;
- adversarial read-only review;
- long documentation or compatibility inventories.

It is not automatically trustworthy. In our use:

- source exploration and bounded implementation were strong;
- architecture/product judgment needed correction;
- oversized tasks sometimes hit 502, high-demand, or stream disconnects;
- filesystem assignment envelopes prevented encrypted/rich parent history from breaking Z.AI's text-only message surface;
- incremental report checkpoints prevented lost work;
- staggering two large workers was more stable than launching four simultaneously during peak demand.

The root integrator must still read every diff/report, run decisive gates, and own commits, pushes, deployments, UI, live proof, and acceptance.

## Repository map

```text
bridge/      loopback Responses facade + LiteLLM example config
templates/   native agent role and Codex config snippet
patches/     pinned child-provider source patch for Codex 0.155.0-alpha.16
scripts/     source build, activation, install, uninstall, service, doctor, auth and fake tests
service/     launchd/systemd templates
skill/       optional Codex workflow skill
tests/       credential-free regressions and static checks
fixtures/    native assignment examples
docs/        architecture, security, troubleshooting and operations
```

## Security boundary

- Never commit API keys or bridge tokens.
- Bind local services to loopback only.
- Do not expose the bridge over LAN, public ingress, or a shared proxy.
- One Coding Plan belongs to its account holder; do not share it or sell proxy access.
- Treat GLM output as untrusted.
- Do not let workers self-commit, self-push, self-deploy, or self-approve by default.
- Use `fork_turns="none"`; rich OpenAI parent content can be incompatible with Z.AI's text-only Chat Completions messages.
- Back up and validate Codex config before editing it.

Read [Security](docs/SECURITY.md) and [Troubleshooting](docs/TROUBLESHOOTING.md).

## Non-goals

- replacing Codex root judgment;
- bypassing Z.AI or OpenAI plan rules;
- account sharing or a hosted inference proxy;
- a custom agent controller;
- automatic Git/deploy authority;
- a guarantee that GLM is better for every task;
- a promise of unlimited or fixed-price usage.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Installation](docs/INSTALLATION.md)
- [Native acceptance](docs/NATIVE_ACCEPTANCE.md)
- [Assignment envelopes](docs/ASSIGNMENTS.md)
- [Cost and limits](docs/COSTS_AND_LIMITS.md)
- [Security](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Validation record](docs/VALIDATION.md)

The Codex App Server is documented by OpenAI as the interface for deep integrations with authentication, history, approvals, and streamed agent events: [Codex App Server](https://developers.openai.com/codex/app-server).

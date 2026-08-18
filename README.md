# Native GLM-5.3 workers for Codex

Run **GLM-5.3 as a real native Codex sub-agent**—created by Codex `spawn_agent`, visible in the Agents panel, and controlled through native message/wait/interrupt tools.

This is not `codex exec`, not a second CLI hidden in a shell, not an external controller, and not a custom agent orchestrator. Codex remains the parent runtime. A small loopback bridge translates the API protocol only.

> Status: early public integration kit. macOS is the most exercised path; Linux is supported by scripts and needs broader machine coverage. Windows setup is currently manual. Use a separate test Codex home first.

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

The setup came from a production-minded repository workflow that previously exhausted the practical weekly allowance of **three separate $200/month Codex accounts**. After routing bounded non-UI worker packets to native GLM-5.3 children, the same operator has been comfortable with **one $200/month Codex account plus GLM capacity**.

That is one workload, not a benchmark or savings promise. Pricing, plan quotas, peak-hour multipliers, model quality, and account eligibility change. Do not buy a plan solely from this anecdote.

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
- one supervisor fate for both local processes.

Z.AI documents the dedicated Coding endpoint as `https://api.z.ai/api/coding/paas/v4`, distinct from the General API. Its current tool guide explicitly lists Codex as supported. See [Other Tools](https://docs.z.ai/scenario-example/develop-tools/others) and [Tool Integration](https://docs.z.ai/devpack/tool/others).

Z.AI now also documents a direct OpenAI Responses endpoint at `https://api.z.ai/api/v1`. This kit intentionally retains the measured Chat-compatible bridge path: Z.AI's [GLM-5.3 guide](https://docs.z.ai/guides/llm/glm-5.3) says some previously subscribed accounts currently receive model API access only through the Chat Completions-compatible protocol. A future direct mode should not replace the proven path until it passes the same native 1+4, tool, stream, quota and teardown acceptance.

Z.AI also limits Coding Plan quota to eligible tools/scenarios and warns that unsupported usage may be restricted. Verify your current plan and tool eligibility in the [Usage Policy](https://docs.z.ai/devpack/usage-policy). This project does not bypass quota, eligibility, risk controls, or account rules and must not be operated as a proxy service for other people.

## Requirements

- Codex desktop/CLI version with native multi-agent roles and `spawn_agent` support;
- Bun 1.2+;
- Python 3.11+;
- LiteLLM CLI;
- a Z.AI account with **GLM-5.3** access and current eligible Coding Plan/API usage;
- macOS or Linux for automated service setup.

The published validation used Codex CLI 0.147.0, Bun 1.3.3, and LiteLLM 1.96.2. See [Installation](docs/INSTALLATION.md) for the reproducible LiteLLM command and upgrade rule.

This kit intentionally pins `glm-5.3`. It does not silently fall back to an older GLM model because the quality difference matters for large coding tasks.

Z.AI currently documents GLM-5.3 as text-only with a 1M-token context, maximum 128K output, always-on reasoning and `low`/`high`/`max` effort. The role and upstream configuration pin `max`.

## Safe quick start

Clone the repository, then test it in a temporary Codex home first:

```bash
git clone https://github.com/suphotP/codex-native-glm-worker.git
cd codex-native-glm-worker

# Credential-free protocol tests on ports 47921/47925.
bun run check:bridge

# Plan only. This writes nothing.
CODEX_HOME="$(mktemp -d)/.codex" ./scripts/install.sh
```

Install into your real Codex home only after reviewing the plan:

```bash
./scripts/install.sh --apply
```

The installer:

- backs up an existing `config.toml`;
- refuses unmanaged `glm_worker` or `zai_glm_native` entries;
- installs an exact native role file;
- appends one marked TOML block only after strict TOML validation;
- installs the optional skill and filesystem assignment-envelope directory;
- never asks for or writes your Z.AI key.

Read [Installation](docs/INSTALLATION.md) before configuring secrets or a background service.

## Configure secrets

### macOS Keychain

Store the Z.AI key without putting it in shell history:

```bash
/usr/bin/security add-generic-password -U -a "$USER" -s ai.z.native-glm.api-key -w
```

Create a separate random local bridge token, then store it using the same prompt-only pattern:

```bash
openssl rand -hex 32
/usr/bin/security add-generic-password -U -a "$USER" -s ai.codex.native-glm.bridge-token -w
```

Paste the generated token at the Keychain prompt. Do not pass a secret as a command-line argument.

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
6. four distinct children can run concurrently when quota permits.

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
scripts/     install, uninstall, service, doctor, auth and fake tests
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

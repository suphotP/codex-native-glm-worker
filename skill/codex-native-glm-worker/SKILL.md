---
name: codex-native-glm-worker
description: Install, verify, troubleshoot, and operate GLM-5.3 as a native Codex sub-agent through spawn_agent, a filesystem assignment envelope, and the local Responses-to-Z.AI Coding bridge. Use when a user asks for native GLM workers, cheaper parallel Codex delegation, GLM worker setup, bridge/429/502 diagnosis, native child proof, or safe task assignment. Never use this skill to substitute codex exec, an external controller, or a shell pseudo-agent for native Codex multi-agent sessions.
---

# Native GLM Worker

Use Codex as the root integrator and GLM-5.3 as a native child for bounded bulk work. Treat every GLM result as untrusted until the root inspects and verifies it.

## Choose the workflow

- Install or upgrade: follow **Install safely**.
- Check an existing setup: follow **Diagnose**, then **Prove native identity**.
- Delegate repository work: follow **Create an assignment**.
- Handle 429/502/stream failures: read [references/troubleshooting.md](references/troubleshooting.md).
- Review trust and credential boundaries: read [references/security.md](references/security.md).

## Install safely

1. Locate the integration-kit repository.
2. Run its credential-free test: `bun run check:bridge`.
3. Run `scripts/install.sh` without `--apply`; report the exact plan.
4. Apply first with a temporary `CODEX_HOME`.
5. Verify generated TOML, role values, file modes, and absence of secrets.
6. Only with user approval, run the real `--apply` install.
7. Configure Keychain or a mode-600 credentials file without printing values.
8. Start foreground, run doctor, then install the user service.
9. Restart Codex and prove native identity.

Never overwrite unmanaged agent/provider tables or edit an existing TOML with string replacement. Preserve backups and rollback paths.

## Diagnose

Run:

```bash
"${CODEX_HOME:-$HOME/.codex}/native-glm-worker/bin/doctor"
```

If health is red, run the credential-free installed self-test on alternate ports:

```bash
bun "${CODEX_HOME:-$HOME/.codex}/native-glm-worker/bin/self-test.mjs"
```

Do not expose secret values in logs or responses.

## Create an assignment

1. Choose one exact `task_name` using lowercase letters, numbers, and underscores.
2. Create `<CODEX_HOME>/glm-native-assignments/<task_name>.md` before spawning.
3. Include an absolute `WORKTREE`, ownership, complete bounded outcome, commands/proof, stops, and unique nonce.
4. Use an isolated worktree for editing tasks and non-overlapping paths for parallel workers.
5. Call native `spawn_agent` with:
   - `agent_type: "glm_worker"`
   - `fork_turns: "none"`
   - the exact `task_name`
   - a short message pointing to the envelope.
6. Confirm the child appears in the native agent tree and echoes the nonce.
7. Use native message/follow-up/wait/interrupt tools; never `codex exec` or another controller.
8. On completion, inspect every changed byte/report and rerun decisive tests as root.

Read [references/delegation.md](references/delegation.md) for packet sizing, parallelism, checkpoints, and review.

## Prove native identity

Read [references/native-acceptance.md](references/native-acceptance.md), then require:

- native child ID and Agents UI/session-tree presence;
- GLM-5.3 role/provider metadata;
- filesystem nonce match;
- native shell tool output;
- root remains OpenAI;
- no external Codex process/controller;
- one-child proof before four-child concurrency.

Fake bridge tests do not prove native child creation.

## Operating rules

- Pin model exactly `glm-5.3`, effort `max`, context `1000000`.
- Use `fork_turns="none"`; rich inherited content may be rejected by the text-only provider path.
- Prefer cohesive bounded packets. Split unrelated boundaries, not the quality bar.
- Ask long-report workers to write incremental checkpoints.
- Stagger large workers during high demand; use up to four only when work divides honestly.
- Preserve user changes. Keep stage/commit/push/deploy/final approval with root by default.
- Never claim unlimited quota or guaranteed savings.
- Verify current Z.AI Coding Plan/tool eligibility before use.

---
name: codex-native-glm-worker
description: Install, build, verify, troubleshoot, and operate GLM-5.3 as a native Codex sub-agent through spawn_agent, a pinned child-provider backend patch, a filesystem assignment envelope, and a local Responses-to-Z.AI Coding bridge. Use for native GLM setup, source builds, bridge/429/502 diagnosis, native child proof, or safe task assignment. Never substitute codex exec, an external controller, or a shell pseudo-agent for native Codex multi-agent sessions.
---

# Native GLM Worker

Use Codex as the root integrator and GLM-5.3 as a native child for bounded bulk work. Treat every GLM result as untrusted until the root inspects and verifies it.

The role is additive and optional. Never imply that installation replaces the root model, default sub-agents, or existing native roles. GLM is selected only by an explicit `agent_type: "glm_worker"`; other native agents remain available and may be mixed in the same root task.

## Choose the workflow

- Install or upgrade: follow **Install safely**, including the pinned backend source build.
- Check an existing setup: follow **Diagnose**, then **Prove native identity**.
- Delegate repository work: follow **Create an assignment**.
- Handle 429/502/stream failures: read [references/troubleshooting.md](references/troubleshooting.md).
- Review trust and credential boundaries: read [references/security.md](references/security.md).

## Install safely

1. Locate the integration-kit repository.
2. Run `bun run check` for credential-free bridge, checkpoint, installer, builder and activation checks.
3. Run `scripts/install.sh` and `scripts/build-patched-codex.sh` without `--apply`; report their plans. The builder pins official Codex `rust-v0.155.0-alpha.16` and includes a two-file child-provider source patch.
4. Apply the managed installer in a temporary `CODEX_HOME`, then run its scoped uninstaller there. Verify generated TOML, role values, file modes, checkpoint helper and absence of secrets.
5. When the user's task authorizes installing on the real Codex home, run `install.sh --apply` and `build-patched-codex.sh --apply`. Inspect the built package manifest and patched source; refuse conflicts rather than overwriting an existing output or unmanaged role/provider table.
6. Have the human create and enter the Z.AI and bridge credentials in Keychain or a mode-600 credentials file. Never generate/print a bridge token in assistant tool output or pass either secret in an argument. Start the bridge in the foreground, run health checks, then install the user service.
7. Run `activate-backend.sh` as a plan and `--apply` when authorized. It selects the validated patched executable without changing the signed app. Fully quit/reopen Codex, then run doctor.
8. Prove native identity with an OpenAI parent and a GLM native child. A healthy bridge or a model-name check alone is not this proof.

Never overwrite unmanaged agent/provider tables or edit an existing TOML with string replacement. Preserve backups and rollback paths.
An existing native GLM install is not automatically adopted by this kit. Test it with a temporary `CODEX_HOME`; use a new backend `--output-dir` if the default package exists, and reconcile any current service/config separately before activation.

## Diagnose

Run after selecting and restarting the patched backend:

```bash
"${CODEX_HOME:-$HOME/.codex}/native-glm-worker/bin/doctor"
```

The doctor must confirm the running patched executable and its inode, the provider/role registration, and bridge health. If health is red, run the credential-free installed self-test on alternate ports:

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
7. Initialize or resume the installed `bin/checkpoint.mjs` after the worktree check. The task state must retain the current stage and next action across 429/502 or turn boundaries; completion is an untrusted handoff.
8. Use native message/follow-up/wait/interrupt tools; never `codex exec` or another controller.
9. On completion, inspect every changed byte/report and rerun decisive tests as root.

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
- Keep retry classes separate: usage-window 1308 has a reset boundary, Fair Usage 1313 is terminal, and a `GLM_TOOL_LOOP_*` stop needs an owner-corrected envelope. Never change providers or silently rerun unchanged work.
- Prefer cohesive bounded packets. Split unrelated boundaries, not the quality bar.
- Ask long-report workers to write incremental checkpoints.
- Stagger large workers during high demand; use up to four only when work divides honestly.
- Preserve user changes. Keep stage/commit/push/deploy/final approval with root by default.
- Never claim unlimited quota or guaranteed savings.
- Verify current Z.AI Coding Plan/tool eligibility before use.

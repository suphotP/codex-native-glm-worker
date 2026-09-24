# Native acceptance

Automated bridge tests do not prove native Codex child creation. Acceptance must be performed from a Codex root thread with the native collaboration tool after selecting and restarting the patched `0.155.0-alpha.16` backend.

## Single child

1. Create an isolated, existing Git scratch worktree. Copy `fixtures/assignments/native_accept_1.md` into `<CODEX_HOME>/glm-native-assignments/native_accept_1.md`, replace its placeholder `WORKTREE` with that exact absolute path, and make the nonce unique. The Codex root can prepare this file for the user.
2. Call native `spawn_agent` with:
   - `agent_type: "glm_worker"`
   - `fork_turns: "none"`
   - `task_name: "native_accept_1"`
3. The child must echo the nonce, verify `pwd`, run Git status through a native shell tool in the exact worktree, and complete its checkpoint. The root independently checks the nonce and tool result.
4. Confirm the child appears in the Agents UI/session tree and returns a result through native wait/completion.
5. Confirm the root remains on its selected OpenAI model; child metadata reports `glm-5.3`, `zai_glm_native`, `max` effort and CLI `0.155.0-alpha.16`.
6. Search the process/task evidence: no `codex exec`, external controller, or second Codex CLI invocation may be involved. The running backend process must match the manifest-owned patched package, not only the app-bundled version string.

This basic proof does not require Docker or a product test. Use those as additional, scoped acceptance when the actual assigned work depends on them.

## Four children

Repeat with `native_accept_1` through `_4`, unique nonces, and four distinct native child sessions only when the account quota, current concurrency limit, and workload justify it. Start them in parallel only after a single child passes.

Required proof:

- four native agent IDs;
- four nonce matches;
- four verified worktrees/pwd values;
- native shell output from each, plus a focused test or Docker client/server metadata only when those operations are explicitly assigned;
- root/child model-provider separation;
- bounded completion or explicit 429/502 failure;
- no false success when one child fails.

## Failure meanings

- `ASSIGNMENT_ENVELOPE_INVALID`: fix the exact filename/WORKTREE/pwd before repository access.
- message content type error: use `fork_turns="none"`; inherited rich blocks may be incompatible.
- 429: separate ordinary high-demand, reset-window 1308, and terminal Fair Usage 1313. Preserve the envelope/checkpoint and resume the same task only when allowed.
- 502/stream disconnect: verify both local health endpoints, use incremental checkpoints, and stagger large workers.
- `GLM_TOOL_LOOP_*`: correct the repeated read/self-hash behavior in the envelope before retrying.
- child works only through shell/another CLI: native acceptance failed.

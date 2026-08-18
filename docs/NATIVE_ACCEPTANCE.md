# Native acceptance

Automated bridge tests do not prove native Codex child creation. Acceptance must be performed from a Codex root thread with the native collaboration tool.

## Single child

1. Copy `fixtures/assignments/native_accept_1.md` into `<CODEX_HOME>/glm-native-assignments/native_accept_1.md`.
2. Call native `spawn_agent` with:
   - `agent_type: "glm_worker"`
   - `fork_turns: "none"`
   - `task_name: "native_accept_1"`
3. The child must echo the nonce and use native shell tools to run `pwd`, `git status --short --branch`, `bun test tests/static.test.mjs`, and `docker version --format ...` from the envelope's worktree.
4. Confirm the child appears in the Agents UI/session tree.
5. Confirm the root remains OpenAI and the child role/model reports GLM-5.3.
6. Search the process/task evidence: no `codex exec`, external controller, or second Codex CLI invocation may be involved.

## Four children

Repeat with `native_accept_1` through `_4`, unique nonces, and four distinct native child sessions. Start them in parallel only after a single child passes.

Required proof:

- four native agent IDs;
- four nonce matches;
- four verified worktrees/pwd values;
- native shell output from each, including Git, the focused test, and Docker client/server metadata;
- root/child model-provider separation;
- bounded completion or explicit 429/502 failure;
- no false success when one child fails.

## Failure meanings

- `ASSIGNMENT_ENVELOPE_INVALID`: fix the exact filename/WORKTREE/pwd before repository access.
- message content type error: use `fork_turns="none"`; inherited rich blocks may be incompatible.
- 429: quota/high-demand; preserve the envelope/report and resume later.
- 502/stream disconnect: verify both local health endpoints, use incremental checkpoints, and stagger large workers.
- child works only through shell/another CLI: native acceptance failed.

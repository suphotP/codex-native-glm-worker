# Native acceptance

## Single child

Create a unique plain-text envelope, spawn `agent_type="glm_worker"` with `fork_turns="none"`, and require nonce, `pwd`, `git status`, a focused test, `docker version`, child metadata, and visible native agent ID.

Reject acceptance if any path uses `codex exec`, a second CLI, an external controller, or pasted shell output as a fake child.

## Four children

After one child passes, create four unique envelopes/nonces and native sessions. Require four IDs, four nonce matches, four verified worktrees, explicit success/failure per child, and root collection through native wait/results.

429/502 is a failed or deferred child, never a pass.

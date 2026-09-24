# Assignment envelopes

Create one plain-text file whose basename exactly matches `task_name`:

```markdown
# Task title

WORKTREE=/absolute/path/to/isolated-worktree

Nonce: unique-value

## Ownership

- files or modules the worker may edit
- reminder that other workers exist

## Required outcome

- complete bounded implementation or review

## Commands and proof

- focused tests
- affected gates
- exact report format

## Stops

- no stage/commit/push/deploy/self-approval
- no unrelated or destructive work
```

Use `fork_turns="none"`. The spawn message should only point to the envelope. Re-read envelopes on follow-up turns so root can advance a revision safely.

After reading the envelope and verifying the exact `WORKTREE`, initialize or resume the installed `$CODEX_HOME/native-glm-worker/bin/checkpoint.mjs` with the task basename. The helper stores the envelope digest, worktree, current stage, next action and retry boundary under `$CODEX_HOME/glm-native-state` by default. Keep its next action current before a long command or provider wait. Changing the worktree requires a root-owned `rebind`; a modified envelope requires `refresh` and a full re-read. `complete` marks a worker handoff, never root acceptance.

For 1308 usage-window errors, record the reset time and resume the same bounded task after the actual boundary. For Fair Usage 1313, preserve the checkpoint and stop until the provider restores access. A local `GLM_TOOL_LOOP_*` stop requires a corrected envelope; do not replay unchanged tool calls or switch models. Put checksums in a separate receipt, never inside the file being hashed.

Good packets are cohesive enough for the actual bounded outcome and have explicit paths and proof. Very broad research can hit transport limits; ask workers to checkpoint reports incrementally or split independent topics.

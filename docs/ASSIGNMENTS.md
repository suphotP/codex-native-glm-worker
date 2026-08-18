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

Good packets are cohesive enough for 1–6 hours of autonomous work but have explicit paths and proof. Very broad research can hit transport limits; ask workers to write reports incrementally or split independent topics.

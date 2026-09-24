# Native acceptance child 1

WORKTREE=/absolute/path/to/a/safe/test/repository

Nonce: NATIVE-GLM-ACCEPT-1

The repository is read-only for this test; task-specific checkpoint bookkeeping under CODEX_HOME is allowed. Echo the nonce, use a native shell tool with workdir equal to WORKTREE to run `pwd` and `git status --short --branch`, then report visible model/provider/role metadata and the exact command result. Initialize the installed checkpoint helper after verifying WORKTREE and mark the handoff complete before returning. Do not edit, stage, commit, push, or call `codex exec`. Git status is a local proof; Docker and product tests are separate optional checks when the assigned repository needs them.

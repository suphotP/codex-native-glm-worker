# Troubleshooting

- Envelope invalid: fix exact filename, WORKTREE, and pwd; do not weaken the guard.
- Rich content type error: use `fork_turns="none"` and a plain-text envelope.
- High-demand 429: with explicit retries enabled, the bridge can wait and retry before a stream begins. The public default is zero retries; checkpoint and resume the same child after a bounded wait instead of starting a replacement.
- Usage-window 429/code 1308: record the provider reset timestamp in the checkpoint. A long reset wait needs both a sufficient `GLM_RESPONSES_MAX_RETRY_DELAY_MS` and `GLM_RESPONSES_UPSTREAM_TIMEOUT_MS`. Never rotate accounts to bypass the window.
- Fair Usage 429/code 1313: terminal until the provider restores access. Do not retry this request or switch models.
- `UPSTREAM_429_UNINSPECTABLE`: oversized or stalled provider 429 body. The bridge returns a sanitized local 429 and makes no retry; check quota/reset state before resuming the same task.
- 502/503/504 with local health green: upstream/transient; opt-in pre-stream retries are bounded and can still consume quota. Stagger workers, persist checkpoints, and verify actual completion.
- `GLM_TOOL_LOOP_READ_ONLY` or `GLM_TOOL_LOOP_SELF_HASH`: local non-progress stop. Preserve the checkpoint and wait for a corrected assignment envelope; do not replay unchanged history.
- Stream disconnect: partial output may be lost unless persisted to a file; resume the same child/envelope.
- Poor quality: verify GLM-5.3/max effort, improve bounded context/tests, and keep root review.
- Not visible in Agents UI: it is not native; verify role registration and native spawn_agent.

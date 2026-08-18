# Troubleshooting

- Envelope invalid: fix exact filename, WORKTREE, and pwd; do not weaken the guard.
- Rich content type error: use `fork_turns="none"` and a plain-text envelope.
- 429: checkpoint and resume after quota/high demand; do not rotate shared accounts.
- 502 with local health green: upstream/transient; stagger workers and write incrementally.
- Stream disconnect: partial output may be lost unless persisted to a file; resume the same child/envelope.
- Poor quality: verify GLM-5.3/max effort, improve bounded context/tests, and keep root review.
- Not visible in Agents UI: it is not native; verify role registration and native spawn_agent.

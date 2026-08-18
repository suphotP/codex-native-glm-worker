# Troubleshooting

## `ASSIGNMENT_ENVELOPE_INVALID`

The filename must exactly equal `<task_name>.md`, include an absolute `WORKTREE=...`, and the child must verify `pwd`. Do not relax this guard.

## Rich-content or `messages.content.type` error

Spawn with `fork_turns="none"`. Z.AI Chat Completions may reject rich content inherited from an OpenAI parent. Put the full task in the plain-text filesystem envelope.

## 429

The plan may be at a rolling quota limit or under high demand. Stop safely, persist partial reports, and resume later. Do not create false-success fallbacks or rotate through shared accounts.

## 502 or stream disconnect

Check:

```bash
curl -fsS http://127.0.0.1:47821/health/liveliness
curl -fsS http://127.0.0.1:47821/health/readiness
```

If local health is green, the failure is likely upstream/transient. Stagger large workers and make them write incremental checkpoints. The bridge's optional retry only covers selected HTTP statuses before a body reaches the client; it cannot reconstruct a disconnected partial stream.

## Health live but not ready

LiteLLM is down, misconfigured, or not ready. Inspect redacted service stderr, confirm ports do not collide, and run the credential-free self-test. Never print the key while debugging.

## Child not visible in Agents panel

Verify the agent registration in `config.toml`, role file, Codex restart, exact `agent_type="glm_worker"`, and native `spawn_agent`. Calling an external process is not equivalent.

## GLM quality is poor

Confirm model exactly `glm-5.3`, effort `max`, assignment scope, relevant context, and actual tests. Split unrelated work, not the quality bar. Root must review claims and diffs.

## Install refuses config

The installer refuses unmanaged existing `[agents.glm_worker]` or `[model_providers.zai_glm_native]` tables. Reconcile them manually; do not force an overwrite.

# Troubleshooting

## `ASSIGNMENT_ENVELOPE_INVALID`

The filename must exactly equal `<task_name>.md`, include an absolute `WORKTREE=...`, and the child must verify `pwd`. Do not relax this guard.

## Rich-content or `messages.content.type` error

Spawn with `fork_turns="none"`. Z.AI Chat Completions may reject rich content inherited from an OpenAI parent. Put the full task in the plain-text filesystem envelope.

## GLM role is listed, but the child uses the OpenAI provider

Check `scripts/doctor.sh` after fully quitting and reopening Codex. The role TOML and provider table alone cannot switch a child provider on stock Codex `0.155.0-alpha.16`. Doctor must verify the pinned patched package, `CODEX_CLI_PATH`, and the inode of the app-server process actually running it. Run `scripts/activate-backend.sh` as a plan first; `--apply` selects only a validated, manifest-owned package. A changed launch setting does not replace a backend process already running.

## 429: classify before retrying

- Ordinary high demand: optional bounded retry is available only when `GLM_RESPONSES_MAX_TRANSIENT_RETRIES` is greater than zero. The public default makes no upstream retries. Preserve the checkpoint and resume the same child later if needed.
- Usage-window code 1308: record the provider reset timestamp and the child's next action. A reset hours away needs both `GLM_RESPONSES_MAX_RETRY_DELAY_MS` and a longer `GLM_RESPONSES_UPSTREAM_TIMEOUT_MS`; the default total timeout is 30 minutes. Do not assume a short timeout waited through the reset.
- Fair Usage code 1313: terminal for this request. Stop until the provider restores access. Do not substitute another model or rotate shared accounts to bypass it.

No 429 is a completed child. Use the root's native follow-up to resume the same assignment after the actual retry boundary.

`UPSTREAM_429_UNINSPECTABLE` is a fixed local 429 when the provider error body exceeds 65,536 bytes or fails to finish before the short inspection deadline. The bridge cancels that upstream call and releases its capacity permit without retrying. It does not expose or log the provider body. Inspect quota and status outside the bridge before deciding whether the same task can be resumed.

## 502 or stream disconnect

Check:

```bash
curl -fsS http://127.0.0.1:47821/health/liveliness
curl -fsS http://127.0.0.1:47821/health/readiness
```

If local health is green, the failure is likely upstream/transient. Stagger large workers and use the checkpoint helper before long commands. The bridge's optional retry covers selected 502/503/504 statuses only before a successful stream begins; a retry can still consume provider quota. It cannot reconstruct a disconnected partial stream. Preserve actual failure status and resume the same bounded task.

## `GLM_TOOL_LOOP_READ_ONLY` or `GLM_TOOL_LOOP_SELF_HASH`

These are local non-progress stops, not provider capacity errors. Read the checkpoint and exact tool results, correct the assignment envelope, and follow up to the same child. A read loop needs a genuinely new question; a circular self-hash needs a receipt stored outside the file being hashed. Do not replay unchanged history or increase retries.

## Health live but not ready

LiteLLM is down, misconfigured, or not ready. Inspect redacted service stderr, confirm ports do not collide, and run the credential-free self-test. Never print the key while debugging.

## `ERROR[v8-download]` while building the backend

The pinned rusty_v8 host archive may be unavailable, or Python's CA certificates may not validate its HTTPS download. The CLI may already have compiled, but the builder has **not** published a valid package. On macOS, install the signed Codex app with a bundled CLI that reports exactly `0.155.0-alpha.16`; the builder can then copy its matching code-mode host. On other systems, make the exact V8 archive and CA trust available before retrying or build V8 from source if qualified for your machine. The script retains a `.failed-*` source directory and names it in the error, with no manifest-owned package at the requested output path.

## Child not visible in Agents panel

Verify the agent registration in `config.toml`, role file, patched backend activation, Codex restart, exact `agent_type="glm_worker"`, and native `spawn_agent`. Calling an external process is not equivalent.

## GLM quality is poor

Confirm model exactly `glm-5.3`, effort `max`, assignment scope, relevant context, and actual tests. Split unrelated work, not the quality bar. Root must review claims and diffs.

## Install refuses config

The installer refuses unmanaged existing `[agents.glm_worker]` or `[model_providers.zai_glm_native]` tables. Reconcile them manually; do not force an overwrite.

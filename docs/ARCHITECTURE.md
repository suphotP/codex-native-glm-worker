# Architecture

## Native control plane

```text
Codex 0.155.0-alpha.16 root thread (OpenAI model)
  -> native multi-agent spawn
  -> pinned child-provider patch selects zai_glm_native only for glm_worker
  -> Codex child thread with glm_worker role
  -> Codex native tools, workspace, messages and lifecycle
  -> model-provider HTTP request to 127.0.0.1 Responses facade
  -> LiteLLM protocol translation on a second loopback port
  -> Z.AI Coding endpoint / Chat Completions / glm-5.3
```

Codex owns the agent. The bridge does not create a second Codex process, call `codex exec`, schedule tasks, read repositories, or collect agent results.

`glm_worker` is an additive role. Registration does not replace the root model, change default delegation, or rewrite another native agent role. Stock Codex `0.155.0-alpha.16` bounds role overrides so they cannot select a different model provider. The pinned source patch adds one exception: a native role may select the exact provider ID `zai_glm_native`, resolved from the parent's configured provider map. All other provider overrides remain blocked. Provider selection happens per child: only a native spawn that explicitly selects `agent_type="glm_worker"` uses this GLM provider. OpenAI-backed and GLM-backed native children can coexist under the same root.

The builder pins official upstream commit `0e2f848bf4a4e8d41a02d848a851ba126c09d185`, applies the two-file role patch, materializes the full patched source and builds the patched CLI. On macOS it can copy the code-mode host from a signed installed Codex app whose bundled CLI reports the same pinned version; otherwise it builds the host from source. `codeModeHostOrigin` and its hash are recorded in the package manifest. The builder never modifies the signed Codex app. Changing the upstream source pin requires a new patch review, build, and native parent/child proof.

## Why there are two local services

LiteLLM already handles the complex Responses-to-Chat-Completions translation, including tool-call compatibility. The small Bun facade adds operational rails that are easier to audit independently:

- route allowlist;
- bearer requirement;
- request/body/concurrency bounds;
- long-turn timeout;
- streaming without buffering;
- readiness tied to the LiteLLM backend;
- opt-in bounded transient retry and usage-window handling;
- narrow read-loop and circular self-hash stops;
- redacted failures.

Both are supervised as one unit. If either exits, the supervisor stops the other and exits non-zero so launchd/systemd restarts a complete pair.

Z.AI also publishes a direct Responses endpoint. The bridge remains the default compatibility path because Z.AI currently documents that some previously subscribed accounts can access GLM-5.3 only through the Chat Completions-compatible protocol. Direct mode remains unmeasured by this repository and must not be advertised as accepted until it passes the full native suite.

## Retry ownership

Codex and LiteLLM retries are set to zero. The facade defaults to zero retries too. Operators may explicitly set `GLM_RESPONSES_MAX_TRANSIENT_RETRIES` from 0 through 6. This permits bounded pre-stream retry for ordinary 502/503/504 and high-demand 429. Usage-window 429/code 1308 carries a reset time; Fair Usage 429/code 1313 is terminal. A successful stream is never replayed.

Even a pre-body 502/503/504 can be ambiguous after an upstream provider received work. Retrying may consume additional quota. Prefer zero when cost/effect ambiguity matters; use a bounded value only after accepting that tradeoff.

The maximum single retry delay and total upstream timeout are separate settings. A usage reset five hours away needs both a large enough `GLM_RESPONSES_MAX_RETRY_DELAY_MS` and a matching `GLM_RESPONSES_UPSTREAM_TIMEOUT_MS`. The public default total timeout is 30 minutes; the configurable maximum is 8.5 hours.

The bridge inspects at most 65,536 bytes of a 429 body for provider code/reset details. It bounds that inspection with `GLM_RESPONSES_ERROR_INSPECTION_TIMEOUT_MS` (default 2 seconds, allowed 100–10,000 ms). If the body is too large or does not finish, the bridge cancels upstream and returns a fixed local `429 UPSTREAM_429_UNINSPECTABLE` without retry or provider body text. That releases the concurrency permit promptly and avoids turning an unknown Fair Usage error into a paid retry.

## Assignment envelope

Native Codex child payloads may contain rich/encrypted content that a third-party Chat Completions provider cannot consume. Therefore `fork_turns="none"` starts the GLM child without inherited parent history, and the root writes one exact plain-text envelope:

```text
<CODEX_HOME>/glm-native-assignments/<task_name>.md
```

The child role reads `WORKTREE`, verifies `pwd`, and treats the envelope as the complete task. Native Codex still owns the child session and tools.

After verifying the worktree, the child uses the installed checkpoint helper to persist task identity, stage, next action, retry boundary and measured gate receipts. This allows the same native task to resume after a provider error or turn boundary without claiming work was completed. A `GLM_TOOL_LOOP_*` stop waits for an owner-corrected envelope rather than replaying unchanged tool calls.

The public role disables global Codex memories. This prevents unrelated root/session memory from becoming an implicit third-party-provider input. Put only the context the worker needs in the bounded envelope and repository files it is authorized to inspect.

## Trust model

The worker is powerful but untrusted. The root is responsible for task scope, worktree ownership, integration, independent verification, Git and external effects. The default role forbids stage/commit/push/deploy/self-approval.

## Version pins

The kit defaults to:

- model: `glm-5.3`;
- context: 1,000,000 tokens;
- auto-compact threshold: 900,000;
- reasoning effort: `max`;
- Coding API: `https://api.z.ai/api/coding/paas/v4`.
- patched Codex backend: source tag `rust-v0.155.0-alpha.16` at the commit above.

Model/provider support changes. Run doctor and native acceptance after Codex, LiteLLM, bridge, or Z.AI model changes.

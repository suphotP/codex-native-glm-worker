# Architecture

## Native control plane

```text
Codex root thread (OpenAI model)
  -> native multi-agent spawn
  -> Codex child thread with glm_worker role
  -> Codex native tools, workspace, messages and lifecycle
  -> model-provider HTTP request to 127.0.0.1 Responses facade
  -> LiteLLM protocol translation on a second loopback port
  -> Z.AI Coding endpoint / Chat Completions / glm-5.3
```

Codex owns the agent. The bridge does not create a second Codex process, call `codex exec`, schedule tasks, read repositories, or collect agent results.

`glm_worker` is an additive role. Registration does not replace the root model, change default delegation, or rewrite another native agent role. Provider selection happens per child: only a native spawn that explicitly selects `agent_type="glm_worker"` uses this GLM provider. OpenAI-backed and GLM-backed native children can coexist under the same root.

## Why there are two local services

LiteLLM already handles the complex Responses-to-Chat-Completions translation, including tool-call compatibility. The small Bun facade adds operational rails that are easier to audit independently:

- route allowlist;
- bearer requirement;
- request/body/concurrency bounds;
- long-turn timeout;
- streaming without buffering;
- readiness tied to the LiteLLM backend;
- optional transient retry;
- redacted failures.

Both are supervised as one unit. If either exits, the supervisor stops the other and exits non-zero so launchd/systemd restarts a complete pair.

Z.AI also publishes a direct Responses endpoint. The bridge remains the default compatibility path because Z.AI currently documents that some previously subscribed accounts can access GLM-5.3 only through the Chat Completions-compatible protocol. Direct mode remains unmeasured by this repository and must not be advertised as accepted until it passes the full native suite.

## Retry ownership

Codex and LiteLLM retries are set to zero. The facade defaults to zero retries too. Operators may explicitly set `GLM_RESPONSES_MAX_TRANSIENT_RETRIES` from 0 through 3.

Even a pre-body 502/503/504 can be ambiguous after an upstream provider received work. Retrying may consume additional quota. Prefer zero when cost/effect ambiguity matters; use a bounded value only after accepting that tradeoff.

## Assignment envelope

Native Codex child payloads may contain rich/encrypted content that a third-party Chat Completions provider cannot consume. Therefore `fork_turns="none"` starts the GLM child without inherited parent history, and the root writes one exact plain-text envelope:

```text
<CODEX_HOME>/glm-native-assignments/<task_name>.md
```

The child role reads `WORKTREE`, verifies `pwd`, and treats the envelope as the complete task. Native Codex still owns the child session and tools.

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

Model/provider support changes. Run doctor and native acceptance after Codex, LiteLLM, bridge, or Z.AI model changes.

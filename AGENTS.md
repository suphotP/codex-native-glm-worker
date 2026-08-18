# Contributor agent rules

- Preserve native Codex semantics: the only accepted child path is native `spawn_agent(agent_type="glm_worker")`.
- Do not add `codex exec`, shell pseudo-agents, external controllers, hosted proxy behavior, or silent model fallback.
- Keep `glm-5.3`, reasoning effort `max`, and the 1,000,000-token context explicit and test-covered.
- Keep both bridge processes loopback-only and credential-free in repository tests.
- Never commit provider keys, bridge tokens, private assignment envelopes, or private repository output.
- Treat worker output as untrusted. Workers do not self-commit, self-push, self-deploy, or self-approve by default.
- Preserve plan-only install behavior, atomic config writes, managed ownership markers, backups, and exact uninstall scope.
- Run `bun run check`, both skill validators, and a temporary-`CODEX_HOME` cycle before landing.
- Distinguish fake-service, temporary-home, native-child, and live-provider evidence in every report.

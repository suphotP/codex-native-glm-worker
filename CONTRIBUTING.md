# Contributing

Contributions are welcome when they preserve native Codex child semantics and the local security boundary.

Before opening a pull request:

1. Run `bun run check` without real provider credentials.
2. Run `python3 scripts/validate-skill.py` and the Codex skill quick validator when available.
3. Test installation in a temporary `CODEX_HOME`.
4. If changing the backend pin or patch, verify the official upstream commit, exact two-file role diff, local-only lock normalization, complete source-backed package, activation plan, and a native parent/child flow on the new executable. Do not certify the binary from a version string or self-declared hash alone.
5. Do not commit keys, tokens, private assignment envelopes, or private repository output.
6. Do not replace native `spawn_agent(agent_type="glm_worker")` with `codex exec`, a shell pseudo-agent, or an external controller.
7. Do not add silent model fallback, public/LAN binding, self-commit, self-push, or self-approval behavior.
8. Describe which proof is fake-service, temporary-home, source-build, native-child, and live-provider evidence.

Changes to provider/model identity, retry ownership, credential storage, service lifecycle, or Codex agent-role configuration require focused regression tests and an explicit compatibility note.

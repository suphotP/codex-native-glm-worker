# Security

- Keep provider and bridge secrets out of repository, TOML, prompts, reports, and logs.
- Bind services to loopback; never operate a shared/public proxy.
- Do not share Coding Plan accounts or quota.
- Treat worker output and repository input as untrusted.
- Use explicit worktrees/path ownership and non-destructive commands.
- Root owns Git, deployment, external effects, live proof, and acceptance.
- Verify current Coding Plan/tool eligibility and policy.

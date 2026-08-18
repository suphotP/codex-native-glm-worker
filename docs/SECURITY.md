# Security

## Secrets

- Never put Z.AI keys or bridge tokens in repository files, TOML snippets, logs, prompts, or assignment envelopes.
- Use macOS Keychain or a mode-600 Linux credentials file.
- Use a separate random bridge token; never reuse the provider key.
- Rotate any key pasted into chat, shell history, issue, or commit.
- The GLM role disables global Codex memories; assignment envelopes are the explicit context boundary.

## Local bridge

- Bind both services to loopback.
- Require bearer auth for Responses requests.
- Do not expose the port through LAN, tunnel, reverse proxy, container publish, or SaaS.
- The bridge is for the account holder's local coding tool, not a shared inference service.

## Worker authority

GLM workers can read and modify assigned repositories and run commands. Treat their output as untrusted. Give explicit worktrees and paths, preserve user changes, and keep Git/deploy/final approval with the root.

## Plan policy

Z.AI Coding Plan usage is tied to current eligible tools/scenarios and individual accounts. Verify current policy. Do not share subscriptions or offer proxy access.

## Reporting

Report security issues privately to the repository owner before public disclosure. Do not include real credentials or private repository data in issues.

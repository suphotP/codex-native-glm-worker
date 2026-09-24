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
- A provider 429 body that is too large or stalls is replaced with a fixed local `UPSTREAM_429_UNINSPECTABLE`; the bridge neither retries that unknown error nor logs the provider body. This stop is not a proof that the user's quota has reset.

## Patched backend provenance

- The builder pins the official upstream commit and a two-file child-provider patch, then packages full patched source, binaries, a manifest and hashes. The activation plan checks file consistency without executing a package binary.
- `manifest.json` and `SHA256SUMS` are self-declared local receipts, not a publisher signature or cryptographic proof that a binary was compiled from the included source. Build the package from this reviewed repository and still perform a real native OpenAI-parent/GLM-child acceptance test after activation.
- Never accept a same-version `codex --version` string by itself as proof of the GLM provider patch. Doctor checks the running app-server and source-backed package consistency; native acceptance verifies actual child selection and tool/result completion.

## Worker authority

GLM workers can read and modify assigned repositories and run commands. Treat their output as untrusted. Give explicit worktrees and paths, preserve user changes, and keep Git/deploy/final approval with the root.

## Plan policy

Z.AI Coding Plan usage is tied to current eligible tools/scenarios and individual accounts. Verify current policy. Do not share subscriptions or offer proxy access.

## Reporting

Report security issues privately to the repository owner before public disclosure. Do not include real credentials or private repository data in issues.

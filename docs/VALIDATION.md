# Validation record

Validation is separated by proof layer. A passing layer must not be used to claim a stronger one.

## 2026-09-25 source-backed Codex 0.155 update

The source builder pinned OpenAI tag `rust-v0.155.0-alpha.16` at commit `0e2f848bf4a4e8d41a02d848a851ba126c09d185`. Its patch changed only `codex-rs/core/src/agent/role.rs` and `role_tests.rs`; `Cargo.lock` normalized 154 local workspace versions from `0.0.0` to `0.155.0-alpha.16` without changing external dependencies. Those three generated files were byte-identical to the prior source whose 16 focused `apply_role` tests passed. This source identity supports the narrow role behavior claim; it is not a substitute for a new app runtime test.

The repository's credential-free `bun run check` battery covers a fake LiteLLM/Responses boundary, the 429/1308/1313 and 502/503/504 policies, stream cancellation/capacity, a stalled or oversized 429 body, 13 tool-loop detector tests, checkpoint persistence, static role/provider contracts, a temporary-`CODEX_HOME` install/uninstall, service templates, source-builder plan/patch/lock/error paths, and activation/doctor with a mocked macOS process tree. Both the repository skill validator and Codex quick validator passed. The full Codex workspace suite and Bazel lock check were not run.

A real `build-patched-codex.sh --apply` run in an isolated output produced a runnable `codex` `0.155.0-alpha.16`, a matching signed app-bundled code-mode host, the full patched Git source checkout, `manifest.json`, and `SHA256SUMS`. The output passed the plan-mode activation package/hash check and `codesign --verify`. The first attempted host source build encountered a missing rusty_v8 150.4.0 macOS arm64 archive/CA failure; the tested builder now uses the matching signed app resource on macOS and reports a bounded `ERROR[v8-download]` if it must build that host but cannot. No failed staging directory was published as a valid package.

The current source kit also passed one real native parent/child flow in an isolated app-server process. The **built package binary** ran a GPT-6 Sol parent on `openai`; a native `glm_worker` child used `glm-5.3` / `zai_glm_native`, max effort, and CLI `0.155.0-alpha.16`. The child used the role, checkpoint helper, tool discipline, bridge and auth command copied by the repository installer into a temporary Codex home. That bridge listened on a separate loopback port and forwarded to the machine's already-running LiteLLM backend using an existing local token; no new Keychain entry or live service was installed. The child executed native shell commands, matched a fresh filesystem nonce, completed its checkpoint, and returned the exact marker to the Sol parent in 51.134 seconds. Native start/completion was observed, with zero parent shell calls, reroutes, or turn errors. The isolated bridge was stopped afterward; the user's active Desktop app/backend and bridge were not changed by this test.

The app-server stderr still contained nonfatal `OutputTextDelta without active item` messages and one ephemeral-parent transcript warning, also observed in the earlier private-bridge flow. Tool execution, returned text and task completion passed; partial-text display and long-running recovery were not qualified by this one short flow. The updated public kit has not been activated in the user's Desktop session or qualified on Linux/Windows. Manifest and hashes establish package consistency, not binary provenance; native child proof remains the decisive functional check after an actual activation.

## Historical repository code: credential-free

On 2026-08-18, the repository battery passed on macOS arm64 with Bun 1.3.3:

- fake LiteLLM/Responses protocol boundary on ports 47921/47925;
- route, authentication, JSON, request-size, retry, timeout and shutdown checks;
- two-permit concurrency held through stream completion;
- permit recovery after cancellation/drain and upstream stream timeout;
- static model/provider/security contracts: 7 tests, 34 expectations;
- plan-only and applied temporary-`CODEX_HOME` install, idempotent reinstall, conflict/symlink refusal, file modes, tampered-manifest refusal and exact uninstall;
- launchd/systemd template rendering and symlink refusal;
- repository skill validator and the official Codex skill quick validator.

No live provider credential is used by this battery.

## Historical native Codex architecture: live provider

A pre-existing working local GLM deployment using the same native Codex role/provider architecture was used for acceptance without installing this repository over it.

One child and then four concurrent children were created through native `spawn_agent(agent_type="glm_worker", fork_turns="none")`. Five distinct filesystem nonces round-tripped. Every child:

- appeared as a native child task with a distinct task ID;
- verified `/Users/work/Desktop/codex-native-glm-worker` as `pwd`;
- ran Git status through a native shell tool;
- passed `bun test tests/static.test.mjs` with 7/0 tests;
- reached the Docker client and server with `docker version`;
- reported GLM-5.3 and the 1,000,000-token role context;
- reported no `codex exec`, external controller, edit, stage, commit, push, install, service start or credential read.

The root session remained OpenAI-backed. The child model/provider identity is platform/config/runtime metadata, not a cryptographic attestation.

Before and after acceptance, hashes of the existing Codex config, GLM role, bridge source/config/run/self-test files were identical; listener identities and both local health endpoints were unchanged.

## Honest boundary

The live test proves native child creation and the working architecture. The fake/temp-home battery proves this repository's bridge and installer code. A new machine should still run its own temporary-home install, foreground service, doctor and native 1+4 acceptance before relying on the setup.

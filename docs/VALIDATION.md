# Validation record

Validation is separated by proof layer. A passing layer must not be used to claim a stronger one.

## Repository code: credential-free

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

## Native Codex architecture: live provider

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

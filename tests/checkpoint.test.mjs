import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/checkpoint.mjs");
const root = mkdtempSync(join(tmpdir(), "glm-checkpoint-test-"));
const stateRoot = join(root, "state");
const worktree = join(root, "worktree");
const reboundWorktree = join(root, "worktree-rebound");
const assignment = join(root, "task.md");
mkdirSync(worktree);
mkdirSync(reboundWorktree);
writeFileSync(assignment, "WORKTREE: test\nSTAGES: inspect,implement,proof\n");

function run(args, expectedStatus = 0) {
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...process.env, GLM_NATIVE_STATE_ROOT: stateRoot },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== expectedStatus) {
    throw new Error(
      `checkpoint command failed: ${JSON.stringify({ args, exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() })}`,
    );
  }
  return result.stdout.toString();
}

try {
  run([
    "init",
    "--task", "checkpoint_test",
    "--assignment", assignment,
    "--worktree", worktree,
    "--stage", "inspect",
    "--next", "inspect state",
  ]);
  let state = JSON.parse(run(["show", "--task", "checkpoint_test"]));
  if (state.status !== "ACTIVE" || state.currentStage !== "inspect") throw new Error("init state");

  run([
    "stage", "--task", "checkpoint_test",
    "--stage", "inspect", "--status", "complete",
    "--next", "implement bounded change",
    "--fingerprint", "sha256:source-a",
    "--note", "inspection complete",
  ]);
  run([
    "gate", "--task", "checkpoint_test",
    "--name", "focused", "--fingerprint", "sha256:source-a",
    "--result", "PASS", "--layer", "focused",
    "--counts", "1 pass/0 fail", "--duration-ms", "25",
    "--rerun-reason", "first run", "--command", "bun test focused",
  ]);
  const reuse = JSON.parse(run([
    "should-run", "--task", "checkpoint_test",
    "--name", "focused", "--fingerprint", "sha256:source-a",
  ]));
  if (reuse.decision !== "REUSE") throw new Error("gate reuse");
  const runChanged = JSON.parse(run([
    "should-run", "--task", "checkpoint_test",
    "--name", "focused", "--fingerprint", "sha256:source-b",
  ]));
  if (runChanged.decision !== "RUN") throw new Error("gate invalidation");

  run([
    "block", "--task", "checkpoint_test",
    "--kind", "USAGE_WINDOW_429",
    "--resume-at", "2099-01-01T00:00:00.000Z",
    "--error", "provider reset window",
    "--next", "resume implement stage",
  ]);
  state = JSON.parse(run(["resume", "--task", "checkpoint_test"]));
  if (state.status !== "BLOCKED_RETRYABLE" || state.retry?.kind !== "USAGE_WINDOW_429") {
    throw new Error("block state");
  }

  run([
    "rebind", "--task", "checkpoint_test",
    "--assignment", assignment, "--worktree", reboundWorktree,
    "--reason", "self-test authoritative correction",
    "--stage", "inspect", "--next", "resume after rebind",
  ]);
  state = JSON.parse(run(["show", "--task", "checkpoint_test"]));
  if (
    state.status !== "ACTIVE" ||
    state.worktree !== reboundWorktree ||
    state.worktreeHistory?.length !== 1 ||
    state.retry !== null
  ) {
    throw new Error("rebind state");
  }

  writeFileSync(assignment, "WORKTREE: test\nSTAGES: inspect,implement,proof,handoff\n");
  run([
    "refresh", "--task", "checkpoint_test", "--assignment", assignment,
    "--stage", "implement", "--next", "reconcile refreshed assignment",
  ]);
  state = JSON.parse(run(["show", "--task", "checkpoint_test"]));
  if (state.assignmentHistory.length !== 1 || state.retry !== null || state.currentStage !== "implement") {
    throw new Error("refresh state");
  }

  run(["complete", "--task", "checkpoint_test", "--note", "handoff ready"]);
  state = JSON.parse(run(["show", "--task", "checkpoint_test"]));
  if (state.status !== "COMPLETE_UNTRUSTED_HANDOFF") throw new Error("completion state");

  const ledger = JSON.parse(run(["list"]));
  if (ledger.entries.length !== 1 || ledger.entries[0].task !== "checkpoint_test") throw new Error("ledger");

  const stateFile = join(stateRoot, "checkpoint_test", "state.v1.json");
  const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
  if (persisted.gateReceipts.length !== 1 || persisted.completedStages[0] !== "inspect") {
    throw new Error("persisted state");
  }

  process.stdout.write(`${JSON.stringify({ status: "PASS", task: persisted.task, gates: persisted.gateReceipts.length })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

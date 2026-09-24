#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_STATE_ROOT = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "glm-native-state");
const stateRoot = resolve(process.env.GLM_NATIVE_STATE_ROOT ?? DEFAULT_STATE_ROOT);
const command = process.argv[2];
const options = parseOptions(process.argv.slice(3));
const taskPattern = /^[a-z0-9][a-z0-9_-]{0,95}$/;

function parseOptions(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requireOption(name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} is required`);
  return value;
}

function taskName() {
  const task = requireOption("task");
  if (!taskPattern.test(task)) throw new Error(`invalid task name: ${task}`);
  return task;
}

function taskDirectory(task) {
  return join(stateRoot, task);
}

function statePath(task) {
  return join(taskDirectory(task), "state.v1.json");
}

function now() {
  return new Date().toISOString();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertRegularFile(path, label) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
}

function assertDirectory(path, label) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a non-symlink directory`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function sleep(ms) {
  return Bun.sleep(ms);
}

async function withLedgerLock(callback) {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const lock = join(stateRoot, ".ledger.lock");
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST" || Date.now() >= deadline) throw error;
      await sleep(50);
    }
  }
  try {
    return await callback();
  } finally {
    rmdirSync(lock);
  }
}

function loadState(task) {
  const path = statePath(task);
  if (!existsSync(path)) throw new Error(`state not found for ${task}`);
  const state = readJson(path);
  validateState(state, task);
  return state;
}

function validateState(state, task) {
  if (state?.schemaVersion !== 1 || state?.task !== task || typeof state?.updatedAt !== "string") {
    throw new Error(`invalid state for ${task}`);
  }
}

function saveState(state) {
  state.updatedAt = now();
  atomicWriteJson(statePath(state.task), state);
}

async function updateLedger() {
  await withLedgerLock(async () => {
    const entries = [];
    for (const name of readdirSync(stateRoot).sort()) {
      if (!taskPattern.test(name)) continue;
      const path = statePath(name);
      if (!existsSync(path)) continue;
      const state = readJson(path);
      validateState(state, name);
      entries.push({
        task: state.task,
        status: state.status,
        currentStage: state.currentStage,
        nextAction: state.nextAction,
        updatedAt: state.updatedAt,
        worktree: state.worktree,
        assignmentPath: state.assignmentPath,
        assignmentSha256: state.assignmentSha256,
        retry: state.retry,
      });
    }
    atomicWriteJson(join(stateRoot, "ledger.v1.json"), {
      schemaVersion: 1,
      generatedAt: now(),
      entries,
    });
  });
}

function print(value) {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

async function initialize() {
  const task = taskName();
  const assignmentPath = resolve(requireOption("assignment"));
  const worktree = resolve(requireOption("worktree"));
  assertRegularFile(assignmentPath, "assignment");
  assertDirectory(worktree, "worktree");
  const assignmentSha256 = sha256File(assignmentPath);
  const path = statePath(task);
  if (existsSync(path)) {
    const existing = loadState(task);
    if (
      existing.assignmentPath !== assignmentPath ||
      existing.assignmentSha256 !== assignmentSha256 ||
      existing.worktree !== worktree
    ) {
      throw new Error(`existing state identity mismatch for ${task}; use refresh after reviewing the new envelope`);
    }
    print(existing);
    return;
  }
  const timestamp = now();
  const state = {
    schemaVersion: 1,
    task,
    assignmentPath,
    assignmentSha256,
    assignmentHistory: [],
    worktree,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "ACTIVE",
    currentStage: options.stage ?? "inspect",
    nextAction: options.next ?? "Inspect assignment and authoritative state",
    completedStages: [],
    changedPaths: [],
    gateReceipts: [],
    retry: null,
    sourceFingerprint: options.fingerprint ?? null,
    checkpointNote: options.note ?? "initialized",
  };
  saveState(state);
  await updateLedger();
  print(state);
}

async function refreshAssignment() {
  const task = taskName();
  const state = loadState(task);
  const assignmentPath = resolve(requireOption("assignment"));
  assertRegularFile(assignmentPath, "assignment");
  const assignmentSha256 = sha256File(assignmentPath);
  if (state.assignmentPath !== assignmentPath || state.assignmentSha256 !== assignmentSha256) {
    state.assignmentHistory.push({
      assignmentPath: state.assignmentPath,
      assignmentSha256: state.assignmentSha256,
      supersededAt: now(),
    });
    state.assignmentPath = assignmentPath;
    state.assignmentSha256 = assignmentSha256;
    state.status = "ACTIVE";
    state.retry = null;
    state.currentStage = options.stage ?? state.currentStage;
    state.nextAction = options.next ?? "Reconcile refreshed assignment with checkpoint before continuing";
    state.checkpointNote = options.note ?? "assignment refreshed";
    saveState(state);
    await updateLedger();
  }
  print(state);
}

async function rebindWorktree() {
  const task = taskName();
  const state = loadState(task);
  const assignmentPath = resolve(requireOption("assignment"));
  const worktree = resolve(requireOption("worktree"));
  assertRegularFile(assignmentPath, "assignment");
  assertDirectory(worktree, "worktree");
  const assignmentSha256 = sha256File(assignmentPath);
  if (state.assignmentPath !== assignmentPath || state.assignmentSha256 !== assignmentSha256) {
    throw new Error(`assignment identity mismatch for ${task}; refresh the assignment before rebind`);
  }
  state.worktreeHistory ??= [];
  state.worktreeHistory.push({
    worktree: state.worktree,
    reboundAt: now(),
    reason: requireOption("reason"),
  });
  state.worktree = worktree;
  state.status = "ACTIVE";
  state.retry = null;
  state.currentStage = options.stage ?? "inspect";
  state.nextAction = options.next ?? "Resume the exact pending stage in the rebound authoritative worktree";
  state.checkpointNote = options.note ?? "root-owned worktree rebind";
  saveState(state);
  await updateLedger();
  print(state);
}

async function updateStage() {
  const task = taskName();
  const state = loadState(task);
  const stage = requireOption("stage");
  const stageStatus = options.status ?? "in_progress";
  if (!new Set(["in_progress", "complete"]).has(stageStatus)) throw new Error("--status must be in_progress or complete");
  if (stageStatus === "complete" && !state.completedStages.includes(stage)) state.completedStages.push(stage);
  state.currentStage = stage;
  state.nextAction = options.next ?? state.nextAction;
  state.checkpointNote = options.note ?? state.checkpointNote;
  if (options.fingerprint) state.sourceFingerprint = options.fingerprint;
  if (options.paths) {
    state.changedPaths = [...new Set([...state.changedPaths, ...options.paths.split(",").filter(Boolean)])].sort();
  }
  state.status = "ACTIVE";
  state.retry = null;
  saveState(state);
  await updateLedger();
  print(state);
}

async function recordGate() {
  const task = taskName();
  const state = loadState(task);
  const receipt = {
    name: requireOption("name"),
    fingerprint: requireOption("fingerprint"),
    result: requireOption("result"),
    layer: requireOption("layer"),
    counts: options.counts ?? null,
    durationMs: options["duration-ms"] ? Number(options["duration-ms"]) : null,
    rerunReason: requireOption("rerun-reason"),
    command: options.command ?? null,
    recordedAt: now(),
  };
  const existingIndex = state.gateReceipts.findIndex(
    (item) => item.name === receipt.name && item.fingerprint === receipt.fingerprint,
  );
  if (existingIndex === -1) state.gateReceipts.push(receipt);
  else state.gateReceipts[existingIndex] = receipt;
  state.checkpointNote = options.note ?? `gate ${receipt.name}: ${receipt.result}`;
  saveState(state);
  await updateLedger();
  print(receipt);
}

function shouldRunGate() {
  const task = taskName();
  const state = loadState(task);
  const name = requireOption("name");
  const fingerprint = requireOption("fingerprint");
  const receipt = state.gateReceipts.find(
    (item) => item.name === name && item.fingerprint === fingerprint && item.result === "PASS",
  );
  print(receipt ? { decision: "REUSE", receipt } : { decision: "RUN" });
}

async function blockTask() {
  const task = taskName();
  const state = loadState(task);
  state.status = "BLOCKED_RETRYABLE";
  state.retry = {
    kind: requireOption("kind"),
    resumeAt: options["resume-at"] ?? null,
    attempts: Number(options.attempts ?? "1"),
    lastError: options.error ?? null,
    recordedAt: now(),
  };
  state.nextAction = options.next ?? "Resume the same pending stage after the recorded retry boundary";
  state.checkpointNote = options.note ?? `blocked: ${state.retry.kind}`;
  saveState(state);
  await updateLedger();
  print(state);
}

async function completeTask() {
  const task = taskName();
  const state = loadState(task);
  state.status = "COMPLETE_UNTRUSTED_HANDOFF";
  state.currentStage = "handoff";
  state.nextAction = "Root independently verifies the handoff";
  state.checkpointNote = options.note ?? "worker handoff complete";
  state.retry = null;
  saveState(state);
  await updateLedger();
  print(state);
}

function showTask() {
  print(loadState(taskName()));
}

function resumeTask() {
  const state = loadState(taskName());
  print({
    task: state.task,
    status: state.status,
    assignmentPath: state.assignmentPath,
    assignmentSha256: state.assignmentSha256,
    worktree: state.worktree,
    currentStage: state.currentStage,
    completedStages: state.completedStages,
    sourceFingerprint: state.sourceFingerprint,
    nextAction: state.nextAction,
    changedPaths: state.changedPaths,
    gateReceipts: state.gateReceipts,
    retry: state.retry,
    checkpointNote: state.checkpointNote,
    updatedAt: state.updatedAt,
  });
}

function listTasks() {
  const path = join(stateRoot, "ledger.v1.json");
  print(existsSync(path) ? readJson(path) : { schemaVersion: 1, generatedAt: now(), entries: [] });
}

function showHelp() {
  print(`checkpoint.mjs commands:
  init --task <task> --assignment <absolute-file> --worktree <absolute-directory> [--stage <stage>] [--next <action>] [--fingerprint <value>] [--note <value>]
  resume --task <task>
  refresh --task <task> --assignment <absolute-file> [--stage <stage>] [--next <action>] [--note <value>]
  rebind --task <task> --assignment <absolute-file> --worktree <absolute-directory> --reason <audit-reason> [--stage <stage>] [--next <action>] [--note <value>]
  stage --task <task> --stage <stage> --status <in_progress|complete> [--next <action>] [--fingerprint <value>] [--paths <comma-list>] [--note <value>]
  should-run --task <task> --name <gate> --fingerprint <value>
  gate --task <task> --name <gate> --fingerprint <value> --result <value> --layer <value> --rerun-reason <value> [--counts <value>] [--duration-ms <number>] [--command <value>]
  block --task <task> --kind <value> [--resume-at <iso>] [--attempts <number>] [--error <value>] [--next <action>]
  complete --task <task> [--note <value>]
  show --task <task>
  list`);
}

switch (command) {
  case "init":
    await initialize();
    break;
  case "refresh":
    await refreshAssignment();
    break;
  case "rebind":
    await rebindWorktree();
    break;
  case "stage":
    await updateStage();
    break;
  case "gate":
    await recordGate();
    break;
  case "should-run":
    shouldRunGate();
    break;
  case "block":
    await blockTask();
    break;
  case "complete":
    await completeTask();
    break;
  case "show":
    showTask();
    break;
  case "resume":
    resumeTask();
    break;
  case "list":
    listTasks();
    break;
  case "help":
  case "--help":
  case "-h":
    showHelp();
    break;
  default:
    throw new Error("command must be init, refresh, rebind, stage, gate, should-run, block, complete, show, resume, list, or help");
}

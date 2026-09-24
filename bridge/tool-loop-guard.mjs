import { createHash } from "node:crypto";
import { posix } from "node:path";

// These guards recognize two specific, previously observed success-without-
// progress patterns. They intentionally fail open on unknown tool envelopes,
// parallel calls, changed output, or a new user/developer instruction.
function toolArguments(call) {
  if (call?.type !== "function_call" ||
      !["exec_command", "functions.exec_command"].includes(call.name) ||
      typeof call.arguments !== "string" || call.arguments.length > 65_536) return null;
  try {
    const args = JSON.parse(call.arguments);
    return args && typeof args === "object" && !Array.isArray(args) &&
      typeof args.workdir === "string" && args.workdir.startsWith("/") &&
      !args.workdir.includes("\0") && typeof args.cmd === "string" &&
      args.cmd.length <= 65_536 ? args : null;
  } catch {
    return null;
  }
}

function selfHashSignature(call) {
  const args = toolArguments(call);
  if (!args) return null;
  const shell = args.cmd.match(
    /^apply_patch <<'([A-Za-z_][A-Za-z0-9_]*)'\n([\s\S]+)\n\1\n(shasum -a 256|sha256sum) ([A-Za-z0-9_./-]+)\s*$/u,
  );
  if (!shell) return null;
  const lines = shell[2].split("\n");
  if (lines.length !== 6 || lines[0] !== "*** Begin Patch" ||
      !lines[1].startsWith("*** Update File: ") || lines[2] !== "@@" ||
      !lines[3].startsWith("-") || !lines[4].startsWith("+") ||
      lines[5] !== "*** End Patch") return null;
  const target = lines[1].slice("*** Update File: ".length);
  if (!/^[A-Za-z0-9_./-]+$/u.test(target) ||
      posix.resolve(args.workdir, target) !== posix.resolve(args.workdir, shell[4])) return null;
  const before = lines[3].slice(1);
  const after = lines[4].slice(1);
  const digest = /\b[0-9a-f]{64}\b/giu;
  const normalize = (value) => value.replace(digest, "<SHA256>");
  if (before === after || normalize(before) !== normalize(after)) return null;
  const oldHashes = before.match(digest) ?? [];
  const newHashes = after.match(digest) ?? [];
  if (oldHashes.length !== newHashes.length) return null;
  const changed = oldHashes.map((hash, index) => hash !== newHashes[index] ? index : -1).filter((index) => index >= 0);
  if (changed.length !== 1) return null;
  return {
    key: JSON.stringify([posix.resolve(args.workdir, target), normalize(before)]),
    target: posix.resolve(args.workdir, target),
    workdir: args.workdir,
    removed: oldHashes[changed[0]].toLowerCase(),
    added: newHashes[changed[0]].toLowerCase(),
  };
}

function digestFromOutput(item, signature) {
  if (typeof item.output !== "string" ||
      !/(?:Process exited with code 0|"exit_code"\s*:\s*0)/u.test(item.output)) return null;
  const matches = item.output.split("\n")
    .map((line) => line.match(/^([0-9a-f]{64})\s+([A-Za-z0-9_./-]+)\s*$/iu))
    .filter(Boolean);
  if (matches.length !== 1 ||
      posix.resolve(signature.workdir, matches[0][2]) !== signature.target) return null;
  return matches[0][1].toLowerCase();
}

export function detectSelfHashToolLoop(input) {
  if (!Array.isArray(input)) return false;
  const completed = [];
  const seen = new Set();
  let pending = null;
  for (const item of input.slice(-96)) {
    if ((item?.type === "message" && item.role !== "assistant") ||
        item?.type === "agent_message" || item?.type === "inter_agent_communication_metadata") {
      completed.length = 0; pending = null; seen.clear(); continue;
    }
    if (item?.type === "function_call" || item?.type === "custom_tool_call") {
      if (pending) completed.length = 0;
      pending = { id: item.call_id, signature: selfHashSignature(item) };
      continue;
    }
    if (item?.type === "function_call_output" || item?.type === "custom_tool_call_output") {
      if (!pending || typeof pending.id !== "string" ||
          item.call_id !== pending.id || seen.has(pending.id)) {
        completed.length = 0; pending = null; continue;
      }
      seen.add(pending.id);
      const signature = pending.signature;
      const output = signature ? digestFromOutput(item, signature) : null;
      if (!signature || !output) completed.length = 0;
      else completed.push({ ...signature, output });
      pending = null;
      continue;
    }
    if (item?.type !== "reasoning" && !(item?.type === "message" && item.role === "assistant")) {
      completed.length = 0; pending = null;
    }
  }
  const last = completed.slice(-3);
  return pending === null && last.length === 3 &&
    last.every((item) => item.key === last[0].key) &&
    last.slice(1).every((item, index) =>
      item.added === last[index].output && item.removed === last[index].added);
}

function readSignature(call) {
  const args = toolArguments(call);
  if (!args || !/^rg -n "[A-Za-z_][A-Za-z0-9_]{0,127}" (?:\/|[A-Za-z0-9_])[A-Za-z0-9_./-]*\.ts \| cat$/u.test(args.cmd)) {
    return null;
  }
  return JSON.stringify([args.workdir, args.cmd]);
}

function successfulReadDigest(item) {
  if (typeof item.output !== "string" || item.output.length > 65_536) return null;
  let body;
  if (item.output.startsWith("{")) {
    let result;
    try { result = JSON.parse(item.output); } catch { return null; }
    if (!result || typeof result !== "object" || Array.isArray(result) ||
        result.exit_code !== 0 || typeof result.output !== "string" ||
        Object.keys(result).some((key) => ![
          "chunk_id", "exit_code", "output", "wall_time_seconds", "original_token_count",
        ].includes(key))) return null;
    body = result.output;
  } else {
    const match = item.output.match(
      /^(?:Chunk ID: [A-Za-z0-9_-]{1,128}\n)?(?:Wall time: [0-9.]+ seconds\n)?Process exited with code 0\n(?:Original token count: [0-9]+\n)?(?:Output|Final output):\n([\s\S]*)$/u,
    );
    if (!match) return null;
    body = match[1];
  }
  if (!body || body.length > 65_536 ||
      !body.replace(/\n$/u, "").split("\n").every((line) => /^[1-9][0-9]*:[^\r\n]*$/u.test(line))) {
    return null;
  }
  return createHash("sha256").update(body).digest("hex");
}

export function detectRepeatedReadOnlyToolLoop(input) {
  if (!Array.isArray(input)) return false;
  const completed = [];
  const seen = new Set();
  let pending = null;
  for (const item of input.slice(-96)) {
    if ((item?.type === "message" && item.role !== "assistant") ||
        item?.type === "agent_message" || item?.type === "inter_agent_communication_metadata") {
      completed.length = 0; pending = null; seen.clear(); continue;
    }
    if (item?.type === "function_call" || item?.type === "custom_tool_call") {
      if (pending) completed.length = 0;
      pending = { id: item.call_id, key: readSignature(item) };
      if (!pending.key || typeof pending.id !== "string" || seen.has(pending.id)) completed.length = 0;
      continue;
    }
    if (item?.type === "function_call_output" || item?.type === "custom_tool_call_output") {
      if (!pending || typeof pending.id !== "string" ||
          item.call_id !== pending.id || seen.has(pending.id)) {
        completed.length = 0; pending = null; continue;
      }
      seen.add(pending.id);
      const body = pending.key ? successfulReadDigest(item) : null;
      if (!body) completed.length = 0;
      else {
        completed.push({ key: pending.key, body });
        if (completed.length > 8) completed.shift();
      }
      pending = null;
      continue;
    }
    if (item?.type !== "reasoning" && !(item?.type === "message" && item.role === "assistant")) {
      completed.length = 0; pending = null;
    }
  }
  if (pending || completed.length !== 8) return false;
  const bodies = new Map();
  for (const item of completed) {
    if (bodies.has(item.key) && bodies.get(item.key) !== item.body) return false;
    bodies.set(item.key, item.body);
  }
  return [1, 2].some((period) =>
    completed.every((item, index) => item.key === completed[index % period].key));
}

export function toolLoopError(code, message) {
  process.stderr.write(JSON.stringify({ event: "glm_tool_loop_stopped", code }) + "\n");
  return Response.json(
    { error: { type: "invalid_request_error", code, message } },
    { status: 422, headers: { "x-glm-retry-class": "LOCAL_TOOL_LOOP", "cache-control": "no-store" } },
  );
}

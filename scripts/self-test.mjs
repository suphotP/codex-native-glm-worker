import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const bridgePath = resolve(repositoryRoot, "bridge/responses-bridge.mjs");
const backendPort = Number(process.env.NATIVE_GLM_TEST_BACKEND_PORT ?? 47925);
const bridgePort = Number(process.env.NATIVE_GLM_TEST_BRIDGE_PORT ?? 47921);
const defaultBridgePort = Number(process.env.NATIVE_GLM_TEST_DEFAULT_BRIDGE_PORT ?? 47922);
const authorization = "Bearer test-bridge-token-do-not-use";
const providerSentinel = "provider-private-test-marker";
let transientCalls = 0;
const calls = new Map();

function count(testCase) {
  const next = (calls.get(testCase) ?? 0) + 1;
  calls.set(testCase, next);
  return next;
}

function providerBareTimestamp(timestampMs) {
  return new Date(timestampMs + 8 * 60 * 60 * 1_000).toISOString().replace("T", " ").replace(/Z$/u, "");
}

const backend = Bun.serve({
  hostname: "127.0.0.1",
  port: backendPort,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health/liveliness") return new Response("alive");
    if (url.pathname !== "/v1/responses" || request.method !== "POST") {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (request.headers.get("authorization") !== authorization) {
      return Response.json({ error: "bad auth" }, { status: 401 });
    }
    const body = await request.json();
    const call = count(body.testCase);
    if (body.testCase === "transient") {
      transientCalls += 1;
      if (transientCalls < 3) {
        return Response.json({ error: "retry" }, { status: 503, headers: { "retry-after": "0" } });
      }
    }
    if (["bad-gateway", "gateway-timeout"].includes(body.testCase) && call === 1) {
      return Response.json({ error: "retry" }, {
        status: body.testCase === "bad-gateway" ? 502 : 504,
        headers: { "retry-after": "0" },
      });
    }
    if (body.testCase === "generic429" && call === 1) {
      return Response.json({ error: { code: "high_demand", message: `busy ${providerSentinel}` } }, { status: 429 });
    }
    if (body.testCase === "usage-reset-bare" && call === 1) {
      return Response.json({ error: { code: "1308",
        message: `Usage limit reached. Your limit will reset at ${providerBareTimestamp(Date.now() + 350)}. Received Model Group=glm-5.3`,
      } }, { status: 429 });
    }
    if (body.testCase === "usage-reset-wrapped" && call === 1) {
      return Response.json({ error: { code: "429",
        message: `RateLimitError: Usage limit reached. Your limit will reset at ${new Date(Date.now() + 350).toISOString()}. Received Model Group=glm-5.3`,
      } }, { status: 429 });
    }
    if (body.testCase === "usage-invalid-reset" && call === 1) {
      return Response.json({ error: { code: "1308", message: "Usage limit reached. Your limit will reset at invalid-date." } },
        { status: 429 });
    }
    if (["fair-usage", "fair-usage-wrapped"].includes(body.testCase)) {
      return Response.json({ error: { code: body.testCase === "fair-usage" ? "1313" : "429",
        message: "RateLimitError: code 1313. Your account usage pattern does not comply with the Fair Usage Policy.",
      } }, { status: 429 });
    }
    if (body.testCase === "large-error") {
      return Response.json({ error: { code: "high_demand", message: "x".repeat(70_000) } }, { status: 429 });
    }
    if (body.testCase === "oversized-fair-usage") {
      return Response.json({ error: { code: "1313", message: providerSentinel + "x".repeat(70_000) } }, { status: 429 });
    }
    if (body.testCase === "hanging429") {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"error":{"code":"1313","message":"unfinished"'));
        },
      }), { status: 429, headers: { "content-type": "application/json" } });
    }
    if (body.testCase === "default-no-retry") {
      return Response.json({ error: { code: "high_demand", message: "busy" } }, { status: 429 });
    }
    if (body.testCase === "slow") await Bun.sleep(500);
    if (body.testCase === "timeout") await Bun.sleep(1_500);
    if (body.testCase === "stream") {
      return new Response('event: response.completed\ndata: {"type":"response.completed"}\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (body.testCase === "held-stream") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"held":'));
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("true}"));
            controller.close();
          }, 700);
        },
      });
      return new Response(stream, { headers: { "content-type": "application/json" } });
    }
    if (body.testCase === "never-stream") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: response.output_text.delta\ndata: {}\n\n"));
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ ok: true, testCase: body.testCase });
  },
});

const child = Bun.spawn([process.execPath, bridgePath], {
  env: {
    ...process.env,
    LITELLM_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    GLM_RESPONSES_BRIDGE_PORT: String(bridgePort),
    GLM_RESPONSES_MAX_IN_FLIGHT: "2",
    GLM_RESPONSES_MAX_REQUEST_BYTES: "1048576",
    GLM_RESPONSES_MAX_TRANSIENT_RETRIES: "2",
    GLM_RESPONSES_MAX_RETRY_DELAY_MS: "2000",
    GLM_RESPONSES_GENERIC_429_DELAY_MS: "50",
    GLM_RESPONSES_MAX_SERVER_ERROR_DELAY_MS: "50",
    GLM_RESPONSES_USAGE_RESET_SAFETY_MS: "20",
    GLM_RESPONSES_ERROR_INSPECTION_TIMEOUT_MS: "100",
    GLM_RESPONSES_READINESS_TIMEOUT_MS: "500",
    GLM_RESPONSES_UPSTREAM_TIMEOUT_MS: "1000",
  },
  stdout: "pipe",
  stderr: "pipe",
});
let defaultChild = null;

async function waitReady(port = bridgePort) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/readiness`);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(25);
  }
  throw new Error("self-test bridge readiness timeout");
}

async function request(path, options = {}) {
  return await fetch(`http://127.0.0.1:${bridgePort}${path}`, options);
}

async function post(body, options = {}) {
  return await request("/v1/responses", {
    method: "POST",
    signal: options.signal,
    headers: {
      authorization,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

function phase(name) {
  process.stdout.write(`SELF_TEST_PHASE ${name}\n`);
}

try {
  phase("readiness");
  await waitReady();
  phase("request-boundaries");
  equal((await request("/health/liveliness")).status, 200, "liveliness");
  equal((await request("/unknown")).status, 404, "unknown route");
  equal(
    (await request("/v1/responses", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status,
    401,
    "missing auth",
  );
  equal(
    (await request("/v1/responses", { method: "POST", headers: { authorization, "content-type": "text/plain" }, body: "{}" })).status,
    415,
    "content type",
  );
  equal((await post("{" )).status, 400, "invalid JSON");

  phase("transient-retry");
  const retried = await post({ testCase: "transient" });
  equal(retried.status, 200, "transient status");
  equal(transientCalls, 3, "transient attempts");
  for (const testCase of ["bad-gateway", "gateway-timeout"]) {
    const response = await post({ testCase });
    equal(response.status, 200, testCase + " recovered");
    equal(calls.get(testCase), 2, testCase + " attempts");
  }

  phase("provider-429-policy");
  const genericStarted = Date.now();
  const generic = await post({ testCase: "generic429", stream: true });
  equal(generic.status, 200, "generic 429 recovered");
  equal(calls.get("generic429"), 2, "generic 429 attempts");
  if (Date.now() - genericStarted < 35) throw new Error("generic 429 wait was skipped");
  for (const testCase of ["usage-reset-bare", "usage-reset-wrapped"]) {
    const started = Date.now();
    const response = await post({ testCase, stream: true });
    equal(response.status, 200, testCase + " recovered");
    equal(calls.get(testCase), 2, testCase + " attempts");
    const elapsed = Date.now() - started;
    if (elapsed < 200 || elapsed > 950) {
      throw new Error(testCase + " reset delay invalid: " + elapsed + " ms");
    }
  }
  const invalidResetStarted = Date.now();
  const invalidReset = await post({ testCase: "usage-invalid-reset", stream: true });
  equal(invalidReset.status, 200, "invalid reset falls back to bounded generic retry");
  equal(calls.get("usage-invalid-reset"), 2, "invalid reset attempts");
  if (Date.now() - invalidResetStarted < 35) throw new Error("invalid reset skipped generic 429 wait");
  for (const testCase of ["fair-usage", "fair-usage-wrapped"]) {
    const response = await post({ testCase, stream: true });
    equal(response.status, 429, testCase + " terminal status");
    equal(response.headers.get("x-glm-retry-class"), "FAIR_USAGE", testCase + " retry class");
    equal(calls.get(testCase), 1, testCase + " attempts");
    await response.body?.cancel().catch(() => undefined);
  }
  const largeError = await post({ testCase: "large-error", stream: true });
  equal(largeError.status, 429, "large provider error terminal status");
  equal(largeError.headers.get("x-glm-retry-class"), "UPSTREAM_429_UNINSPECTABLE", "large provider error retry class");
  equal(calls.get("large-error"), 1, "large provider error did not retry");
  equal((await largeError.json()).error.code, "UPSTREAM_429_UNINSPECTABLE", "large provider error sanitized");
  phase("incomplete-429-fail-closed");
  const [oversizedResult, hangingResult] = await Promise.allSettled([
    post({ testCase: "oversized-fair-usage", stream: true }, { signal: AbortSignal.timeout(750) }),
    post({ testCase: "hanging429", stream: true }, { signal: AbortSignal.timeout(750) }),
  ]);
  const incompleteProblems = [];
  for (const [testCase, result] of [["oversized-fair-usage", oversizedResult], ["hanging429", hangingResult]]) {
    if (result.status !== "fulfilled") {
      incompleteProblems.push(`${testCase}: no bounded response`);
      continue;
    }
    const response = result.value;
    const body = await response.json().catch(() => null);
    if (response.status !== 429 || response.headers.get("x-glm-retry-class") !== "UPSTREAM_429_UNINSPECTABLE" ||
        body?.error?.code !== "UPSTREAM_429_UNINSPECTABLE") {
      incompleteProblems.push(`${testCase}: did not return sanitized 429`);
    }
    if (JSON.stringify(body).includes(providerSentinel) || JSON.stringify(body).includes("unfinished")) {
      incompleteProblems.push(`${testCase}: exposed provider error content`);
    }
    if (calls.get(testCase) !== 1) incompleteProblems.push(`${testCase}: retried upstream`);
  }
  if (incompleteProblems.length > 0) throw new Error(incompleteProblems.join("; "));
  const defaultEnv = {
    ...process.env,
    LITELLM_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    GLM_RESPONSES_BRIDGE_PORT: String(defaultBridgePort),
    GLM_RESPONSES_UPSTREAM_TIMEOUT_MS: "1000",
    GLM_RESPONSES_ERROR_INSPECTION_TIMEOUT_MS: "100",
  };
  delete defaultEnv.GLM_RESPONSES_MAX_TRANSIENT_RETRIES;
  defaultChild = Bun.spawn([process.execPath, bridgePath], {
    env: defaultEnv, stdout: "pipe", stderr: "pipe",
  });
  await waitReady(defaultBridgePort);
  const noRetry = await fetch(`http://127.0.0.1:${defaultBridgePort}/v1/responses`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ testCase: "default-no-retry", stream: true }),
  });
  equal(noRetry.status, 429, "default no retry status");
  equal(noRetry.headers.get("x-glm-retry-class"), "RETRIES_DISABLED", "default no retry class");
  equal(calls.get("default-no-retry"), 1, "default no retry attempts");
  await noRetry.body?.cancel().catch(() => undefined);
  const defaultHang = await fetch(`http://127.0.0.1:${defaultBridgePort}/v1/responses`, {
    method: "POST",
    signal: AbortSignal.timeout(750),
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ testCase: "hanging429", stream: true }),
  });
  equal(defaultHang.status, 429, "default hanging 429 bounded status");
  equal((await defaultHang.json()).error.code, "UPSTREAM_429_UNINSPECTABLE", "default hanging 429 sanitized");
  equal(calls.get("hanging429"), 2, "default hanging 429 did not retry");
  defaultChild.kill("SIGTERM");
  await defaultChild.exited;
  defaultChild = null;

  phase("tool-loop-guards");
  const hash = (digit) => String(digit).repeat(64);
  const selfHashLoop = Array.from({ length: 3 }, (_, index) => {
    const n = index + 1;
    return [
      { type: "function_call", name: "exec_command", call_id: "hash-" + n,
        arguments: JSON.stringify({ workdir: "/test/source",
          cmd: "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: ../HANDOFF.md\n@@\n-- digest " +
            hash(n) + "\n+- digest " + hash(n + 1) +
            "\n*** End Patch\nPATCH\nshasum -a 256 ../HANDOFF.md" }) },
      { type: "function_call_output", call_id: "hash-" + n,
        output: "Process exited with code 0\nOutput:\n" + hash(n + 2) + "  ../HANDOFF.md\n" },
    ];
  }).flat();
  for (const stream of [true, false]) {
    const testCase = "self-hash-" + stream;
    const response = await post({ testCase, stream, input: selfHashLoop });
    equal(response.status, 422, testCase + " stopped");
    equal(response.headers.get("x-glm-retry-class"), "LOCAL_TOOL_LOOP", testCase + " retry class");
    equal((await response.json()).error.code, "GLM_TOOL_LOOP_SELF_HASH", testCase + " code");
    equal(calls.get(testCase), undefined, testCase + " upstream calls");
  }
  const correctedHash = await post({ testCase: "self-hash-corrected", stream: true,
    input: [...selfHashLoop, { type: "message", role: "user", content: "Store the digest outside the report." }] });
  equal(correctedHash.status, 200, "self hash correction resumes");
  equal(calls.get("self-hash-corrected"), 1, "self hash correction upstream calls");
  const twoHashes = await post({ testCase: "self-hash-two", input: selfHashLoop.slice(0, 4) });
  equal(twoHashes.status, 200, "two digest edits pass");
  equal(calls.get("self-hash-two"), 1, "two digest edits upstream calls");
  const readLoop = Array.from({ length: 8 }, (_, index) => [
    { type: "function_call", name: "exec_command", call_id: "read-" + index,
      arguments: JSON.stringify({ workdir: "/test/source",
        cmd: 'rg -n "operationId" source' + (index % 2) + ".ts | cat" }) },
    { type: "function_call_output", call_id: "read-" + index,
      output: "Chunk ID: sample" + index +
        "\nWall time: 0.1 seconds\nProcess exited with code 0\nOutput:\n12:const operationId = operation.id;\n" },
  ]).flat();
  for (const stream of [true, false]) {
    const testCase = "read-loop-" + stream;
    const response = await post({ testCase, stream, input: readLoop });
    equal(response.status, 422, testCase + " stopped");
    equal((await response.json()).error.code, "GLM_TOOL_LOOP_READ_ONLY", testCase + " code");
    equal(calls.get(testCase), undefined, testCase + " upstream calls");
  }
  const correctedRead = await post({ testCase: "read-corrected", input: [
    ...readLoop, { type: "message", role: "user", content: "Use the acquired output to implement the fix." },
  ] });
  equal(correctedRead.status, 200, "read correction resumes");
  equal(calls.get("read-corrected"), 1, "read correction upstream calls");
  const changedReadLoop = structuredClone(readLoop);
  changedReadLoop.at(-1).output = changedReadLoop.at(-1).output.replace("12:const", "13:const");
  const changedRead = await post({ testCase: "read-changed", input: changedReadLoop });
  equal(changedRead.status, 200, "changed source output passes");
  equal(calls.get("read-changed"), 1, "changed source upstream calls");

  phase("stream");
  const streamed = await post({ stream: true, testCase: "stream" });
  equal(streamed.status, 200, "stream status");
  if (!(await streamed.text()).includes("response.completed")) throw new Error("stream body missing");

  phase("concurrency");
  const concurrent = await Promise.all(Array.from({ length: 3 }, () => post({ testCase: "slow" })));
  equal(concurrent.filter((response) => response.status === 200).length, 2, "concurrency admitted");
  equal(concurrent.filter((response) => response.status === 503).length, 1, "concurrency refused");

  phase("stream-capacity");
  const heldA = await post({ testCase: "held-stream" });
  const heldB = await post({ testCase: "held-stream" });
  equal((await post({ testCase: "ordinary-while-streaming" })).status, 503, "stream permit held");
  equal((await heldA.json()).held, true, "first held stream completed");
  equal((await heldB.json()).held, true, "second held stream completed");

  phase("stream-cancel-bounded-release");
  const cancelledA = await post({ testCase: "held-stream" });
  const cancelledB = await post({ testCase: "held-stream" });
  await cancelledA.body.cancel();
  await cancelledB.body.cancel();
  // A fetch client may drain a cancelled HTTP body to reuse the connection, so
  // the server cannot assume application-level cancel is a transport close.
  // The permits must still release when both upstream streams terminate.
  await Bun.sleep(800);
  equal((await post({ testCase: "after-stream-cancel" })).status, 200, "cancelled stream terminates");

  phase("stream-timeout-release");
  const neverA = await post({ testCase: "never-stream" });
  const neverB = await post({ testCase: "never-stream" });
  equal((await post({ testCase: "while-never-streaming" })).status, 503, "never stream holds permit");
  await Bun.sleep(1_100);
  equal((await post({ testCase: "after-stream-timeout" })).status, 200, "stream timeout releases permit");
  await neverA.body?.cancel().catch(() => undefined);
  await neverB.body?.cancel().catch(() => undefined);

  phase("timeout");
  equal((await post({ testCase: "timeout" })).status, 504, "upstream timeout");

  // Run the intentional unread/oversized request last. Some HTTP clients do
  // not reuse a connection after the server rejects a body before consuming it.
  phase("body-limit");
  const oversized = JSON.stringify({ value: "x".repeat(1_048_576) });
  equal((await post(oversized)).status, 413, "body limit");

  phase("shutdown");
  child.kill("SIGTERM");
  await child.exited;
  const output = `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`;
  if (output.includes(authorization)) throw new Error("bridge leaked authorization");
  if (output.includes(providerSentinel)) throw new Error("bridge logged provider error body");
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", retries: transientCalls, concurrency: 2, ports: [bridgePort, backendPort] })}\n`,
  );
} finally {
  if (defaultChild !== null) {
    defaultChild.kill("SIGKILL");
    await defaultChild.exited.catch(() => undefined);
  }
  child.kill("SIGKILL");
  await child.exited.catch(() => undefined);
  backend.stop(true);
}

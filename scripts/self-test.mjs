import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const bridgePath = resolve(repositoryRoot, "bridge/responses-bridge.mjs");
const backendPort = Number(process.env.NATIVE_GLM_TEST_BACKEND_PORT ?? 47925);
const bridgePort = Number(process.env.NATIVE_GLM_TEST_BRIDGE_PORT ?? 47921);
const authorization = "Bearer test-bridge-token-do-not-use";
let transientCalls = 0;

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
    if (body.testCase === "transient") {
      transientCalls += 1;
      if (transientCalls < 3) {
        return Response.json({ error: "retry" }, { status: 503, headers: { "retry-after": "0" } });
      }
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
    GLM_RESPONSES_READINESS_TIMEOUT_MS: "500",
    GLM_RESPONSES_UPSTREAM_TIMEOUT_MS: "1000",
  },
  stdout: "pipe",
  stderr: "pipe",
});

async function waitReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${bridgePort}/health/readiness`);
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
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", retries: transientCalls, concurrency: 2, ports: [bridgePort, backendPort] })}\n`,
  );
} finally {
  child.kill("SIGKILL");
  await child.exited.catch(() => undefined);
  backend.stop(true);
}

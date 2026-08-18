const LOOPBACK_NAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

function integerFromEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function loopbackBackendUrl() {
  const value = process.env.LITELLM_BACKEND_URL ?? "http://127.0.0.1:47825";
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LITELLM_BACKEND_URL_INVALID");
  }
  if (url.protocol !== "http:" || !LOOPBACK_NAMES.has(url.hostname) || url.username || url.password) {
    throw new Error("LITELLM_BACKEND_URL_NOT_LOOPBACK");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("LITELLM_BACKEND_URL_INVALID");
  }
  return url;
}

const backendBaseUrl = loopbackBackendUrl();
const listenPort = integerFromEnvironment("GLM_RESPONSES_BRIDGE_PORT", 47821, 1, 65_535);
const upstreamTimeoutMs = integerFromEnvironment(
  "GLM_RESPONSES_UPSTREAM_TIMEOUT_MS",
  1_800_000,
  1_000,
  1_800_000,
);
const readinessTimeoutMs = integerFromEnvironment(
  "GLM_RESPONSES_READINESS_TIMEOUT_MS",
  2_000,
  100,
  30_000,
);
const maximumTransientRetries = integerFromEnvironment(
  "GLM_RESPONSES_MAX_TRANSIENT_RETRIES",
  0,
  0,
  3,
);
const maximumRequestBytes = integerFromEnvironment(
  "GLM_RESPONSES_MAX_REQUEST_BYTES",
  33_554_432,
  1_048_576,
  134_217_728,
);
const maximumInFlight = integerFromEnvironment("GLM_RESPONSES_MAX_IN_FLIGHT", 8, 1, 32);

let inFlight = 0;
let shuttingDown = false;

function requestSignal(request) {
  const timeout = AbortSignal.timeout(upstreamTimeoutMs);
  return typeof AbortSignal.any === "function" ? AbortSignal.any([request.signal, timeout]) : timeout;
}

function retryDelayMs(response, attemptIndex) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(30_000, Math.ceil(seconds * 1_000));
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(30_000, Math.max(0, retryAt - Date.now()));
    }
  }
  const base = Math.min(8_000, 500 * 2 ** attemptIndex);
  return base + Math.floor(Math.random() * 250);
}

function upstreamHeaders(request) {
  const authorization = request.headers.get("authorization");
  if (authorization === null || authorization.length < 8 || authorization.length > 8_192) {
    return null;
  }
  return new Headers({
    accept: "text/event-stream, application/json",
    authorization,
    "content-type": "application/json",
  });
}

function publicResponseHeaders(upstream) {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null) headers.set("retry-after", retryAfter);
  const requestId = upstream.headers.get("x-request-id");
  if (requestId !== null && requestId.length <= 256) headers.set("x-request-id", requestId);
  return headers;
}

async function readBoundedBody(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const value = Number(declared);
    if (!Number.isSafeInteger(value) || value < 0 || value > maximumRequestBytes) {
      await request.body?.cancel().catch(() => undefined);
      throw new RangeError("REQUEST_TOO_LARGE");
    }
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumRequestBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RangeError("REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function fetchWithRetry(headers, body, request) {
  const url = new URL("/v1/responses", backendBaseUrl);
  const signal = requestSignal(request);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal,
    });
    if (!TRANSIENT_STATUSES.has(response.status) || attempt >= maximumTransientRetries) {
      return response;
    }
    await response.body?.cancel().catch(() => undefined);
    await Bun.sleep(retryDelayMs(response, attempt));
  }
}

async function backendIsReady() {
  try {
    const response = await fetch(new URL("/health/liveliness", backendBaseUrl), {
      signal: AbortSignal.timeout(readinessTimeoutMs),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

function jsonError(status, code) {
  return Response.json(
    { error: { code, message: code } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function streamWithPermit(source, release) {
  const reader = source.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health/liveliness") {
    return Response.json({ service: "codex-native-glm-responses-bridge", status: "ok" });
  }
  if (request.method === "GET" && url.pathname === "/health/readiness") {
    const ready = !shuttingDown && (await backendIsReady());
    return Response.json(
      { service: "codex-native-glm-responses-bridge", status: ready ? "ok" : "unavailable" },
      { status: ready ? 200 : 503 },
    );
  }
  if (request.method !== "POST" || url.pathname !== "/v1/responses" || url.search || url.hash) {
    return jsonError(404, "NOT_FOUND");
  }
  if (shuttingDown) return jsonError(503, "SHUTTING_DOWN");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return jsonError(415, "CONTENT_TYPE_REQUIRED");
  const headers = upstreamHeaders(request);
  if (headers === null) return jsonError(401, "BRIDGE_AUTH_REQUIRED");
  if (inFlight >= maximumInFlight) return jsonError(503, "BRIDGE_CAPACITY_EXHAUSTED");

  inFlight += 1;
  let released = false;
  let streamOwnsPermit = false;
  const releasePermit = () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
  try {
    let body;
    try {
      body = await readBoundedBody(request);
    } catch (error) {
      return error instanceof RangeError
        ? jsonError(413, "REQUEST_TOO_LARGE")
        : jsonError(400, "REQUEST_BODY_INVALID");
    }
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      return jsonError(400, "INVALID_JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError(400, "REQUEST_OBJECT_REQUIRED");
    }
    const upstream = await fetchWithRetry(headers, body, request);
    const responseBody = upstream.body === null
      ? null
      : streamWithPermit(upstream.body, releasePermit);
    const response = new Response(responseBody, {
      status: upstream.status,
      headers: publicResponseHeaders(upstream),
    });
    streamOwnsPermit = responseBody !== null;
    return response;
  } catch (error) {
    const code = error instanceof DOMException && error.name === "TimeoutError"
      ? "UPSTREAM_TIMEOUT"
      : request.signal.aborted
        ? "CLIENT_ABORTED"
        : "UPSTREAM_UNAVAILABLE";
    return jsonError(code === "UPSTREAM_TIMEOUT" ? 504 : 502, code);
  } finally {
    if (!streamOwnsPermit) releasePermit();
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: listenPort,
  idleTimeout: 0,
  fetch: handleRequest,
  error() {
    return jsonError(500, "BRIDGE_INTERNAL_ERROR");
  },
});

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  // The supervisor owns both local processes. A bounded shutdown is more
  // important than preserving idle keep-alive sockets after SIGTERM.
  server.stop(true);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.stdout.write(`codex-native-glm Responses bridge listening on 127.0.0.1:${listenPort}\n`);

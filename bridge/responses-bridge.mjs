import { detectSelfHashToolLoop, detectRepeatedReadOnlyToolLoop, toolLoopError } from "./tool-loop-guard.mjs";

const LOOPBACK_NAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const PROVIDER_ERROR_LIMIT = 65_536;

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
  30_600_000,
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
  6,
);
const maximumRetryDelayMs = integerFromEnvironment("GLM_RESPONSES_MAX_RETRY_DELAY_MS", 28_800_000, 0, 28_800_000);
const generic429DelayMs = integerFromEnvironment("GLM_RESPONSES_GENERIC_429_DELAY_MS", 300_000, 0, 28_800_000);
const maximumServerErrorDelayMs = integerFromEnvironment("GLM_RESPONSES_MAX_SERVER_ERROR_DELAY_MS", 30_000, 0, 30_000);
const usageResetSafetyMs = integerFromEnvironment("GLM_RESPONSES_USAGE_RESET_SAFETY_MS", 5_000, 0, 60_000);
const errorInspectionTimeoutMs = integerFromEnvironment("GLM_RESPONSES_ERROR_INSPECTION_TIMEOUT_MS", 2_000, 100, 10_000);
const providerBareResetOffset = process.env.GLM_RESPONSES_PROVIDER_RESET_OFFSET ?? "+08:00";
if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/u.test(providerBareResetOffset) ||
    (providerBareResetOffset.startsWith("+14:") || providerBareResetOffset.startsWith("-14:")) &&
      !providerBareResetOffset.endsWith(":00")) {
  throw new Error("GLM_RESPONSES_PROVIDER_RESET_OFFSET_INVALID");
}
const maximumRequestBytes = integerFromEnvironment(
  "GLM_RESPONSES_MAX_REQUEST_BYTES",
  33_554_432,
  1_048_576,
  134_217_728,
);
const maximumInFlight = integerFromEnvironment("GLM_RESPONSES_MAX_IN_FLIGHT", 8, 1, 32);

let inFlight = 0;
let shuttingDown = false;

function requestSignal(request, upstreamAbortSignal) {
  const timeout = AbortSignal.timeout(upstreamTimeoutMs);
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([request.signal, timeout, upstreamAbortSignal])
    : timeout;
}

function retryAfterDelayMs(response) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maximumRetryDelayMs, Math.ceil(seconds * 1_000));
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(maximumRetryDelayMs, Math.max(0, retryAt - Date.now()));
    }
  }
  return null;
}

async function providerErrorDetails(response) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > PROVIDER_ERROR_LIMIT) {
      return { complete: false };
    }
  }
  let reader;
  try {
    reader = response.clone().body?.getReader();
  } catch {
    return { complete: false };
  }
  if (!reader) return { complete: true, code: null, message: "" };
  const chunks = [];
  let length = 0;
  let chunkCount = 0;
  let complete = false;
  const expired = Symbol("error inspection deadline");
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(expired), errorInspectionTimeoutMs);
  });
  try {
    while (length <= PROVIDER_ERROR_LIMIT) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === expired) return { complete: false };
      const { done, value } = next;
      if (done) {
        complete = true;
        break;
      }
      chunkCount += 1;
      if (chunkCount > 256) return { complete: false };
      length += value.byteLength;
      if (length > PROVIDER_ERROR_LIMIT) return { complete: false };
      chunks.push(value);
    }
  } catch {
    return { complete: false };
  } finally {
    clearTimeout(timer);
    // A clone is one branch of a tee. Awaiting cancellation can wait for the
    // original branch that we still need to return to the client.
    if (!complete) reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const message = new TextDecoder().decode(bytes);
  try {
    const error = JSON.parse(message)?.error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      return {
        complete: true,
        code: error.code === undefined || error.code === null ? null : String(error.code),
        message: typeof error.message === "string" ? error.message : message,
      };
    }
  } catch {}
  return { complete: true, code: null, message };
}

function effectiveProviderCode(details) {
  if (details.code === "1313" || details.code === "1308") return details.code;
  const text = `${details.code ?? ""} ${details.message}`;
  if (/\b1313\b|Fair Usage Policy/iu.test(text)) return "1313";
  if (/\b1308\b|Usage limit reached/iu.test(text)) return "1308";
  return details.code;
}

function usageResetAt(message) {
  const match = message.match(
    /(?:limit will reset|resets?) at\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/iu,
  );
  if (!match) return null;
  const raw = match[1].replace(/\.$/u, "");
  const explicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/iu.test(raw);
  // Z.AI emits bare wall-clock timestamps in UTC+08:00. A host-local parse
  // can resume an hour late when the host runs in Bangkok's UTC+07:00.
  const normalized = explicitOffset ? raw.replace(" ", "T") : `${raw.replace(" ", "T")}${providerBareResetOffset}`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function retryDecision(response, attempt) {
  if (!TRANSIENT_STATUSES.has(response.status)) return { retry: false, retryClass: "NON_TRANSIENT" };
  // Only 429 needs provider-body inspection. Server errors can be retried
  // from their status alone, avoiding a read of an arbitrary error stream.
  const details = response.status === 429 ? await providerErrorDetails(response) : null;
  if (details && !details.complete) {
    return { retry: false, retryClass: "UPSTREAM_429_UNINSPECTABLE", localError: true };
  }
  const providerCode = details ? effectiveProviderCode(details) : null;
  if (response.status === 429 && providerCode === "1313") {
    return { retry: false, retryClass: "FAIR_USAGE" };
  }
  if (maximumTransientRetries === 0) return { retry: false, retryClass: "RETRIES_DISABLED" };
  if (attempt >= maximumTransientRetries) return { retry: false, retryClass: "RETRY_EXHAUSTED" };
  const retryAfter = retryAfterDelayMs(response);
  if (response.status === 429 && providerCode === "1308") {
    const resetAt = usageResetAt(details.message);
    if (resetAt !== null) {
      return {
        retry: true,
        retryClass: "USAGE_WINDOW",
        delayMs: Math.min(maximumRetryDelayMs, Math.max(0, resetAt - Date.now()) + usageResetSafetyMs),
      };
    }
  }
  if (response.status === 429) {
    return { retry: true, retryClass: "GENERIC_429", delayMs: retryAfter ?? Math.min(maximumRetryDelayMs, generic429DelayMs) };
  }
  const base = Math.min(maximumServerErrorDelayMs, 500 * 2 ** attempt);
  return {
    retry: true,
    retryClass: "SERVER_TRANSIENT",
    delayMs: retryAfter ?? Math.min(maximumServerErrorDelayMs, base + Math.floor(Math.random() * 250)),
  };
}

function sleepWithSignal(delayMs, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("request aborted"));
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("request aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
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

function publicResponseHeaders(upstream, retryClass) {
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
  headers.set("x-glm-retry-class", retryClass);
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
  const upstreamAbort = new AbortController();
  const signal = requestSignal(request, upstreamAbort.signal);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal,
    });
    const decision = await retryDecision(response, attempt);
    if (decision.localError) {
      upstreamAbort.abort();
      response.body?.cancel().catch(() => undefined);
      return { localError: true, retryClass: decision.retryClass };
    }
    if (!decision.retry) {
      // Return the untouched provider response. The bridge never replays a
      // successful stream after bytes have reached the client.
      return { response, retryClass: decision.retryClass };
    }
    process.stderr.write(`${JSON.stringify({
      event: "glm_upstream_retry",
      retryClass: decision.retryClass,
      attempt: attempt + 1,
      delayMs: decision.delayMs,
    })}\n`);
    await response.body?.cancel().catch(() => undefined);
    await sleepWithSignal(decision.delayMs, signal);
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

function uninspectable429() {
  return Response.json(
    { error: { code: "UPSTREAM_429_UNINSPECTABLE", message: "Upstream 429 could not be inspected safely; automatic retry stopped." } },
    { status: 429, headers: { "cache-control": "no-store", "x-glm-retry-class": "UPSTREAM_429_UNINSPECTABLE" } },
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
    if (detectSelfHashToolLoop(parsed.input)) {
      return toolLoopError("GLM_TOOL_LOOP_SELF_HASH",
        "Stopped repeated self-checksum rewrites. Keep the digest outside the file being hashed; do not retry unchanged history.");
    }
    if (detectRepeatedReadOnlyToolLoop(parsed.input)) {
      return toolLoopError("GLM_TOOL_LOOP_READ_ONLY",
        "Stopped eight repeated successful source reads without new information. Reuse the acquired output and continue with a different causal action.");
    }
    const { response: upstream, retryClass, localError } = await fetchWithRetry(headers, body, request);
    if (localError) return uninspectable429();
    const responseBody = upstream.body === null
      ? null
      : streamWithPermit(upstream.body, releasePermit);
    const response = new Response(responseBody, {
      status: upstream.status,
      headers: publicResponseHeaders(upstream, retryClass),
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

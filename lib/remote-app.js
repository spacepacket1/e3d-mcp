/**
 * Express app factory for the public remote MCP server (server-remote.js),
 * served at https://mcp.e3d.ai/mcp for ChatGPT and other remote clients.
 *
 * Distinct from lib/http-app.js, which is the narrower LiquidityWatch-only
 * app on liquiditywatch.e3d.ai and is left untouched. This one exposes the
 * full READ_ONLY_TOOLS surface from lib/read-tools.js — and nothing else.
 *
 * Security model
 *  - Tool surface: READ_ONLY_TOOLS only. claim_token / update_token_claim /
 *    get_wallet_claims and agent treasury tools are not registered here, so
 *    they cannot be called by any client, whatever it sends.
 *  - Credentials: the server holds NO E3D credential. A caller may present
 *    their own E3D API key (Authorization: Bearer <key>, or x-api-key); it is
 *    forwarded upstream per-request so e3d.ai applies that key's own tier,
 *    entitlements and quotas. Callers without a key get the anonymous tier.
 *    The process-level E3D_API_KEY is deliberately never used here (every
 *    upstream call passes apiKey: null or the caller's key).
 *  - MCP_HTTP_REQUIRE_AUTH=true rejects keyless requests with 401.
 *  - Rate limiting is local and additive to e3d.ai's own: keyed by API-key
 *    hash when a key is presented, else by client IP.
 *  - Logs are one JSON object per request; bodies, tool arguments and
 *    credentials are never logged.
 */

import { randomUUID, createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { okStructured, ok } from "./e3d-api.js";
import { READ_ONLY_TOOLS, registerReadOnlyTool } from "./read-tools.js";

export const SERVER_NAME = "e3d-ai-remote";
export const SERVER_VERSION = "1.0.0";

// API keys are opaque tokens; anything outside this charset/length is not a
// legitimate E3D key and is rejected before it gets anywhere near a header.
const API_KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;

/** Returns { apiKey } (string|null) or { error } for a malformed credential. */
export function extractApiKey(req) {
  const auth = String(req.headers["authorization"] || "").trim();
  let raw = "";
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth);
    if (!m) return { error: "Authorization header must be 'Bearer <E3D API key>'" };
    raw = m[1];
  } else {
    raw = String(req.headers["x-api-key"] || "").trim();
  }
  if (!raw) return { apiKey: null };
  if (!API_KEY_PATTERN.test(raw)) return { error: "Malformed API key" };
  return { apiKey: raw };
}

/**
 * Map any thrown error to a stable, client-safe shape. Upstream response
 * bodies and stack traces are never forwarded — only a code, a short message,
 * and retry hints.
 */
export function toStructuredError(err) {
  const status = err && err.status;
  if (err && err.code === "UPSTREAM_TIMEOUT") {
    return { code: "upstream_timeout", message: "The E3D API did not respond in time. Try again shortly.", retryable: true };
  }
  if (err && err.code === "TOOL_TIMEOUT") {
    return { code: "upstream_timeout", message: "The request took too long. Try again or narrow the query.", retryable: true };
  }
  if (err && err.code === "RESPONSE_TOO_LARGE") {
    return { code: "response_too_large", message: err.message, retryable: false };
  }
  if (status === 401) return { code: "unauthorized", message: "The E3D API rejected the credentials or requires an API key for this data.", retryable: false, upstream_status: 401 };
  if (status === 403) return { code: "forbidden", message: "Your E3D API key is not entitled to this data.", retryable: false, upstream_status: 403 };
  if (status === 404) return { code: "not_found", message: "No data found for that request.", retryable: false, upstream_status: 404 };
  if (status === 429) {
    const out = { code: "rate_limited", message: "E3D API rate limit reached. Wait before retrying.", retryable: true, upstream_status: 429 };
    const retryMs = err.upstreamBody && err.upstreamBody.retry_after_ms;
    if (Number.isFinite(retryMs)) out.retry_after_ms = retryMs;
    return out;
  }
  if (status >= 400 && status < 500) return { code: "bad_request", message: "The E3D API rejected the request.", retryable: false, upstream_status: status };
  if (status >= 500) return { code: "upstream_error", message: "The E3D API is temporarily unavailable.", retryable: true, upstream_status: status };
  return { code: "internal_error", message: "Unexpected error while running the tool.", retryable: false };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("tool timed out"), { code: "TOOL_TIMEOUT" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function makeLogger({ quiet, sink }) {
  return (entry) => {
    if (quiet) return;
    (sink || ((line) => console.log(line)))(JSON.stringify({ ts: new Date().toISOString(), svc: "e3d-mcp-remote", ...entry }));
  };
}

/** Build a per-request McpServer whose tools run with this caller's credential only. */
function buildMcpServer({ apiKey, toolTimeoutMs, maxResponseBytes, log, reqId }) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of READ_ONLY_TOOLS) {
    registerReadOnlyTool(server, tool, async (t, args) => {
      const started = Date.now();
      try {
        const data = await withTimeout(t.handler(args, { apiKey }), toolTimeoutMs);
        const result = t.outputSchema ? okStructured(data) : ok(data);
        const size = Buffer.byteLength(result.content[0].text);
        if (size > maxResponseBytes) {
          throw Object.assign(
            new Error(`Response is ${size} bytes, over the ${maxResponseBytes}-byte limit. Retry with a smaller limit or a more specific query.`),
            { code: "RESPONSE_TOO_LARGE" },
          );
        }
        log({ level: "info", event: "tool_call", reqId, tool: t.name, ok: true, ms: Date.now() - started, bytes: size });
        return result;
      } catch (err) {
        const structured = toStructuredError(err);
        log({ level: structured.code === "internal_error" ? "error" : "warn", event: "tool_call", reqId, tool: t.name, ok: false, code: structured.code, ms: Date.now() - started, detail: structured.code === "internal_error" ? String(err && err.message).slice(0, 200) : undefined });
        // Errors are returned in-band (isError) so the model can read and act
        // on them. No outputSchema applies to error results.
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: structured }) }],
          structuredContent: { error: structured },
        };
      }
    });
  }
  return server;
}

function jsonRpcError(res, status, code, message, extraHeaders = {}) {
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/**
 * @param {object} [o]
 * @param {string} [o.host]
 * @param {string[]} [o.allowedHosts] - accepted Host headers (production: mcp.e3d.ai)
 * @param {boolean} [o.requireAuth] - reject requests without an E3D API key
 * @param {number} [o.rateLimitWindowMs]
 * @param {number} [o.rateLimitMax] - per API key (or per IP when anonymous) per window
 * @param {number} [o.toolTimeoutMs] - wall-clock cap on one tool call (incl. upstream)
 * @param {number} [o.maxResponseBytes]
 * @param {boolean} [o.quiet]
 * @param {(line: string) => void} [o.logSink] - test hook; defaults to console.log
 */
export function createRemoteApp({
  host = "127.0.0.1",
  allowedHosts = [],
  requireAuth = false,
  rateLimitWindowMs = 60_000,
  rateLimitMax = 120,
  toolTimeoutMs = 25_000,
  maxResponseBytes = 512 * 1024,
  quiet = false,
  logSink,
} = {}) {
  const log = makeLogger({ quiet, sink: logSink });
  const app = createMcpExpressApp(allowedHosts.length ? { host, allowedHosts } : { host });
  app.disable("x-powered-by");
  // Exactly one proxy hop (nginx) — see lib/http-app.js for why.
  app.set("trust proxy", 1);

  // Request id, baseline security headers, access log (no bodies/credentials).
  app.use((req, res, next) => {
    const start = Date.now();
    const reqId = randomUUID();
    req.reqId = reqId;
    res.setHeader("X-Request-Id", reqId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.on("finish", () => {
      log({
        level: res.statusCode >= 500 ? "error" : "info",
        event: "http_request",
        reqId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        ip: req.ip,
        authenticated: Boolean(req.apiKeyPresented),
        rpc: req.body && typeof req.body.method === "string" ? req.body.method : undefined,
      });
    });
    next();
  });

  app.get("/health", (req, res) => res.json({ ok: true, service: SERVER_NAME, version: SERVER_VERSION }));

  // Credential extraction/validation runs before rate limiting so the
  // limiter can key on the caller's identity.
  const authenticate = (req, res, next) => {
    const { apiKey, error } = extractApiKey(req);
    if (error) {
      return jsonRpcError(res, 401, -32001, error, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
    }
    if (!apiKey && requireAuth) {
      return jsonRpcError(res, 401, -32001, "Authentication required: send your E3D API key as 'Authorization: Bearer <key>'.", { "WWW-Authenticate": "Bearer" });
    }
    req.apiKey = apiKey;
    req.apiKeyPresented = Boolean(apiKey);
    next();
  };

  const mcpRateLimit = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      req.apiKey
        ? "key:" + createHash("sha256").update(req.apiKey).digest("hex").slice(0, 24)
        : "ip:" + ipKeyGenerator(req.ip),
    handler: (req, res) => {
      log({ level: "warn", event: "rate_limited", reqId: req.reqId, ip: req.ip, authenticated: Boolean(req.apiKey) });
      jsonRpcError(res, 429, -32000, "Rate limit exceeded. Please slow down.");
    },
  });

  app.post("/mcp", authenticate, mcpRateLimit, async (req, res) => {
    const server = buildMcpServer({
      apiKey: req.apiKey, // string | null — never undefined, so E3D_API_KEY is never used
      toolTimeoutMs,
      maxResponseBytes,
      log,
      reqId: req.reqId,
    });
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log({ level: "error", event: "request_failed", reqId: req.reqId, detail: String(err && err.message).slice(0, 200) });
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
    }
  });

  // Stateless: no server push, no session to resume or terminate.
  for (const method of ["get", "delete"]) {
    app[method]("/mcp", (req, res) =>
      jsonRpcError(res, 405, -32000, "Method not allowed. This server is stateless — POST only.", { Allow: "POST" }));
  }

  // Malformed JSON etc. from express.json(): structured, no stack leak.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) log({ level: "error", event: "unhandled", reqId: req.reqId, detail: String(err && err.message).slice(0, 200) });
    jsonRpcError(res, status, status === 500 ? -32603 : -32700, status === 500 ? "Internal server error" : "Invalid request body");
  });

  return app;
}

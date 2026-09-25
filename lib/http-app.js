/**
 * Express app factory for the remote/ChatGPT-facing MCP server
 * (server-http.js). Extracted so it's importable and testable without the
 * side effect of actually binding a port — mirrors why lib/e3d-api.js was
 * pulled out of server.js. server-http.js itself is now just:
 * createApp(options) + app.listen(...).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import rateLimit from "express-rate-limit";
import { apiFetch, okStructured } from "./e3d-api.js";
import {
  shapeMacroSnapshot,
  shapeMacroHistory,
  shapeMacroCausalGraph,
  GET_MACRO_SNAPSHOT_TOOL,
  GET_MACRO_HISTORY_TOOL,
  GET_MACRO_CAUSAL_GRAPH_TOOL,
} from "./financial-stress-monitor.js";

// A fresh McpServer per request (mirrors the SDK's own stateless example) —
// cheap, since these tools carry no per-connection state, and it sidesteps
// any cross-request bleed between concurrent callers. registerTool (not the
// deprecated tool()) so outputSchema is honored — see okStructured() in
// lib/e3d-api.js.
function buildMcpServer() {
  const server = new McpServer({
    name: "e3d-financial-stress-monitor",
    version: "1.0.0",
  });

  server.registerTool(
    GET_MACRO_SNAPSHOT_TOOL.name,
    {
      description: GET_MACRO_SNAPSHOT_TOOL.description,
      inputSchema: GET_MACRO_SNAPSHOT_TOOL.paramsSchema,
      outputSchema: GET_MACRO_SNAPSHOT_TOOL.outputSchema,
      annotations: GET_MACRO_SNAPSHOT_TOOL.annotations,
    },
    async () => {
      const data = await apiFetch("/financial-stress-monitor");
      return okStructured(shapeMacroSnapshot(data && data.event));
    }
  );

  server.registerTool(
    GET_MACRO_HISTORY_TOOL.name,
    {
      description: GET_MACRO_HISTORY_TOOL.description,
      inputSchema: GET_MACRO_HISTORY_TOOL.paramsSchema,
      outputSchema: GET_MACRO_HISTORY_TOOL.outputSchema,
      annotations: GET_MACRO_HISTORY_TOOL.annotations,
    },
    async ({ limit }) => {
      const data = await apiFetch("/financial-stress-monitor/history", { limit });
      return okStructured(shapeMacroHistory(data));
    }
  );

  server.registerTool(
    GET_MACRO_CAUSAL_GRAPH_TOOL.name,
    {
      description: GET_MACRO_CAUSAL_GRAPH_TOOL.description,
      inputSchema: GET_MACRO_CAUSAL_GRAPH_TOOL.paramsSchema,
      outputSchema: GET_MACRO_CAUSAL_GRAPH_TOOL.outputSchema,
      annotations: GET_MACRO_CAUSAL_GRAPH_TOOL.annotations,
    },
    async () => {
      const data = await apiFetch("/financial-stress-monitor");
      return okStructured(shapeMacroCausalGraph(data && data.event));
    }
  );

  return server;
}

/**
 * @param {object} [options]
 * @param {string} [options.host] - passed to createMcpExpressApp for its DNS-rebinding check
 * @param {string[]} [options.allowedHosts] - explicit Host allowlist (production: the proxy's hostname)
 * @param {string} [options.appsChallengeToken] - OpenAI Apps domain-verification token, served
 *   verbatim at /.well-known/openai-apps-challenge. Unset -> 404 (no submission in progress).
 * @param {number} [options.rateLimitWindowMs]
 * @param {number} [options.rateLimitMax] - max POST /mcp requests per IP per window
 * @param {boolean} [options.quiet] - suppress the per-request console log line (tests)
 */
export function createApp({
  host = "127.0.0.1",
  allowedHosts = [],
  appsChallengeToken = "",
  rateLimitWindowMs = 60_000,
  rateLimitMax = 60,
  quiet = false,
} = {}) {
  const app = createMcpExpressApp(allowedHosts.length ? { host, allowedHosts } : { host });

  // Trust exactly one hop (nginx, the only thing in front of this process)
  // so req.ip / X-Forwarded-For resolve to the real client for rate
  // limiting - without this, express-rate-limit would either bucket every
  // client under nginx's own loopback address or (in newer versions) refuse
  // to start rather than silently mis-key on a spoofable header.
  app.set("trust proxy", 1);

  // Minimal structured access log - method/path/status/duration only, never
  // request/response bodies (tool args here are just {} or {limit:N}, but
  // this is the boundary a public plugin's traffic crosses, so keep the
  // habit of not logging payloads regardless of how harmless today's are).
  if (!quiet) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        console.log(`[e3d-mcp-http] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
      });
      next();
    });
  }

  // OpenAI Apps SDK domain-verification challenge (submission requirement -
  // see docs/public-plugin/SUBMISSION.md). Inert (404) until a real token
  // from the OpenAI developer portal is set via OPENAI_APPS_CHALLENGE_TOKEN.
  app.get("/.well-known/openai-apps-challenge", (req, res) => {
    if (!appsChallengeToken) return res.status(404).end();
    res.type("text/plain").send(appsChallengeToken);
  });

  app.get("/health", (req, res) => res.json({ ok: true }));

  // Rate limit only the actual MCP surface, not /health - a health check
  // hitting the limit would make monitoring indistinguishable from an
  // outage. 429 uses the same JSON-RPC error shape as the 405 handlers
  // below, since this is still the /mcp endpoint as far as a client is
  // concerned.
  const mcpRateLimit = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Rate limit exceeded. Please slow down." },
        id: null,
      });
    },
  });

  app.post("/mcp", mcpRateLimit, async (req, res) => {
    const server = buildMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      console.error("[e3d-mcp-http] request failed:", err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Streamable HTTP is POST-only in stateless mode (no server push, no
  // session to resume) — reject GET/DELETE explicitly rather than 404ing,
  // matching the SDK's own reference server.
  for (const method of ["get", "delete"]) {
    app[method]("/mcp", mcpRateLimit, (req, res) => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed. This server is stateless — POST only." },
        id: null,
      });
    });
  }

  return app;
}

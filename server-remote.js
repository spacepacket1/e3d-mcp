#!/usr/bin/env node
/**
 * E3D remote MCP server (Streamable HTTP) — https://mcp.e3d.ai/mcp
 *
 * Public, read-only entry point for ChatGPT and other remote MCP clients.
 * Exposes the read-only tools from lib/read-tools.js; the local stdio server
 * (server.js) and the LiquidityWatch-only app (server-http.js) are separate
 * and unchanged. See lib/remote-app.js for the security model and README.md
 * ("Remote MCP server for ChatGPT") for deployment and connection steps.
 *
 * PM2 app: e3d-mcp-remote (ecosystem.config.cjs), 127.0.0.1:3011, behind
 * nginx for mcp.e3d.ai.
 */

import { createRemoteApp } from "./lib/remote-app.js";

const HOST = process.env.MCP_REMOTE_HOST || "127.0.0.1";
const PORT = Number(process.env.MCP_REMOTE_PORT) || 3011;
const ALLOWED_HOSTS = (process.env.MCP_REMOTE_ALLOWED_HOSTS || "")
  .split(",").map((h) => h.trim()).filter(Boolean);
const REQUIRE_AUTH = /^(1|true|yes|on)$/i.test(process.env.MCP_REMOTE_REQUIRE_AUTH || "");
const RATE_LIMIT_WINDOW_MS = Number(process.env.MCP_REMOTE_RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_LIMIT_MAX = Number(process.env.MCP_REMOTE_RATE_LIMIT_MAX) || 120;
const TOOL_TIMEOUT_MS = Number(process.env.MCP_REMOTE_TOOL_TIMEOUT_MS) || 25_000;

const app = createRemoteApp({
  host: HOST,
  allowedHosts: ALLOWED_HOSTS,
  requireAuth: REQUIRE_AUTH,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMax: RATE_LIMIT_MAX,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
});

const server = app.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(), svc: "e3d-mcp-remote", level: "info", event: "listening",
    host: HOST, port: PORT, requireAuth: REQUIRE_AUTH, allowedHosts: ALLOWED_HOSTS,
    rateLimit: `${RATE_LIMIT_MAX}/${RATE_LIMIT_WINDOW_MS}ms`,
  }));
  if (process.env.E3D_API_KEY) {
    console.warn("[e3d-mcp-remote] E3D_API_KEY is set but is intentionally NOT used by this server; callers' own keys are forwarded instead. Remove it from this process's env.");
  }
  if (!ALLOWED_HOSTS.length && HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.warn("[e3d-mcp-remote] MCP_REMOTE_ALLOWED_HOSTS unset on a non-loopback bind — DNS-rebinding protection inactive.");
  }
});

// Bound slow/idle connections (slowloris) and keep-alive above nginx's.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000;

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

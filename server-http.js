#!/usr/bin/env node
/**
 * E3D Financial Stress Monitor — remote MCP server (Streamable HTTP)
 *
 * server.js (the original e3d-ai server) is stdio-only: a client has to spawn
 * it as a local process, which works for Claude Code/Desktop but not for
 * ChatGPT or any other client that can only reach a public HTTPS endpoint.
 * This is a second, minimal entry point for exactly that case.
 *
 * Deliberately scoped to *only* the three read-only Financial Stress Monitor
 * tools (get_macro_snapshot, get_macro_history, get_macro_causal_graph) —
 * not the full ~30-tool surface server.js exposes, which includes
 * write-capable token-registry tools (claim_token, update_token_claim).
 * Per the integration spec this was built against: "Start with read-only
 * access. Do not expose ... administrative operations." Keeping this a
 * separate, narrower server is what makes that true by construction rather
 * than by convention — a public unauthenticated HTTP endpoint is a bigger
 * blast radius than a locally-spawned stdio process, so it gets a smaller
 * tool surface, not the same one.
 *
 * Stateless (`sessionIdGenerator: undefined`): every tool here is a plain
 * read, so there's no session/resumability state worth paying for.
 *
 * Auth: none. The underlying data (liquiditywatch.e3d.ai's published score)
 * is already public and unauthenticated on the web; this doesn't change
 * that data's sensitivity, just its access method. If a write-capable or
 * account-scoped tool is ever added here, it needs real auth first — do not
 * extend this server's tool set without revisiting that.
 *
 * Actual Express app construction (tools, rate limiting, domain-verification
 * route, request logging) lives in lib/http-app.js so it's importable and
 * testable without binding a real port — this file is just that + listen().
 *
 * Deployment: see README.md's "Remote HTTP server" section. Live in
 * production as PM2 app e3d-mcp-http, bound to 127.0.0.1, reverse-proxied by
 * nginx at https://liquiditywatch.e3d.ai/mcp, with
 * MCP_HTTP_ALLOWED_HOSTS=liquiditywatch.e3d.ai so the SDK's DNS-rebinding
 * check accepts the proxied requests.
 */

import { createApp } from "./lib/http-app.js";

const HOST = process.env.MCP_HTTP_HOST || "127.0.0.1";
const PORT = Number(process.env.MCP_HTTP_PORT) || 3010;
const ALLOWED_HOSTS = (process.env.MCP_HTTP_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const APPS_CHALLENGE_TOKEN = process.env.OPENAI_APPS_CHALLENGE_TOKEN || "";
const RATE_LIMIT_WINDOW_MS = Number(process.env.MCP_HTTP_RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_LIMIT_MAX = Number(process.env.MCP_HTTP_RATE_LIMIT_MAX) || 60;

const app = createApp({
  host: HOST,
  allowedHosts: ALLOWED_HOSTS,
  appsChallengeToken: APPS_CHALLENGE_TOKEN,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMax: RATE_LIMIT_MAX,
});

app.listen(PORT, HOST, () => {
  console.log(`e3d-financial-stress-monitor MCP HTTP server listening on ${HOST}:${PORT} (POST /mcp)`);
  console.log(`[e3d-mcp-http] rate limit: ${RATE_LIMIT_MAX} req / ${RATE_LIMIT_WINDOW_MS}ms per IP on /mcp`);
  if (!APPS_CHALLENGE_TOKEN) {
    console.log("[e3d-mcp-http] OPENAI_APPS_CHALLENGE_TOKEN unset — /.well-known/openai-apps-challenge returns 404");
  }
  if (!ALLOWED_HOSTS.length && HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.warn(
      "[e3d-mcp-http] MCP_HTTP_ALLOWED_HOSTS is unset while bound to a " +
      "non-loopback host — DNS-rebinding protection is not active. Set it before exposing " +
      "this publicly (see README.md)."
    );
  }
});

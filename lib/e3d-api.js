/**
 * Thin fetch/wrap helpers for calling https://e3d.ai/api. Extracted from
 * server.js (unchanged behavior) so it can be imported without triggering
 * server.js's top-level `await server.connect(transport)` stdio startup —
 * that side effect makes server.js itself unsafe to `import` from tests.
 *
 * Two additions on top of the original extraction, both scoped to apiFetch
 * (GET-only) and never applied to apiRequest's write path:
 *  - a request timeout (AbortController), so a hung upstream can't hang a
 *    tool call forever under public traffic
 *  - a short in-memory TTL cache, since the underlying financial-stress-
 *    monitor evaluation only changes ~once/cycle (daily) - repeated
 *    get_macro_snapshot calls within the TTL are served from memory instead
 *    of hitting e3d.ai again. Plain Map, not a new service - cleared on
 *    process restart, never shared across processes.
 */

import { createHash } from "node:crypto";

export const BASE_URL = (process.env.E3D_API_BASE_URL || "https://e3d.ai/api").replace(/\/$/, "");
export const API_KEY = process.env.E3D_API_KEY || "";
export const REQUEST_TIMEOUT_MS = Number(process.env.E3D_API_TIMEOUT_MS) || 10_000;
export const CACHE_TTL_MS = Number(process.env.E3D_API_CACHE_TTL_MS) || 30_000;

// `apiKey` selects the x-api-key credential for this one call:
//   undefined -> the process-wide E3D_API_KEY (stdio server; original behavior)
//   null / "" -> no key (anonymous tier)
//   string    -> that key (remote server forwarding the *caller's* own key)
// The remote transport always passes null or the caller's key, never
// undefined, so a privileged E3D_API_KEY in its environment can't leak into
// public requests.
export async function apiRequest(method, pathname, { query = {}, body, bearerToken, apiKey, baseUrl = BASE_URL, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = new URL(baseUrl + pathname);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  const headers = { "Accept": "application/json" };
  const key = apiKey === undefined ? API_KEY : apiKey;
  if (key) headers["x-api-key"] = key;
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url.toString(), { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`E3D API request timed out after ${timeoutMs}ms: ${method} ${pathname}`);
      timeoutErr.code = "UPSTREAM_TIMEOUT";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    const httpErr = new Error(`E3D API ${res.status}: ${JSON.stringify(json)}`);
    httpErr.status = res.status;
    httpErr.upstreamBody = json;
    throw httpErr;
  }
  return json;
}

// url -> { expiresAt, value }. Module-level, so it's per-process (each PM2
// instance/each test run gets its own) and reset by any restart.
const getCache = new Map();

export function clearApiCache() {
  getCache.clear();
}

// Responses can differ per credential (tier/entitlements), so the cache is
// partitioned by caller identity: a keyed caller's cached response is never
// served to another key or to anonymous callers.
function credentialScope(apiKey) {
  if (apiKey === undefined) return "env";
  if (!apiKey) return "anon";
  return "k:" + createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export async function apiFetch(pathname, query = {}, { baseUrl, timeoutMs, cacheTtlMs = CACHE_TTL_MS, apiKey } = {}) {
  const cacheKey = `${credentialScope(apiKey)}|${baseUrl ?? BASE_URL}${pathname}?${new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString()}`;

  const cached = getCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await apiRequest("GET", pathname, { query, baseUrl, timeoutMs, apiKey });
  if (cacheTtlMs > 0) {
    getCache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
  }
  return value;
}

export function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// For tools that declare an outputSchema (see lib/tool-output-schemas.js):
// the SDK validates structuredContent against it, so every registered field
// of `data` needs to satisfy that schema. `content` is kept identical to
// ok()'s plain-text form for backward compatibility with any client that
// only reads content.
export function okStructured(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

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

export const BASE_URL = (process.env.E3D_API_BASE_URL || "https://e3d.ai/api").replace(/\/$/, "");
export const API_KEY = process.env.E3D_API_KEY || "";
export const REQUEST_TIMEOUT_MS = Number(process.env.E3D_API_TIMEOUT_MS) || 10_000;
export const CACHE_TTL_MS = Number(process.env.E3D_API_CACHE_TTL_MS) || 30_000;

export async function apiRequest(method, pathname, { query = {}, body, bearerToken, baseUrl = BASE_URL, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = new URL(baseUrl + pathname);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  const headers = { "Accept": "application/json" };
  if (API_KEY) headers["x-api-key"] = API_KEY;
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
      throw new Error(`E3D API request timed out after ${timeoutMs}ms: ${method} ${pathname}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    throw new Error(`E3D API ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// url -> { expiresAt, value }. Module-level, so it's per-process (each PM2
// instance/each test run gets its own) and reset by any restart.
const getCache = new Map();

export function clearApiCache() {
  getCache.clear();
}

export async function apiFetch(pathname, query = {}, { baseUrl, timeoutMs, cacheTtlMs = CACHE_TTL_MS } = {}) {
  const cacheKey = `${baseUrl ?? BASE_URL}${pathname}?${new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString()}`;

  const cached = getCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await apiRequest("GET", pathname, { query, baseUrl, timeoutMs });
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

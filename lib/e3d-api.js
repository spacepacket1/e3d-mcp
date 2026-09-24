/**
 * Thin fetch/wrap helpers for calling https://e3d.ai/api. Extracted from
 * server.js (unchanged behavior) so it can be imported without triggering
 * server.js's top-level `await server.connect(transport)` stdio startup —
 * that side effect makes server.js itself unsafe to `import` from tests.
 */

export const BASE_URL = (process.env.E3D_API_BASE_URL || "https://e3d.ai/api").replace(/\/$/, "");
export const API_KEY = process.env.E3D_API_KEY || "";

export async function apiRequest(method, pathname, { query = {}, body, bearerToken, baseUrl = BASE_URL } = {}) {
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

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    throw new Error(`E3D API ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function apiFetch(pathname, query = {}, { baseUrl } = {}) {
  return apiRequest("GET", pathname, { query, baseUrl });
}

export function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Integration tests for lib/http-app.js (the Express app server-http.js
// serves) - a real HTTP server on an ephemeral port, exercised with the
// actual MCP SDK client over Streamable HTTP, plus raw fetch for the
// non-MCP routes (health, challenge, 405s, rate limiting, host validation).
// Covers the audit list from the public-plugin-readiness mission: tool
// discovery/execution, HTTP error handling, DNS-rebinding protection,
// request validation, rate limiting, and read-only-ness.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../lib/http-app.js';
import { clearApiCache } from '../lib/e3d-api.js';

// A minimal upstream stand-in for https://e3d.ai/api - the app under test
// doesn't take a baseUrl override (server-http.js reads E3D_API_BASE_URL at
// module load, same as lib/e3d-api.js), so these tests point the whole
// process at a local mock via the env var, set before any import that
// touches lib/e3d-api.js's module-level BASE_URL constant.
async function startMockUpstream() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/financial-stress-monitor/history')) {
      res.end(JSON.stringify([{ created_at: 't', final_score: 50, schema_version: '1.0' }]));
    } else {
      res.end(JSON.stringify({ event: { final_score: 74, schema_version: '1.0', timestamp: 't' } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function startApp(appOptions = {}) {
  const app = createApp({ quiet: true, ...appOptions });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

// process.env.E3D_API_BASE_URL must be set BEFORE lib/e3d-api.js is first
// imported anywhere in the process, since it reads it once at module load.
// test/e3d-api.test.js and test/financial-stress-monitor.test.js don't rely
// on it (they pass baseUrl per-call), so setting it here process-wide before
// this file's own imports run is safe as long as this file is executed as
// its own `node --test` invocation alongside the others - which the node
// test runner does (each file is a separate worker/process).
let mockUpstream;
test.before(async () => {
  mockUpstream = await startMockUpstream();
  process.env.E3D_API_BASE_URL = mockUpstream.baseUrl;
});
test.after(() => mockUpstream.server.close());

// Node's `fetch` silently ignores an attempt to override the `Host` header
// (it's a forbidden header per the Fetch spec, and undici drops it rather
// than erroring) - confirmed directly: a fetch() with headers:{Host:'x'}
// against a plain http server still shows the server its own
// 127.0.0.1:port as the Host it received. DNS-rebinding tests need to
// actually control what Host the server sees, so those use raw
// http.request instead of fetch.
function rawRequest(targetUrl, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function mcpClientFor(url) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

test('lists exactly the 3 read-only financial-stress-monitor tools, none from the stdio server', async () => {
  clearApiCache();
  const { server, url } = await startApp();
  try {
    const client = await mcpClientFor(url);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((t) => t.name).sort(),
      ['get_macro_causal_graph', 'get_macro_history', 'get_macro_snapshot'],
    );
    await client.close();
  } finally {
    server.close();
  }
});

test('every tool carries readOnlyHint/destructiveHint/openWorldHint annotations', async () => {
  clearApiCache();
  const { server, url } = await startApp();
  try {
    const client = await mcpClientFor(url);
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} missing readOnlyHint`);
      assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} missing destructiveHint`);
      assert.equal(tool.annotations?.openWorldHint, true, `${tool.name} missing openWorldHint`);
    }
    await client.close();
  } finally {
    server.close();
  }
});

test('get_macro_snapshot executes end to end through the real Streamable HTTP transport', async () => {
  clearApiCache();
  const { server, url } = await startApp();
  try {
    const client = await mcpClientFor(url);
    const res = await client.callTool({ name: 'get_macro_snapshot', arguments: {} });
    assert.equal(!!res.isError, false);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.available, true);
    assert.equal(parsed.headline_score.value, 74);
    await client.close();
  } finally {
    server.close();
  }
});

test('every tool call returns structuredContent that validates against its declared outputSchema', async () => {
  clearApiCache();
  const { server, url } = await startApp();
  try {
    const client = await mcpClientFor(url);

    const snapshot = await client.callTool({ name: 'get_macro_snapshot', arguments: {} });
    assert.equal(snapshot.isError, undefined);
    assert.ok(snapshot.structuredContent, 'get_macro_snapshot missing structuredContent');
    assert.equal(snapshot.structuredContent.available, true);
    assert.equal(snapshot.structuredContent.headline_score.value, 74);
    // structuredContent must match content's text exactly - two representations of the same data
    assert.deepEqual(snapshot.structuredContent, JSON.parse(snapshot.content[0].text));

    const history = await client.callTool({ name: 'get_macro_history', arguments: { limit: 1 } });
    assert.ok(history.structuredContent, 'get_macro_history missing structuredContent');
    assert.equal(history.structuredContent.order, 'newest_first');
    assert.equal(history.structuredContent.evaluations.length, 1);

    const causal = await client.callTool({ name: 'get_macro_causal_graph', arguments: {} });
    assert.ok(causal.structuredContent, 'get_macro_causal_graph missing structuredContent');
    assert.equal(typeof causal.structuredContent.available, 'boolean');

    await client.close();
  } finally {
    server.close();
  }
});

test('get_macro_history rejects an out-of-range limit as an invalid tool argument', async () => {
  clearApiCache();
  const { server, url } = await startApp();
  try {
    const client = await mcpClientFor(url);
    // Zod's schema validation failure surfaces as an MCP tool error result
    // (isError:true), not a transport-level rejection - the call itself
    // still resolves.
    const res = await client.callTool({ name: 'get_macro_history', arguments: { limit: 10_000 } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Invalid arguments|too_big/);
    await client.close();
  } finally {
    server.close();
  }
});

test('GET and DELETE /mcp are rejected with 405 (stateless, POST-only)', async () => {
  const { server, url } = await startApp();
  try {
    const getRes = await fetch(`${url}/mcp`);
    assert.equal(getRes.status, 405);
    const delRes = await fetch(`${url}/mcp`, { method: 'DELETE' });
    assert.equal(delRes.status, 405);
  } finally {
    server.close();
  }
});

test('GET /health returns ok when called on loopback with no allowedHosts configured', async () => {
  const { server, url } = await startApp(); // no allowedHosts - default loopback-only check
  try {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.close();
  }
});

test('DNS-rebinding protection: /health also enforces the Host allowlist once one is configured - a proxied hostname is required everywhere, not just /mcp', async () => {
  const { server, url } = await startApp({ allowedHosts: ['liquiditywatch.e3d.ai'] });
  try {
    const viaLoopback = await fetch(`${url}/health`); // Host: 127.0.0.1:port, not in the allowlist
    assert.equal(viaLoopback.status, 403);

    const viaAllowedHost = await rawRequest(`${url}/health`, { headers: { Host: 'liquiditywatch.e3d.ai' } });
    assert.equal(viaAllowedHost.status, 200);
  } finally {
    server.close();
  }
});

test('DNS-rebinding protection: a request with an unrecognized Host header is rejected', async () => {
  const { server, url } = await startApp({ allowedHosts: ['liquiditywatch.e3d.ai'] });
  try {
    const res = await rawRequest(`${url}/mcp`, {
      method: 'POST',
      headers: { Host: 'evil.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('DNS-rebinding protection: the allowed Host header (what nginx actually forwards in production) is accepted', async () => {
  clearApiCache();
  const { server, url } = await startApp({ allowedHosts: ['liquiditywatch.e3d.ai'] });
  try {
    const res = await rawRequest(`${url}/mcp`, {
      method: 'POST',
      headers: {
        Host: 'liquiditywatch.e3d.ai',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1, params: {} }),
    });
    assert.notEqual(res.status, 403);
  } finally {
    server.close();
  }
});

test('the OpenAI Apps domain-verification challenge is inert (404) with no token configured', async () => {
  const { server, url } = await startApp();
  try {
    const res = await fetch(`${url}/.well-known/openai-apps-challenge`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('the OpenAI Apps domain-verification challenge returns only the configured token', async () => {
  const { server, url } = await startApp({ appsChallengeToken: 'abc123token' });
  try {
    const res = await fetch(`${url}/.well-known/openai-apps-challenge`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'abc123token');
  } finally {
    server.close();
  }
});

test('rate limiting: exceeding the configured max on /mcp returns 429, /health is unaffected', async () => {
  clearApiCache();
  const { server, url } = await startApp({ rateLimitMax: 3, rateLimitWindowMs: 60_000 });
  try {
    const call = () => fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1, params: {} }),
    });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await call()).status);
    }
    assert.ok(statuses.slice(0, 3).every((s) => s !== 429), `first 3 should not be rate-limited: ${statuses}`);
    assert.ok(statuses.slice(3).some((s) => s === 429), `later requests should hit the limit: ${statuses}`);

    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200); // /health is not behind the /mcp rate limiter
  } finally {
    server.close();
  }
});

test('no write-capable route exists on this server (read-only by construction)', async () => {
  const { server, url } = await startApp();
  try {
    for (const path of ['/claim', '/registry/tokens/0xabc/claim', '/mailing-list/signup']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${url}${path}`, { method: 'POST' });
      assert.equal(res.status, 404, `${path} should not exist on the HTTP MCP server`);
    }
  } finally {
    server.close();
  }
});

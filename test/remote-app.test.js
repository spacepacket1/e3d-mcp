// Integration tests for lib/remote-app.js (the public mcp.e3d.ai server):
// real HTTP server on an ephemeral port, real MCP SDK client over Streamable
// HTTP, and a local stand-in for https://e3d.ai/api that records what the
// server sends upstream. Covers tool discovery, execution (incl. QNT),
// read-only surface, credential forwarding/isolation, structured errors,
// timeouts, validation, rate limiting, host protection and log hygiene.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Must be set before lib/e3d-api.js loads (it reads these once) - hence the
// dynamic imports below. A privileged env key is set on purpose: the remote
// server must never forward it.
const PRIVILEGED_ENV_KEY = 'e3d_privileged_server_key_do_not_leak';
process.env.E3D_API_KEY = PRIVILEGED_ENV_KEY;
process.env.E3D_API_TIMEOUT_MS = '400';

const QNT_ADDRESS = '0x4a220e6096b25eadb88358cb44068a3248254675';
const QNT_TOKEN = { address: QNT_ADDRESS, name: 'Quant', symbol: 'QNT', chain: 'ETH', priceUSD: 100.5 };

const upstreamCalls = []; // { path, query, apiKey }
let upstreamMode = 'ok'; // ok | hang | 500 | 401 | 429

const upstream = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  upstreamCalls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), apiKey: req.headers['x-api-key'] });
  if (upstreamMode === 'hang') return; // never respond -> upstream timeout
  if (upstreamMode !== 'ok') {
    const status = Number(upstreamMode);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'SECRET-UPSTREAM-DETAIL', retry_after_ms: 1500 }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u.pathname === '/fetchTokensDB') {
    const s = (u.searchParams.get('search') || '').toLowerCase();
    return res.end(JSON.stringify(s === 'qnt' || s === QNT_ADDRESS ? [QNT_TOKEN] : []));
  }
  if (u.pathname === '/fetchTransactionsDB') return res.end(JSON.stringify([{ hash: '0xabc', token: QNT_ADDRESS }]));
  if (u.pathname === `/token-info/${QNT_ADDRESS}`) return res.end(JSON.stringify({ ...QNT_TOKEN, holders: 123 }));
  if (u.pathname === '/tokenCounterparties') return res.end(JSON.stringify([{ address: '0xdef', count: 3 }]));
  if (u.pathname === '/stories') return res.end(JSON.stringify({ stories: [{ id: 1, title: 'QNT accumulation' }] }));
  if (u.pathname.startsWith('/financial-stress-monitor/history')) {
    return res.end(JSON.stringify([{ created_at: 't', final_score: 50, schema_version: '1.0' }]));
  }
  if (u.pathname === '/financial-stress-monitor') {
    return res.end(JSON.stringify({ event: { final_score: 74, schema_version: '1.0', timestamp: 't' } }));
  }
  if (u.pathname === '/bigthing') return res.end('{}');
  res.end(JSON.stringify({ path: u.pathname }));
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
process.env.E3D_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
test.after(() => upstream.close());

const { createRemoteApp } = await import('../lib/remote-app.js');
const { READ_ONLY_TOOLS } = await import('../lib/read-tools.js');
const { clearApiCache } = await import('../lib/e3d-api.js');

async function startApp(opts = {}) {
  const logs = [];
  const app = createRemoteApp({ logSink: (l) => logs.push(JSON.parse(l)), ...opts });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, logs, url: `http://127.0.0.1:${server.address().port}` };
}

async function withApp(opts, fn) {
  clearApiCache();
  upstreamCalls.length = 0;
  upstreamMode = 'ok';
  const ctx = await startApp(opts);
  try { await fn(ctx); } finally { ctx.server.close(); }
}

async function clientFor(url, headers) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), headers ? { requestInit: { headers } } : undefined);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

function post(url, { headers = {}, body } = {}) {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ── Discovery ───────────────────────────────────────────────────────────────

test('tool discovery lists exactly the read-only tool set, none write-capable or agent-operational', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, READ_ONLY_TOOLS.map((t) => t.name).sort());
    for (const required of ['get_tokens', 'get_token_info', 'get_transactions', 'get_address_meta',
      'get_token_counterparties', 'get_address_counterparties', 'search_stories', 'get_token_prices',
      'get_theses', 'get_macro_snapshot']) {
      assert.ok(names.includes(required), `missing ${required}`);
    }
    for (const forbidden of ['claim_token', 'update_token_claim', 'get_wallet_claims', 'get_agent_funding',
      'get_agent_burns', 'get_agent_strategies', 'get_agent_budget_policy', 'get_agent_executions']) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not be exposed remotely`);
    }
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} readOnlyHint`);
      assert.equal(t.annotations?.destructiveHint, false, `${t.name} destructiveHint`);
      assert.ok(t.description && t.inputSchema, `${t.name} description/schema`);
    }
    // no tool accepts a credential as an argument
    for (const t of tools) {
      for (const k of Object.keys(t.inputSchema.properties || {})) {
        assert.ok(!['apiKey', 'sessionToken', 'bearerToken', 'secret'].includes(k), `${t.name} takes credential arg ${k}`);
      }
    }
    await client.close();
  });
});

test('calling an unregistered (write) tool is rejected', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);
    const r = await client.callTool({ name: 'claim_token', arguments: { address: '0x1' } }).catch((e) => ({ thrown: e }));
    assert.ok(r.thrown || r.isError, 'claim_token must not be callable');
    assert.equal(upstreamCalls.length, 0, 'no upstream call should be made');
    await client.close();
  });
});

// ── Execution, incl. QNT ────────────────────────────────────────────────────

test('QNT can be queried through the remote MCP interface (symbol and address)', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);

    const bySymbol = await client.callTool({ name: 'get_tokens', arguments: { search: 'QNT', limit: 5 } });
    assert.ok(!bySymbol.isError);
    const tokens = JSON.parse(bySymbol.content[0].text);
    assert.equal(tokens[0].symbol, 'QNT');
    assert.equal(tokens[0].address, QNT_ADDRESS);
    assert.deepEqual(upstreamCalls[0].query, { search: 'QNT', limit: '5', offset: '0', dataSource: '1' });

    const info = await client.callTool({ name: 'get_token_info', arguments: { address: QNT_ADDRESS } });
    assert.equal(JSON.parse(info.content[0].text).symbol, 'QNT');

    const cp = await client.callTool({ name: 'get_token_counterparties', arguments: { token: QNT_ADDRESS } });
    assert.ok(!cp.isError);
    const tx = await client.callTool({ name: 'get_transactions', arguments: { search: QNT_ADDRESS } });
    assert.ok(!tx.isError);
    const st = await client.callTool({ name: 'search_stories', arguments: { q: 'QNT' } });
    assert.match(st.content[0].text, /QNT accumulation/);
    await client.close();
  });
});

test('macro tools return structuredContent matching content (outputSchema-validated)', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);
    const snap = await client.callTool({ name: 'get_macro_snapshot', arguments: {} });
    assert.ok(!snap.isError);
    assert.equal(snap.structuredContent.headline_score.value, 74);
    assert.deepEqual(snap.structuredContent, JSON.parse(snap.content[0].text));
    const hist = await client.callTool({ name: 'get_macro_history', arguments: { limit: 1 } });
    assert.ok(!hist.isError);
    await client.close();
  });
});

// ── Credentials ─────────────────────────────────────────────────────────────

test('anonymous calls reach upstream with NO api key - the server env key is never forwarded', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);
    await client.callTool({ name: 'get_tokens', arguments: { search: 'QNT' } });
    assert.equal(upstreamCalls.at(-1).apiKey, undefined);
    await client.close();
  });
});

test('a caller-supplied key (Bearer or x-api-key) is forwarded upstream as that caller\'s x-api-key', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const a = await clientFor(url, { Authorization: 'Bearer caller_key_AAAAAAAA' });
    await a.callTool({ name: 'get_tokens', arguments: { search: 'QNT' } });
    assert.equal(upstreamCalls.at(-1).apiKey, 'caller_key_AAAAAAAA');
    await a.close();

    const b = await clientFor(url, { 'x-api-key': 'caller_key_BBBBBBBB' });
    await b.callTool({ name: 'get_tokens', arguments: { search: 'QNT' } });
    assert.equal(upstreamCalls.at(-1).apiKey, 'caller_key_BBBBBBBB');
    await b.close();
  });
});

test('response cache is partitioned by caller: one key\'s cached data is never served to another caller', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const args = { name: 'get_tokens', arguments: { search: 'QNT' } };
    const a = await clientFor(url, { Authorization: 'Bearer caller_key_AAAAAAAA' });
    await a.callTool(args);
    await a.callTool(args); // cached for A
    assert.equal(upstreamCalls.length, 1);
    const anon = await clientFor(url);
    await anon.callTool(args);
    assert.equal(upstreamCalls.length, 2, 'anonymous must not hit A\'s cache entry');
    assert.equal(upstreamCalls.at(-1).apiKey, undefined);
    const b = await clientFor(url, { Authorization: 'Bearer caller_key_BBBBBBBB' });
    await b.callTool(args);
    assert.equal(upstreamCalls.length, 3);
    await Promise.all([a.close(), anon.close(), b.close()]);
  });
});

test('requireAuth: keyless requests get 401 + WWW-Authenticate; keyed requests work', async () => {
  await withApp({ quiet: true, requireAuth: true }, async ({ url }) => {
    const res = await post(url, { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /Bearer/);
    assert.equal((await res.json()).error.code, -32001);
    const client = await clientFor(url, { Authorization: 'Bearer caller_key_AAAAAAAA' });
    assert.ok((await client.listTools()).tools.length > 0);
    await client.close();
  });
});

test('malformed credentials are rejected before any upstream call', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    for (const headers of [
      { Authorization: 'Basic abc123456789' },
      { Authorization: 'Bearer short' },
      { Authorization: 'Bearer bad key with spaces' },
      { 'x-api-key': 'x'.repeat(300) },
    ]) {
      const res = await post(url, { headers, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
      assert.equal(res.status, 401, JSON.stringify(headers).slice(0, 40));
    }
    assert.equal(upstreamCalls.length, 0);
  });
});

// ── Structured errors, timeouts ─────────────────────────────────────────────

test('upstream failures become structured in-band errors without leaking upstream bodies', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);
    const expectations = [
      ['401', 'unauthorized', false], ['429', 'rate_limited', true], ['500', 'upstream_error', true],
    ];
    for (const [mode, code, retryable] of expectations) {
      upstreamMode = mode;
      clearApiCache();
      const r = await client.callTool({ name: 'get_tokens', arguments: { search: 'QNT' } });
      assert.equal(r.isError, true, mode);
      assert.equal(r.structuredContent.error.code, code);
      assert.equal(r.structuredContent.error.retryable, retryable);
      assert.ok(!r.content[0].text.includes('SECRET-UPSTREAM-DETAIL'), 'upstream body leaked');
    }
    upstreamMode = '429';
    clearApiCache();
    const r = await client.callTool({ name: 'get_tokens', arguments: { search: 'QNT' } });
    assert.equal(r.structuredContent.error.retry_after_ms, 1500);
    await client.close();
  });
});

test('a hung upstream times out with a structured retryable error (macro tool with outputSchema too)', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);
    upstreamMode = 'hang';
    for (const name of ['get_tokens', 'get_macro_snapshot']) {
      const t0 = Date.now();
      const r = await client.callTool({ name, arguments: name === 'get_tokens' ? { search: 'QNT' } : {} });
      assert.equal(r.isError, true, name);
      assert.equal(r.structuredContent.error.code, 'upstream_timeout');
      assert.equal(r.structuredContent.error.retryable, true);
      assert.ok(Date.now() - t0 < 3000);
    }
    await client.close();
  });
});

test('overall tool timeout caps a call even if upstream is slower than the tool budget', async () => {
  await withApp({ quiet: true, toolTimeoutMs: 50 }, async ({ url }) => {
    const client = await clientFor(url);
    upstreamMode = 'hang';
    const r = await client.callTool({ name: 'get_tokens', arguments: { search: 'QNT' } });
    assert.equal(r.structuredContent.error.code, 'upstream_timeout');
    await client.close();
  });
});

test('oversized responses are refused with a structured error', async () => {
  await withApp({ quiet: true, maxResponseBytes: 10 }, async ({ url }) => {
    const client = await clientFor(url);
    const r = await client.callTool({ name: 'get_tokens', arguments: { search: 'QNT' } });
    assert.equal(r.structuredContent.error.code, 'response_too_large');
    await client.close();
  });
});

// ── Request validation ──────────────────────────────────────────────────────

test('invalid tool arguments are rejected without an upstream call', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const client = await clientFor(url);
    const cases = [
      ['get_tokens', { limit: 10_000 }],
      ['get_tokens', { search: 'x'.repeat(500) }],
      ['get_token_info', {}],
      ['get_token_counterparties', { token: '0x1', limit: 0 }],
      ['search_stories', { q: 'a', scope: 'write' }],
    ];
    for (const [name, args] of cases) {
      const r = await client.callTool({ name, arguments: args }).catch((e) => ({ thrown: e }));
      assert.ok(r.thrown || r.isError, `${name} ${JSON.stringify(args).slice(0, 40)} should be rejected`);
    }
    assert.equal(upstreamCalls.length, 0);
    await client.close();
  });
});

test('malformed JSON body -> structured 400, no stack trace', async () => {
  await withApp({ quiet: true }, async ({ url }) => {
    const res = await post(url, { body: '{not json' });
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.equal(JSON.parse(text).error.message, 'Invalid request body');
    assert.ok(!/at .*\.js/.test(text));
  });
});

test('GET/DELETE /mcp -> 405 with Allow: POST; /health works and is unauthenticated', async () => {
  await withApp({ quiet: true, requireAuth: true }, async ({ url }) => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${url}/mcp`, { method });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('allow'), 'POST');
    }
    const h = await fetch(`${url}/health`);
    assert.equal(h.status, 200);
    assert.equal((await h.json()).ok, true);
    assert.equal(h.headers.get('x-powered-by'), null);
  });
});

// ── Host protection, rate limiting, logging ─────────────────────────────────

function rawPost(targetUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.request({ hostname: u.hostname, port: u.port, path: '/mcp', method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('DNS-rebinding protection: only the allowed Host is accepted', async () => {
  await withApp({ quiet: true, allowedHosts: ['mcp.e3d.ai'] }, async ({ url }) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const bad = await rawPost(url, { ...base, Host: 'evil.example.com' }, body);
    assert.equal(bad.status, 403);
    const good = await rawPost(url, { ...base, Host: 'mcp.e3d.ai' }, body);
    assert.equal(good.status, 200);
  });
});

test('rate limit: per API key when keyed (independent of IP), per IP when anonymous', async () => {
  await withApp({ quiet: true, rateLimitMax: 3, rateLimitWindowMs: 60_000 }, async ({ url }) => {
    const ping = (headers) => post(url, { headers, body: { jsonrpc: '2.0', id: 1, method: 'ping' } }).then((r) => r.status);
    const keyA = { Authorization: 'Bearer caller_key_AAAAAAAA' };
    const keyB = { Authorization: 'Bearer caller_key_BBBBBBBB' };
    for (let i = 0; i < 3; i++) assert.equal(await ping(keyA), 200);
    assert.equal(await ping(keyA), 429);
    assert.equal(await ping(keyB), 200, 'a different key has its own bucket even from the same IP');
    for (let i = 0; i < 2; i++) assert.equal(await ping({}), 200);
    assert.equal(await ping({}), 200);
    const limited = await post(url, { body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, -32000);
  });
});

test('logs are structured JSON and never contain credentials, tool arguments, or upstream bodies', async () => {
  await withApp({ rateLimitMax: 1000 }, async ({ url, logs }) => {
    const client = await clientFor(url, { Authorization: 'Bearer caller_key_SECRETSECRET' });
    await client.callTool({ name: 'get_tokens', arguments: { search: 'PRIVATE-SEARCH-TERM' } });
    upstreamMode = '500';
    clearApiCache();
    await client.callTool({ name: 'get_tokens', arguments: { search: 'PRIVATE-SEARCH-TERM-2' } });
    await client.close();

    const all = JSON.stringify(logs);
    assert.ok(!all.includes('SECRETSECRET'), 'credential in logs');
    assert.ok(!all.includes(PRIVILEGED_ENV_KEY));
    assert.ok(!all.includes('PRIVATE-SEARCH-TERM'), 'tool arguments in logs');
    assert.ok(!all.includes('SECRET-UPSTREAM-DETAIL'), 'upstream body in logs');

    const http = logs.filter((l) => l.event === 'http_request');
    assert.ok(http.length > 0 && http.every((l) => l.reqId && l.status && typeof l.ms === 'number' && l.path));
    assert.ok(http.some((l) => l.authenticated === true));
    const tools = logs.filter((l) => l.event === 'tool_call');
    assert.ok(tools.some((l) => l.ok === true && l.tool === 'get_tokens'));
    assert.ok(tools.some((l) => l.ok === false && l.code === 'upstream_error'));
  });
});

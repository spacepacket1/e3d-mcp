// Transport-layer tests for lib/e3d-api.js against a real local HTTP server
// (not a fetch mock) - covers non-2xx responses, malformed/non-JSON bodies,
// and unreachable hosts, per the integration spec's verification list
// ("API unavailability", "malformed responses").

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { apiRequest, apiFetch } from '../lib/e3d-api.js';

async function startMockServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test('apiFetch: parses a normal 200 JSON response', async () => {
  const { server, baseUrl } = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ event: { final_score: 74 } }));
  });
  try {
    const data = await apiFetch('/financial-stress-monitor', {}, { baseUrl });
    assert.equal(data.event.final_score, 74);
  } finally {
    server.close();
  }
});

test('apiFetch: query params are appended to the URL', async () => {
  let seenUrl;
  const { server, baseUrl } = await startMockServer((req, res) => {
    seenUrl = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
  try {
    await apiFetch('/financial-stress-monitor/history', { limit: 30 }, { baseUrl });
    assert.equal(seenUrl, '/financial-stress-monitor/history?limit=30');
  } finally {
    server.close();
  }
});

test('apiFetch: a non-2xx status throws with the status code and body in the message', async () => {
  const { server, baseUrl } = await startMockServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unavailable' }));
  });
  try {
    await assert.rejects(
      () => apiFetch('/financial-stress-monitor', {}, { baseUrl }),
      /E3D API 503.*upstream unavailable/s,
    );
  } finally {
    server.close();
  }
});

test('apiFetch: a malformed (non-JSON) 200 body does not throw - falls back to {raw: text}', async () => {
  const { server, baseUrl } = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('<html>not json</html>');
  });
  try {
    const data = await apiFetch('/financial-stress-monitor', {}, { baseUrl });
    assert.equal(data.raw, '<html>not json</html>');
  } finally {
    server.close();
  }
});

test('apiFetch: a malformed non-JSON body on a non-2xx status still throws', async () => {
  const { server, baseUrl } = await startMockServer((req, res) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('bad gateway');
  });
  try {
    await assert.rejects(() => apiFetch('/financial-stress-monitor', {}, { baseUrl }), /E3D API 502/);
  } finally {
    server.close();
  }
});

test('apiFetch: an unreachable host rejects rather than hanging', async () => {
  // Port 1 is a reserved/typically-closed port - connection refused, fast.
  await assert.rejects(() => apiFetch('/financial-stress-monitor', {}, { baseUrl: 'http://127.0.0.1:1' }));
});

test('apiRequest: bearer token and JSON body are sent for a write-shaped call', async () => {
  let seenAuth, seenBody;
  const { server, baseUrl } = await startMockServer((req, res) => {
    seenAuth = req.headers.authorization;
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seenBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    await apiRequest('POST', '/registry/tokens/0xabc/claim', {
      baseUrl, bearerToken: 'session-123', body: { wallet: '0xabc' },
    });
    assert.equal(seenAuth, 'Bearer session-123');
    assert.deepEqual(seenBody, { wallet: '0xabc' });
  } finally {
    server.close();
  }
});

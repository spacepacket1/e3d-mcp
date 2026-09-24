// Opt-in integration test against the REAL https://e3d.ai/api - per the
// integration spec's "test against the actual E3D API responses"
// requirement. Skipped by default (no network calls in a normal `npm test`
// run); set E3D_MCP_LIVE_TESTS=1 to run it deliberately, e.g. after a
// change to the upstream contract assumptions in lib/financial-stress-monitor.js.
//
//   E3D_MCP_LIVE_TESTS=1 node --test test/live-financial-stress-monitor.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch } from '../lib/e3d-api.js';
import { shapeMacroSnapshot, shapeMacroHistory, shapeMacroCausalGraph } from '../lib/financial-stress-monitor.js';

const LIVE = process.env.E3D_MCP_LIVE_TESTS === '1';

test('live: get_macro_snapshot shape against the real API', { skip: !LIVE }, async () => {
  const data = await apiFetch('/financial-stress-monitor');
  const snap = shapeMacroSnapshot(data && data.event);
  assert.equal(snap.available, true);
  assert.equal(typeof snap.headline_score.value, 'number');
  assert.ok(snap.headline_score.value >= 0 && snap.headline_score.value <= 100);
  assert.equal('newsletter_body_html' in snap, false);
});

test('live: get_macro_history shape against the real API', { skip: !LIVE }, async () => {
  const data = await apiFetch('/financial-stress-monitor/history', { limit: 5 });
  const shaped = shapeMacroHistory(data);
  assert.equal(shaped.order, 'newest_first');
  assert.ok(shaped.count <= 5);
  for (const entry of shaped.evaluations) {
    assert.equal(typeof entry.created_at === 'string' || entry.created_at === null, true);
  }
});

test('live: get_macro_causal_graph handles the current null-or-present state', { skip: !LIVE }, async () => {
  const data = await apiFetch('/financial-stress-monitor');
  const shaped = shapeMacroCausalGraph(data && data.event);
  assert.equal(typeof shaped.available, 'boolean');
  if (shaped.available) {
    assert.ok(Array.isArray(shaped.nodes));
    assert.ok(Array.isArray(shaped.edges));
  } else {
    assert.match(shaped.reason, /causal_graph/);
  }
});

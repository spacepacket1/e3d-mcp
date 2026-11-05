// Pure-function tests for lib/financial-stress-monitor.js — no network, no
// server. Fixtures below are trimmed real shapes seen from the live API
// (see the v1/legacy split and evidence shape) plus deliberately malformed
// input to exercise the "never throw on a missing/null/weird field" rule.
// ESM, matching this package's "type": "module".

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeMacroSnapshot,
  shapeMacroHistory,
  shapeMacroCausalGraph,
  shapeRiskMetric,
  RISK_METRIC_METHODOLOGY_NOTE,
} from '../lib/financial-stress-monitor.js';

const V1_EVENT = {
  event_id: 'evt-1', schema_version: '1.0', timestamp: '2026-09-24T08:19:12.606Z',
  review_status: 'not_applicable',
  final_score: 74, final_score_before: 72, final_score_velocity: 2, final_score_acceleration: -2,
  final_regime: 'Restrictive-policy-watch', policy_classifier: 'normal',
  phase: { value: 1, previous_value: 1, change_reason: 'still tightening' },
  controlled_break_risk: { value: 0.25, previous_value: 0.22, change_reason: 'x', velocity: 0.03, acceleration: -0.01 },
  liquidity_response_probability: { value: 0.32, previous_value: 0.3, change_reason: 'y' },
  subscores: { treasury_stress: { value: 0.7, previous_value: 0.66, change_reason: 'z', evidence: [] } },
  asset_triggers: [{ asset: 'BTC', utility_score: 0.4, role: 'CONFIRMING', note: 'n' }],
  drivers: ['a', 'b'],
  next_triggers: ['c'],
  dashboard_summary: 'summary text',
  classification_blocks: {
    observed_facts: [{ text: 'fact', evidence: [{ url: 'u', description: 'd' }] }],
    interpretation: [{ text: 'interp', confidence: 0.8 }],
    speculation: [{ text: 'spec', confidence: 0.2 }],
  },
  falsifiable_claim: { response_type: 'none_expected' },
  newsletter_body_html: '<h3>should never appear in tool output</h3>',
  causal_graph: null,
};

const LEGACY_EVENT = {
  final_score: 44, final_score_before: 41,
  controlled_break_risk: { value: 44, previous_value: 41 }, // 0-100, no schema_version
  liquidity_response_probability: { value: 30 },
  phase: { value: 1 },
};

test('shapeMacroSnapshot: no event published yet', () => {
  assert.deepEqual(shapeMacroSnapshot(null), { available: false, reason: 'No evaluation has been published yet.' });
  assert.equal(shapeMacroSnapshot(undefined).available, false);
  assert.equal(shapeMacroSnapshot('not an object').available, false);
});

test('shapeMacroSnapshot: v1 event normalizes risk metrics and preserves raw + unit', () => {
  const snap = shapeMacroSnapshot(V1_EVENT);
  assert.equal(snap.available, true);
  assert.equal(snap.headline_score.value, 74);
  assert.equal(snap.headline_score.previous_value, 72);
  assert.equal(snap.controlled_break_risk.value.raw, 0.25);
  assert.equal(snap.controlled_break_risk.value.normalized, 0.25);
  assert.match(snap.controlled_break_risk.value.unit, /0\.0-1\.0/);
  assert.equal(snap.controlled_break_risk.change_reason, 'x');
  assert.equal(snap.controlled_break_risk.velocity, 0.03);
});

test('shapeMacroSnapshot: legacy (pre-schema_version) event converts 0-100 to a 0.0-1.0 normalized value without discarding the raw one', () => {
  const snap = shapeMacroSnapshot(LEGACY_EVENT);
  assert.equal(snap.schema_version, null);
  assert.equal(snap.controlled_break_risk.value.raw, 44);
  assert.equal(snap.controlled_break_risk.value.normalized, 0.44);
  assert.match(snap.controlled_break_risk.value.unit, /0-100 legacy/);
  assert.equal(snap.controlled_break_risk.previous_value.raw, 41);
  assert.equal(snap.controlled_break_risk.previous_value.normalized, 0.41);
});

test('shapeMacroSnapshot: never throws on missing optional fields', () => {
  const snap = shapeMacroSnapshot({ final_score: 10 });
  assert.equal(snap.available, true);
  assert.equal(snap.headline_score.value, 10);
  assert.equal(snap.controlled_break_risk, null);
  assert.deepEqual(snap.asset_triggers, []);
  assert.deepEqual(snap.drivers, []);
  assert.equal(snap.classification_blocks, null);
  assert.equal(snap.dashboard_summary, null);
});

test('shapeMacroSnapshot: never includes newsletter_body_html', () => {
  const snap = shapeMacroSnapshot(V1_EVENT);
  assert.equal(JSON.stringify(snap).includes('should never appear'), false);
  assert.equal('newsletter_body_html' in snap, false);
});

test('shapeMacroSnapshot: preserves the facts/interpretation/speculation split rather than flattening it', () => {
  const snap = shapeMacroSnapshot(V1_EVENT);
  assert.equal(snap.classification_blocks.observed_facts.length, 1);
  assert.equal(snap.classification_blocks.interpretation.length, 1);
  assert.equal(snap.classification_blocks.speculation.length, 1);
  assert.equal(snap.classification_blocks.observed_facts[0].evidence[0].description, 'd');
});

test('shapeMacroSnapshot: includes the risk-metric methodology caveat', () => {
  const snap = shapeMacroSnapshot(V1_EVENT);
  assert.equal(snap.risk_metric_methodology_note, RISK_METRIC_METHODOLOGY_NOTE);
  assert.match(snap.risk_metric_methodology_note, /not.*calibrated/i);
});

test('shapeMacroSnapshot: headline_score explains previous_value comes from the last published evaluation, not the last cycle', () => {
  const snap = shapeMacroSnapshot(V1_EVENT);
  assert.match(snap.headline_score.previous_value_note, /PUBLISHED/);
  assert.match(snap.headline_score.previous_value_note, /get_macro_history/);
});

test('shapeMacroHistory: empty/malformed input never throws', () => {
  assert.deepEqual(shapeMacroHistory(null).evaluations, []);
  assert.deepEqual(shapeMacroHistory(undefined).evaluations, []);
  assert.deepEqual(shapeMacroHistory('oops').evaluations, []);
  assert.deepEqual(shapeMacroHistory({ error: 'upstream 500' }).evaluations, []);
  // one malformed entry (a bare string) mixed with one good one - the good
  // one still comes through, the malformed one is dropped, nothing throws
  assert.equal(shapeMacroHistory(['bad', { created_at: 't', final_score: 5 }]).count, 1);
});

test('shapeMacroHistory: order is explicitly documented as newest-first', () => {
  const shaped = shapeMacroHistory([{ created_at: 't', final_score: 1 }]);
  assert.equal(shaped.order, 'newest_first');
});

test('shapeMacroHistory: preserves null historical values instead of coercing them', () => {
  const raw = [
    { created_at: '2026-09-03T16:45:09.295Z', schema_version: '', final_score: 3,
      controlled_break_risk: null, liquidity_response_probability: null, phase: null, subscores: {} },
  ];
  const shaped = shapeMacroHistory(raw);
  const entry = shaped.evaluations[0];
  assert.equal(entry.final_score, 3);
  assert.equal(entry.controlled_break_risk, null);
  assert.equal(entry.liquidity_response_probability, null);
  assert.equal(entry.phase, null);
  assert.equal(entry.subscores, null); // {} is treated as "nothing" rather than a spurious present-but-empty object
});

test('shapeMacroHistory: per-entry schema_version drives per-entry unit, not a global one', () => {
  const raw = [
    { created_at: 't1', schema_version: '1.0', final_score: 74, controlled_break_risk: 0.25 },
    { created_at: 't2', schema_version: '', final_score: 40, controlled_break_risk: 44 },
  ];
  const shaped = shapeMacroHistory(raw);
  assert.equal(shaped.evaluations[0].controlled_break_risk.normalized, 0.25);
  assert.equal(shaped.evaluations[1].controlled_break_risk.normalized, 0.44);
  assert.match(shaped.evaluations[0].controlled_break_risk.unit, /0\.0-1\.0/);
  assert.match(shaped.evaluations[1].controlled_break_risk.unit, /legacy/);
});

test('shapeMacroCausalGraph: unavailable when the event has no causal_graph', () => {
  assert.equal(shapeMacroCausalGraph({ causal_graph: null }).available, false);
  assert.equal(shapeMacroCausalGraph({}).available, false);
  assert.equal(shapeMacroCausalGraph(null).available, false);
  assert.match(shapeMacroCausalGraph(null).reason, /causal_graph/);
});

test('shapeMacroCausalGraph: passes through nodes/edges/proposed and defaults a missing proposed array safely', () => {
  const event = {
    causal_graph: {
      snapshot: { id: 'lw-cg-1' },
      nodes: [{ id: 'oil_shock', state: 0.4 }],
      edges: [{ id: 'e1', origin: 'oil_shock', destination: 'inflation', polarity: 'amplifies' }],
      // no `proposed` key at all
    },
  };
  const shaped = shapeMacroCausalGraph(event);
  assert.equal(shaped.available, true);
  assert.equal(shaped.snapshot.id, 'lw-cg-1');
  assert.equal(shaped.nodes.length, 1);
  assert.equal(shaped.edges.length, 1);
  assert.deepEqual(shaped.proposed, []);
  assert.match(shaped.structure_note, /human-authored/);
});

test('shapeRiskMetric: handles a bare number, an object, and null uniformly', () => {
  assert.equal(shapeRiskMetric(null, '1.0'), null);
  assert.equal(shapeRiskMetric(undefined, '1.0'), null);
  assert.equal(shapeRiskMetric(0.5, '1.0').normalized, 0.5);
  assert.equal(shapeRiskMetric(50, null).normalized, 0.5);
  assert.equal(shapeRiskMetric(Number.NaN, '1.0'), null);
});

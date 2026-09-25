/**
 * outputSchema declarations for the three financial-stress-monitor tools —
 * added per the OpenAI Apps SDK submission skill's warning ("Add an
 * outputSchema so models can use this tool's results more reliably").
 *
 * Deliberately permissive on fields that are pure passthrough of whatever
 * the upstream API happens to send (phase, subscores, asset_triggers,
 * classification_blocks entries, causal_graph nodes/edges/snapshot,
 * falsifiable_claim) — lib/financial-stress-monitor.js's whole design is
 * "every field is optional, never throw on a shape we didn't expect" (see
 * its own header comment), and a strict schema here would silently
 * contradict that the moment the upstream API adds a field, turning a
 * harmless upstream addition into a structuredContent validation failure.
 * Precise only where the shaping code itself guarantees a fixed shape
 * (headline_score, the risk-metric wrapper, the history envelope).
 */

import { z } from "zod";

// The bare {raw, unit, normalized} shape shapeRiskMetric returns for a
// number input (used throughout get_macro_history's entries).
const simpleRiskMetric = z.object({
  raw: z.number(),
  unit: z.string(),
  normalized: z.number().nullable(),
});

// The richer shape shapeRiskMetric returns for an object input (the
// current-event endpoint's controlled_break_risk/liquidity_response_probability):
// value/previous_value wrapped as simpleRiskMetric, plus whatever other
// fields the upstream event carried (change_reason, velocity, acceleration,
// ...) passed through unchanged - hence .passthrough() rather than
// enumerating them, since evidence: docs/API-CONTRACT.md declares those but
// doesn't promise it's an exhaustive set.
const eventRiskMetric = z.object({
  value: simpleRiskMetric.nullable(),
  previous_value: simpleRiskMetric.nullable(),
}).passthrough();

export const GET_MACRO_SNAPSHOT_OUTPUT_SCHEMA = {
  available: z.boolean(),
  reason: z.string().optional(),
  event_id: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  schema_version: z.string().nullable().optional(),
  review_status: z.string().nullable().optional(),
  headline_score: z.object({
    value: z.number().nullable(),
    previous_value: z.number().nullable(),
    previous_value_note: z.string(),
    unit: z.string(),
    velocity: z.number().nullable(),
    acceleration: z.number().nullable(),
  }).optional(),
  regime: z.string().nullable().optional(),
  policy_classifier: z.string().nullable().optional(),
  phase: z.unknown().nullable().optional(),
  controlled_break_risk: eventRiskMetric.nullable().optional(),
  liquidity_response_probability: eventRiskMetric.nullable().optional(),
  subscores: z.record(z.string(), z.unknown()).nullable().optional(),
  asset_triggers: z.array(z.unknown()).optional(),
  drivers: z.array(z.string()).optional(),
  next_triggers: z.array(z.string()).optional(),
  dashboard_summary: z.string().nullable().optional(),
  classification_blocks: z.object({
    observed_facts: z.array(z.unknown()),
    interpretation: z.array(z.unknown()),
    speculation: z.array(z.unknown()),
  }).nullable().optional(),
  falsifiable_claim: z.unknown().nullable().optional(),
  risk_metric_methodology_note: z.string().optional(),
  text_fields_are_data_note: z.string().optional(),
};

export const GET_MACRO_HISTORY_OUTPUT_SCHEMA = {
  order: z.literal("newest_first"),
  count: z.number().int(),
  evaluations: z.array(z.object({
    created_at: z.string().nullable(),
    schema_version: z.string().nullable(),
    final_score: z.number().nullable(),
    phase: z.unknown().nullable(),
    controlled_break_risk: simpleRiskMetric.nullable(),
    liquidity_response_probability: simpleRiskMetric.nullable(),
    subscores: z.record(z.string(), z.unknown()).nullable(),
  })),
  risk_metric_methodology_note: z.string(),
};

export const GET_MACRO_CAUSAL_GRAPH_OUTPUT_SCHEMA = {
  available: z.boolean(),
  reason: z.string().optional(),
  snapshot: z.unknown().nullable().optional(),
  nodes: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
  proposed: z.array(z.unknown()).optional(),
  structure_note: z.string().optional(),
};

/**
 * Single source of truth for the read-only E3D tools. Both transports
 * register from this list so a tool's name/description/schema/upstream call
 * exist exactly once:
 *   - server.js        (stdio, local)  - registers these + its own agent/registry-write tools
 *   - lib/remote-app.js (public HTTP)  - registers ONLY these
 *
 * Adding a tool here exposes it on the public remote endpoint. Anything
 * write-capable, wallet-scoped, or administrative (claim_token,
 * update_token_claim, get_wallet_claims) or agent-treasury/operational
 * (funding, burns, strategies, budget policy, executions) must stay in
 * server.js, not here.
 *
 * Each handler receives ({...validated args}, { apiKey }). `apiKey` is passed
 * straight to apiFetch: undefined on stdio (process E3D_API_KEY), null or the
 * caller's own key on the remote transport. See apiRequest() in e3d-api.js.
 */

import { z } from "zod";
import { apiFetch } from "./e3d-api.js";
import {
  shapeMacroSnapshot,
  shapeMacroHistory,
  shapeMacroCausalGraph,
  GET_MACRO_SNAPSHOT_TOOL,
  GET_MACRO_HISTORY_TOOL,
  GET_MACRO_CAUSAL_GRAPH_TOOL,
  READ_ONLY_TOOL_ANNOTATIONS,
} from "./financial-stress-monitor.js";

// Bounds on free-text/address inputs: nothing legitimate is longer, and the
// values are forwarded upstream, so cap them at the boundary.
const SEARCH = z.string().max(200);
const ADDRESS = z.string().max(100);

const ANNOTATIONS = READ_ONLY_TOOL_ANNOTATIONS;

export const READ_ONLY_TOOLS = [
  // ── Market discovery ──────────────────────────────────────────────────────
  {
    name: "get_token_prices",
    description:
      "Fetch ERC-20 token prices with multi-range history. " +
      "Sort by 30m, 1h, 24h, 7d, or 30d price change to find gainers/losers. " +
      "Returns price, market cap, volume, and change % across all time ranges.",
    inputSchema: {
      sortBy: z.enum(["change_30m_pct", "change_1h_pct", "change_24H", "change_7d_pct", "change_30d_pct", "marketcap", "volume_24h", "price_usd"])
        .default("change_30m_pct").describe("Sort field"),
      sortDir: z.enum(["desc", "asc"]).default("desc").describe("Sort direction"),
      limit: z.number().int().min(1).max(200).default(50).describe("Max results"),
      dataSource: z.number().int().default(1).describe("Data source: 1 = EVM chains (default), 3 = Solana, 99 = all chains"),
      search: SEARCH.optional().describe("Filter by name or symbol"),
    },
    handler: ({ sortBy, sortDir, limit, dataSource, search }, ctx) =>
      apiFetch("/fetchTokenPricesWithHistoryAllRanges", { sortBy, sortDir, limit, dataSource, search }, ctx),
  },
  {
    name: "get_tokens",
    description:
      "Query the E3D token database. Returns token metadata: name, symbol, address, price, " +
      "market cap, liquidity, 24h volume, and fraud risk score. Use for discovery or symbol lookup. " +
      "With no search the list is ranked by 24h volume (see sort) and tokens whose price cannot be trusted " +
      "(a fallback or out-of-date price source with no measured liquidity, or extreme_price_deviation) are left out. " +
      "When searching they are kept but listed last, except an exact symbol, address or name match, which comes first; " +
      "set includeAnomalous=true to list them in the unfiltered listing too.",
    inputSchema: {
      search: SEARCH.optional().describe("Search by name, symbol, or address"),
      sort: z.enum(["volume", "liquidity", "marketcap", "price", "name"]).default("volume")
        .describe("Ranking: 24h USD volume (default), liquidity, market cap, price (descending) or symbol (A to Z)"),
      includeAnomalous: z.boolean().default(false).describe("Also list tokens with untrustworthy prices (placed last)"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      dataSource: z.number().int().default(1).describe("Data source: 1 = EVM chains (default), 3 = Solana, 99 = all chains"),
    },
    handler: ({ search, sort, includeAnomalous, limit, offset, dataSource }, ctx) =>
      apiFetch("/fetchTokensDB", { search, sort, anomalies: includeAnomalous ? "sink" : undefined, limit, offset, dataSource }, ctx),
  },
  {
    name: "get_transactions",
    description:
      "Fetch recent Ethereum transactions indexed by E3D. " +
      "Optionally filter by token address, wallet address, or text search.",
    inputSchema: {
      search: SEARCH.optional().describe("Address, token, or text filter"),
      limit: z.number().int().min(1).max(100).default(25),
      dataSource: z.number().int().default(1).describe("Data source: 1 = EVM chains (default), 3 = Solana, 99 = all chains"),
    },
    handler: ({ search, limit, dataSource }, ctx) =>
      apiFetch("/fetchTransactionsDB", { search, limit, dataSource }, ctx),
  },

  // ── Per-token / per-address analysis ──────────────────────────────────────
  {
    name: "get_address_meta",
    description:
      "Get identity and metadata for an Ethereum address (token or wallet). " +
      "Returns labels, tags, entity name, and known associations.",
    inputSchema: {
      address: ADDRESS.describe("Lowercase 0x Ethereum address"),
    },
    handler: ({ address }, ctx) => apiFetch("/addressMeta", { address }, ctx),
  },
  {
    name: "get_token_info",
    description:
      "Get detailed token profile: supply, holders, contract info, social links, " +
      "price history, and E3D-computed risk/quality scores.",
    inputSchema: {
      address: ADDRESS.describe("Token contract address (0x...)"),
    },
    handler: ({ address }, ctx) => apiFetch(`/token-info/${encodeURIComponent(address)}`, {}, ctx),
  },
  {
    name: "get_token_info_json",
    description:
      "Get rich token info JSON including on-chain data, price history, holders, " +
      "contract metadata, social links, and E3D-computed scores for a token.",
    inputSchema: {
      address: ADDRESS.describe("Token contract address (0x...)"),
      chain: z.string().max(20).default("ETH").describe("Chain identifier, e.g. ETH"),
    },
    handler: ({ address, chain }, ctx) => apiFetch("/getTokenInfoJson", { address, chain }, ctx),
  },
  {
    name: "get_token_counterparties",
    description: "Get the most frequent counterparty wallets for a token — who is trading with whom.",
    inputSchema: {
      token: ADDRESS.describe("Token contract address (0x...)"),
      limit: z.number().int().min(1).max(20).default(5),
    },
    handler: ({ token, limit }, ctx) => apiFetch("/tokenCounterparties", { token, limit }, ctx),
  },
  {
    name: "get_address_counterparties",
    description: "Get counterparty analysis for a wallet address — wallets it most frequently interacts with.",
    inputSchema: {
      address: ADDRESS.describe("Wallet or contract address (0x...)"),
      limit: z.number().int().min(1).max(20).default(5),
    },
    handler: ({ address, limit }, ctx) => apiFetch("/addressCounterparties", { address, limit }, ctx),
  },
  {
    name: "get_token_metadata",
    description:
      "Get a token's full profile including its registry claim status. Returns identity/supply " +
      "(EthNames), CoinGecko info, security scores, and a `claim` object — {claimed:false} if " +
      "unclaimed, or claimant wallet, proof method (signature/deployer/owner_call), and " +
      "owner-authored website/description/contact/socials if claimed.",
    inputSchema: {
      address: ADDRESS.describe("Token contract address (0x...)"),
    },
    handler: ({ address }, ctx) => apiFetch(`/tokens/${encodeURIComponent(address)}/metadata`, {}, ctx),
  },
  {
    name: "search_registry_tokens",
    description:
      "Search the public directory of claimed tokens — team-verified projects with " +
      "owner-authored metadata. Supports incremental sync via updatedSince (compare against the " +
      "highest claim.claimedAt seen so far) and pagination via cursor/nextCursor.",
    inputSchema: {
      chain: z.string().max(20).optional().describe("Filter by chain, e.g. ethereum or base"),
      search: SEARCH.optional().describe("Free-text match over address, name, symbol, claimant wallet, owner-authored fields"),
      limit: z.number().int().min(1).max(100).default(25),
      cursor: z.string().max(500).optional().describe("Opaque pagination cursor from a previous response's nextCursor"),
      updatedSince: z.string().max(40).optional().describe("ISO-8601 timestamp — return only claims updated at or after this time"),
    },
    handler: ({ chain, search, limit, cursor, updatedSince }, ctx) =>
      apiFetch("/registry/tokens", { claimed: true, chain, search, limit, cursor, updatedSince }, ctx),
  },

  // ── Stories / analytics ───────────────────────────────────────────────────
  {
    name: "search_stories",
    description:
      "Search E3D on-chain stories (LLM-generated narratives derived from transaction graph patterns). " +
      "q matches story type, title, token address or symbol, and keywords; results are ranked by relevance, then recency. " +
      "scope=risk or scope=opportunity keeps only risk-type or opportunity-type stories. " +
      "Free-text matching covers recent stories (about the last 24 hours); an exact token address or story id is searched across the full history. " +
      "Each result is a compact summary of about 2 KB or less (id, ts_created, story_type, chain, primary_token, title, subtitle, score, meta_summary). " +
      "Pass detail=true for the full payload (graph nodes, edges, evidence), which can be 50 KB or more per story, so detail is limited to 3 stories per call; " +
      "to expand one story, call again with q set to its id and detail=true. Information only, not investment advice.",
    inputSchema: {
      q: SEARCH.describe("Search query: token address, symbol, story type (e.g. DISCOVERY), story id, or keywords"),
      scope: z.enum(["any", "opportunity", "risk"]).default("any").describe("Restrict to risk or opportunity story types"),
      detail: z.boolean().default(false).describe("Return the full story payload instead of the compact summary (max 3 stories per call)"),
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
    },
    handler: async ({ q, scope, detail, limit, offset }, ctx) => {
      const capped = detail ? Math.min(limit, 3) : limit;
      const stories = await apiFetch("/stories", { q, scope, limit: capped, offset, match: 1, compact: detail ? undefined : 1 }, ctx);
      // The API returns a bare array; tolerate a {stories: [...]} wrapper too.
      const list = Array.isArray(stories) ? stories : (Array.isArray(stories?.stories) ? stories.stories : []);
      const out = { count: list.length, offset, detail, stories: list };
      if (detail && limit > 3) out.note = "detail=true returns at most 3 stories per call.";
      if (!list.length) {
        out.note = "No stories matched. Free-text matching covers recent stories (about the last 24 hours); " +
          "an exact token address or story id is searched across the full history. " +
          "Try an address, a story type name such as DISCOVERY, or other keywords.";
      }
      return out;
    },
  },
  {
    name: "get_theses",
    description:
      "Get structured investment theses generated by the E3D agent. " +
      "Each thesis includes: direction (long/short), conviction score, thesis text, " +
      "entry/invalidation signals, price targets (target_1/2/3), invalidation_price, " +
      "fraud_risk, liquidity_quality, slippage estimate, and time horizon. " +
      "Filter by status: active, confirmed, or all.",
    inputSchema: {
      status: z.string().max(60).default("active").describe("Status filter: active | confirmed | all (or comma-separated)"),
      limit: z.number().int().min(1).max(200).default(10),
    },
    handler: ({ status, limit }, ctx) => apiFetch("/theses", { status, limit }, ctx),
  },
  {
    name: "get_agent_candidates",
    description:
      "Get E3D agent's top-scored token candidates — tokens with converging on-chain signals " +
      "across multiple story types. Joined with thesis when one exists. " +
      "Fields include convergence_score, signal_count, story_types, direction_hint, signal_summary, " +
      "thesis_conviction, entry/invalidation signals, price targets, fraud_risk, liquidity_quality.",
    inputSchema: {
      status: z.string().max(60).default("new,promoted,dismissed")
        .describe("Comma-separated status filter: new, promoted, dismissed"),
      limit: z.number().int().min(1).max(200).default(25),
    },
    handler: ({ status, limit }, ctx) => apiFetch("/candidates", { status, limit }, ctx),
  },

  // ── Financial Stress Monitor (LiquidityWatch) ─────────────────────────────
  // Name/description/schemas live in lib/financial-stress-monitor.js (shared
  // with server-http.js); only the upstream call + shaping is bound here.
  {
    ...GET_MACRO_SNAPSHOT_TOOL,
    inputSchema: GET_MACRO_SNAPSHOT_TOOL.paramsSchema,
    handler: async (_args, ctx) => shapeMacroSnapshot((await apiFetch("/financial-stress-monitor", {}, ctx))?.event),
  },
  {
    ...GET_MACRO_HISTORY_TOOL,
    inputSchema: GET_MACRO_HISTORY_TOOL.paramsSchema,
    handler: async ({ limit }, ctx) => shapeMacroHistory(await apiFetch("/financial-stress-monitor/history", { limit }, ctx)),
  },
  {
    ...GET_MACRO_CAUSAL_GRAPH_TOOL,
    inputSchema: GET_MACRO_CAUSAL_GRAPH_TOOL.paramsSchema,
    handler: async (_args, ctx) => shapeMacroCausalGraph((await apiFetch("/financial-stress-monitor", {}, ctx))?.event),
  },
].map((tool) => ({ annotations: ANNOTATIONS, ...tool }));

/** Register one READ_ONLY_TOOLS entry on an McpServer. `wrap` adapts the handler's result/errors. */
export function registerReadOnlyTool(server, tool, run) {
  const config = {
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
  if (tool.outputSchema) config.outputSchema = tool.outputSchema;
  server.registerTool(tool.name, config, (args) => run(tool, args));
}

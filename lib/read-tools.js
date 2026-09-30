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
      dataSource: z.number().int().default(1).describe("Data source ID (1 = mainnet)"),
      search: SEARCH.optional().describe("Filter by name or symbol"),
    },
    handler: ({ sortBy, sortDir, limit, dataSource, search }, ctx) =>
      apiFetch("/fetchTokenPricesWithHistoryAllRanges", { sortBy, sortDir, limit, dataSource, search }, ctx),
  },
  {
    name: "get_tokens",
    description:
      "Query the E3D token database. Returns token metadata: name, symbol, address, " +
      "market cap, liquidity, and fraud risk score. Use for discovery or symbol lookup.",
    inputSchema: {
      search: SEARCH.optional().describe("Search by name, symbol, or address"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      dataSource: z.number().int().default(1),
    },
    handler: ({ search, limit, offset, dataSource }, ctx) =>
      apiFetch("/fetchTokensDB", { search, limit, offset, dataSource }, ctx),
  },
  {
    name: "get_transactions",
    description:
      "Fetch recent Ethereum transactions indexed by E3D. " +
      "Optionally filter by token address, wallet address, or text search.",
    inputSchema: {
      search: SEARCH.optional().describe("Address, token, or text filter"),
      limit: z.number().int().min(1).max(100).default(25),
      dataSource: z.number().int().default(1),
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
      "Search E3D on-chain stories by keyword, token symbol, or address. " +
      "Stories are LLM-generated narratives derived from transaction graph patterns.",
    inputSchema: {
      q: SEARCH.describe("Search query: address, symbol, or keywords"),
      scope: z.enum(["any", "opportunity", "risk"]).default("any"),
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
    },
    handler: ({ q, scope, limit, offset }, ctx) => apiFetch("/stories", { q, scope, limit, offset }, ctx),
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

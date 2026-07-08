#!/usr/bin/env node
/**
 * E3D.ai MCP Server
 *
 * Wraps the E3D.ai API (https://e3d.ai/api) as MCP tools.
 * Auth: set E3D_API_KEY env var to your key (x-api-key header).
 * If unset, requests are unauthenticated (web-client tier, no rate attribution).
 *
 * Tool categories:
 *   Market discovery   — token prices, universe, recent transactions
 *   Per-token analysis — identity, evidence, stories, theses, flow, cohorts
 *   Search             — stories/transactions by query or address
 *   Agent system       — list/detail agents, artifacts, next actions, funding, burns
 *   Token registry     — claim status/metadata, claimed-token directory, claim/update a token
 *
 * Token registry write tools (claim_token, update_token_claim, get_wallet_claims) need a
 * bearer token the caller obtained outside this server: a short-lived sessionToken from
 * POST /api/entitlements/challenge + /api/entitlements/verify (wallet-signature proof), or
 * the long-lived e3d_claim_... apiKey a successful claim returns. See
 * docs/token-claim-quickstart.md in the e3d repo for the full sequence, including the
 * on-chain fee payment step this server cannot perform on the caller's behalf.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.E3D_API_BASE_URL || "https://e3d.ai/api").replace(/\/$/, "");
const API_KEY  = process.env.E3D_API_KEY || "";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function apiRequest(method, pathname, { query = {}, body, bearerToken } = {}) {
  const url = new URL(BASE_URL + pathname);
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

async function apiFetch(pathname, query = {}) {
  return apiRequest("GET", pathname, { query });
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "e3d-ai",
  version: "1.0.0",
});

// ── Market discovery ────────────────────────────────────────────────────────

server.tool(
  "get_token_prices",
  "Fetch ERC-20 token prices with multi-range history. " +
  "Sort by 30m, 1h, 24h, 7d, or 30d price change to find gainers/losers. " +
  "Returns price, market cap, volume, and change % across all time ranges.",
  {
    sortBy:    z.enum(["change_30m_pct","change_1h_pct","change_24H","change_7d_pct","change_30d_pct","marketcap","volume_24h","price_usd"])
                .default("change_30m_pct").describe("Sort field"),
    sortDir:   z.enum(["desc","asc"]).default("desc").describe("Sort direction"),
    limit:     z.number().int().min(1).max(200).default(50).describe("Max results"),
    dataSource: z.number().int().default(1).describe("Data source ID (1 = mainnet)"),
    search:    z.string().optional().describe("Filter by name or symbol"),
  },
  async ({ sortBy, sortDir, limit, dataSource, search }) => {
    const data = await apiFetch("/fetchTokenPricesWithHistoryAllRanges", { sortBy, sortDir, limit, dataSource, search });
    return ok(data);
  }
);

server.tool(
  "get_tokens",
  "Query the E3D token database. Returns token metadata: name, symbol, address, " +
  "market cap, liquidity, and fraud risk score. Use for discovery or symbol lookup.",
  {
    search:     z.string().optional().describe("Search by name, symbol, or address"),
    limit:      z.number().int().min(1).max(200).default(50),
    offset:     z.number().int().min(0).default(0),
    dataSource: z.number().int().default(1),
  },
  async ({ search, limit, offset, dataSource }) => {
    const data = await apiFetch("/fetchTokensDB", { search, limit, offset, dataSource });
    return ok(data);
  }
);

server.tool(
  "get_transactions",
  "Fetch recent Ethereum transactions indexed by E3D. " +
  "Optionally filter by token address, wallet address, or text search.",
  {
    search:     z.string().optional().describe("Address, token, or text filter"),
    limit:      z.number().int().min(1).max(100).default(25),
    dataSource: z.number().int().default(1),
  },
  async ({ search, limit, dataSource }) => {
    const data = await apiFetch("/fetchTransactionsDB", { search, limit, dataSource });
    return ok(data);
  }
);

// ── Per-token analysis ──────────────────────────────────────────────────────

server.tool(
  "get_address_meta",
  "Get identity and metadata for an Ethereum address (token or wallet). " +
  "Returns labels, tags, entity name, and known associations.",
  {
    address: z.string().describe("Lowercase 0x Ethereum address"),
  },
  async ({ address }) => {
    const data = await apiFetch("/addressMeta", { address });
    return ok(data);
  }
);

server.tool(
  "get_token_info",
  "Get detailed token profile: supply, holders, contract info, social links, " +
  "price history, and E3D-computed risk/quality scores.",
  {
    address: z.string().describe("Token contract address (0x...)"),
  },
  async ({ address }) => {
    const data = await apiFetch(`/token-info/${encodeURIComponent(address)}`);
    return ok(data);
  }
);

server.tool(
  "get_token_info_json",
  "Get rich token info JSON including on-chain data, price history, holders, " +
  "contract metadata, social links, and E3D-computed scores for a token.",
  {
    address: z.string().describe("Token contract address (0x...)"),
    chain:   z.string().default("ETH").describe("Chain identifier, e.g. ETH"),
  },
  async ({ address, chain }) => {
    const data = await apiFetch("/getTokenInfoJson", { address, chain });
    return ok(data);
  }
);

server.tool(
  "get_agent_candidates",
  "Get E3D agent's top-scored token candidates — tokens with converging on-chain signals " +
  "across multiple story types. Joined with thesis when one exists. " +
  "Fields include convergence_score, signal_count, story_types, direction_hint, signal_summary, " +
  "thesis_conviction, entry/invalidation signals, price targets, fraud_risk, liquidity_quality.",
  {
    status: z.string().default("new,promoted,dismissed")
              .describe("Comma-separated status filter: new, promoted, dismissed"),
    limit:  z.number().int().min(1).max(200).default(25),
  },
  async ({ status, limit }) => {
    const data = await apiFetch("/candidates", { status, limit });
    return ok(data);
  }
);

server.tool(
  "get_theses",
  "Get structured investment theses generated by the E3D agent. " +
  "Each thesis includes: direction (long/short), conviction score, thesis text, " +
  "entry/invalidation signals, price targets (target_1/2/3), invalidation_price, " +
  "fraud_risk, liquidity_quality, slippage estimate, and time horizon. " +
  "Filter by status: active, confirmed, or all.",
  {
    status: z.string().default("active")
              .describe("Status filter: active | confirmed | all (or comma-separated)"),
    limit:  z.number().int().min(1).max(200).default(10),
  },
  async ({ status, limit }) => {
    const data = await apiFetch("/theses", { status, limit });
    return ok(data);
  }
);

server.tool(
  "get_token_counterparties",
  "Get the most frequent counterparty wallets for a token — who is trading with whom.",
  {
    token:  z.string().describe("Token contract address (0x...)"),
    limit:  z.number().int().min(1).max(20).default(5),
  },
  async ({ token, limit }) => {
    const data = await apiFetch("/tokenCounterparties", { token, limit });
    return ok(data);
  }
);

server.tool(
  "get_address_counterparties",
  "Get counterparty analysis for a wallet address — wallets it most frequently interacts with.",
  {
    address: z.string().describe("Wallet or contract address (0x...)"),
    limit:   z.number().int().min(1).max(20).default(5),
  },
  async ({ address, limit }) => {
    const data = await apiFetch("/addressCounterparties", { address, limit });
    return ok(data);
  }
);

// ── Stories search ──────────────────────────────────────────────────────────

server.tool(
  "search_stories",
  "Search E3D on-chain stories by keyword, token symbol, or address. " +
  "Stories are LLM-generated narratives derived from transaction graph patterns.",
  {
    q:      z.string().describe("Search query: address, symbol, or keywords"),
    scope:  z.enum(["any","opportunity","risk"]).default("any"),
    limit:  z.number().int().min(1).max(50).default(10),
    offset: z.number().int().min(0).default(0),
  },
  async ({ q, scope, limit, offset }) => {
    const data = await apiFetch("/stories", { q, scope, limit, offset });
    return ok(data);
  }
);

// ── Agent system ────────────────────────────────────────────────────────────

server.tool(
  "get_agents",
  "List E3D AI agents. Each ERC-20 token can have an activated AI agent. " +
  "Returns agent status (running/dormant/hibernating/failed), E3D balance, and metadata.",
  {
    limit:  z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0),
    status: z.enum(["running","dormant","hibernating","failed"]).optional().describe("Filter by status"),
  },
  async ({ limit, offset, status }) => {
    const data = await apiFetch("/agents", { limit, offset, status });
    return ok(data);
  }
);

server.tool(
  "get_agent",
  "Get full details for a specific AI agent by token address. " +
  "Includes status, E3D treasury balance, soul IPFS hash, focus areas, goals, and heartbeat timestamp.",
  {
    tokenAddress: z.string().describe("ERC-20 token contract address (0x...)"),
  },
  async ({ tokenAddress }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}`);
    return ok(data);
  }
);

server.tool(
  "get_agent_stats",
  "Get aggregate statistics for all E3D agents: counts by status.",
  {},
  async () => {
    const data = await apiFetch("/agents/stats");
    return ok(data);
  }
);

server.tool(
  "get_agent_artifacts",
  "Get artifacts produced by an agent: analyses, reports, strategies, and other outputs. " +
  "Public artifacts are visible to all; private artifacts require appropriate auth.",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
    limit:        z.number().int().min(1).max(50).default(10),
  },
  async ({ tokenAddress, limit }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/artifacts`, { limit });
    return ok(data);
  }
);

server.tool(
  "get_agent_next_action",
  "Get the agent's current next-best-action recommendation: what it plans to do next, " +
  "why now, estimated E3D burn, confidence score, and any blockers.",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
  },
  async ({ tokenAddress }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/next_action`);
    return ok(data);
  }
);

server.tool(
  "get_agent_funding",
  "Get funding history and treasury stats for an agent: total funded, total burned, " +
  "daily/weekly burn rate, and escrow contract info.",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
    limit:        z.number().int().min(1).max(50).default(10).describe("Max funding history items"),
  },
  async ({ tokenAddress, limit }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/funding_info`, { limit });
    return ok(data);
  }
);

server.tool(
  "get_agent_burns",
  "Get E3D token burn history for an agent along with burn statistics (daily/weekly totals).",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
    limit:        z.number().int().min(1).max(50).default(10),
  },
  async ({ tokenAddress, limit }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/burns`, { limit });
    return ok(data);
  }
);

server.tool(
  "get_agent_value_events",
  "Get value-creation events logged by an agent — moments where the agent " +
  "generated measurable value (in E3D) and the reason.",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
    limit:        z.number().int().min(1).max(50).default(10),
  },
  async ({ tokenAddress, limit }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/value_events`, { limit });
    return ok(data);
  }
);

server.tool(
  "get_agent_executions",
  "Get execution history for an agent: each run with status, start/end timestamps, " +
  "E3D burned per execution, and result codes.",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
    limit:        z.number().int().min(1).max(50).default(10),
  },
  async ({ tokenAddress, limit }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/executions`, { limit });
    return ok(data);
  }
);

server.tool(
  "get_agent_strategies",
  "Get configured strategies for an agent: which strategy types are enabled, " +
  "approval mode (auto vs proposal-only), burn caps, risk level, and config.",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
  },
  async ({ tokenAddress }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/strategies`);
    return ok(data);
  }
);

server.tool(
  "get_agent_budget_policy",
  "Get the budget and treasury policy for an agent: daily/weekly burn caps, " +
  "minimum balance thresholds, hibernate trigger, and current treasury state.",
  {
    tokenAddress: z.string().describe("Token contract address (0x...)"),
  },
  async ({ tokenAddress }) => {
    const data = await apiFetch(`/agents/${encodeURIComponent(tokenAddress)}/budget_policy`);
    return ok(data);
  }
);

// ── Token registry ──────────────────────────────────────────────────────────

const SOCIALS_SHAPE = z.record(z.string(), z.string())
  .optional().describe("Social links, e.g. { \"x\": \"https://x.com/...\", \"telegram\": \"https://t.me/...\" }");

server.tool(
  "get_token_metadata",
  "Get a token's full profile including its registry claim status. Returns identity/supply " +
  "(EthNames), CoinGecko info, security scores, and a `claim` object — {claimed:false} if " +
  "unclaimed, or claimant wallet, proof method (signature/deployer/owner_call), and " +
  "owner-authored website/description/contact/socials if claimed.",
  {
    address: z.string().describe("Token contract address (0x...)"),
  },
  async ({ address }) => {
    const data = await apiFetch(`/tokens/${encodeURIComponent(address)}/metadata`);
    return ok(data);
  }
);

server.tool(
  "search_registry_tokens",
  "Search the public directory of claimed tokens — team-verified projects with " +
  "owner-authored metadata. Supports incremental sync via updatedSince (compare against the " +
  "highest claim.claimedAt seen so far) and pagination via cursor/nextCursor.",
  {
    chain:        z.string().optional().describe("Filter by chain, e.g. ethereum or base"),
    search:       z.string().optional().describe("Free-text match over address, name, symbol, claimant wallet, owner-authored fields"),
    limit:        z.number().int().min(1).max(100).default(25),
    cursor:       z.string().optional().describe("Opaque pagination cursor from a previous response's nextCursor"),
    updatedSince: z.string().optional().describe("ISO-8601 timestamp — return only claims updated at or after this time"),
  },
  async ({ chain, search, limit, cursor, updatedSince }) => {
    const data = await apiFetch("/registry/tokens", { claimed: true, chain, search, limit, cursor, updatedSince });
    return ok(data);
  }
);

server.tool(
  "get_wallet_claims",
  "List every token claim held by a wallet. Requires a sessionToken (short-lived bearer " +
  "token from POST /api/entitlements/challenge + /api/entitlements/verify — wallet-signature " +
  "proof, obtained outside this server).",
  {
    sessionToken: z.string().describe("Bearer sessionToken from the entitlements challenge/verify flow"),
    wallet:       z.string().optional().describe("Filter by wallet address"),
    chain:        z.string().optional().describe("Filter by chain, e.g. ethereum or base"),
  },
  async ({ sessionToken, wallet, chain }) => {
    const data = await apiRequest("GET", "/registry/my-claims", { query: { wallet, chain }, bearerToken: sessionToken });
    return ok(data);
  }
);

server.tool(
  "claim_token",
  "Claim an already-indexed token: attach owner-authored metadata and get a scoped API key " +
  "to update it later. Requires a sessionToken (see get_wallet_claims) and a feeTxHash from an " +
  "already-confirmed on-chain fee payment (1 E3D on Ethereum or 1 wE3D on Base — confirm the " +
  "live amount via GET /api/payments/products first; this tool does not send the payment). " +
  "proofMethod: use owner_call or deployer if the wallet actually controls the contract " +
  "(stronger, can supersede a weaker existing claim) or signature otherwise. Returns a " +
  "long-lived apiKey shown only once — store it, there is no recovery.",
  {
    address:       z.string().describe("Token contract address to claim (0x...)"),
    sessionToken:  z.string().describe("Bearer sessionToken from the entitlements challenge/verify flow"),
    wallet:        z.string().describe("Claimant wallet address (0x...)"),
    chain:         z.string().default("ethereum").describe("Chain of the token being claimed"),
    feeTxHash:     z.string().describe("Transaction hash of the confirmed claim-fee payment. Single-use — cannot back more than one successful claim"),
    paymentMethod: z.string().optional().describe("e.g. ethereum-e3d or base-we3d — must match the chain actually paid on"),
    proofMethod:   z.enum(["signature", "deployer", "owner_call"]).default("signature"),
    website:       z.string().optional(),
    description:   z.string().optional(),
    contact:       z.string().optional(),
    socials:       SOCIALS_SHAPE,
  },
  async ({ address, sessionToken, wallet, chain, feeTxHash, paymentMethod, proofMethod, website, description, contact, socials }) => {
    const data = await apiRequest("POST", `/registry/tokens/${encodeURIComponent(address)}/claim`, {
      bearerToken: sessionToken,
      body: { wallet, chain, feeTxHash, paymentMethod, proofMethod, website, description, contact, socials },
    });
    return ok(data);
  }
);

server.tool(
  "update_token_claim",
  "Update the owner-authored fields (website/description/contact/socials) on an existing " +
  "token claim. Requires the claim's own long-lived apiKey (e3d_claim_..., returned once by " +
  "claim_token) — not a wallet sessionToken. Evidence and proof method are never editable here.",
  {
    address:     z.string().describe("Claimed token's contract address (0x...)"),
    apiKey:      z.string().describe("The e3d_claim_... API key returned when this token was claimed"),
    chain:       z.string().optional(),
    website:     z.string().optional(),
    description: z.string().optional(),
    contact:     z.string().optional(),
    socials:     SOCIALS_SHAPE,
  },
  async ({ address, apiKey, chain, website, description, contact, socials }) => {
    const data = await apiRequest("PUT", `/registry/tokens/${encodeURIComponent(address)}/claim`, {
      bearerToken: apiKey,
      body: { chain, website, description, contact, socials },
    });
    return ok(data);
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

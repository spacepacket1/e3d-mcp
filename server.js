#!/usr/bin/env node
/**
 * E3D.ai MCP Server
 *
 * Wraps the E3D.ai API (https://e3d.ai/api) as MCP tools.
 * Auth: set E3D_API_KEY env var to your key (x-api-key header).
 * If unset, requests are unauthenticated (web-client tier, no rate attribution).
 *
 * Tool categories:
 *   Market discovery         — token prices, universe, recent transactions
 *   Per-token analysis       — identity, evidence, stories, theses, flow, cohorts
 *   Search                   — stories/transactions by query or address
 *   Agent system             — list/detail agents, artifacts, next actions, funding, burns
 *   Token registry           — claim status/metadata, claimed-token directory, claim/update a token
 *   Financial Stress Monitor — LiquidityWatch macro snapshot/history/causal graph (read-only)
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
import { apiRequest, apiFetch, ok, okStructured } from "./lib/e3d-api.js";
import { READ_ONLY_TOOLS, registerReadOnlyTool } from "./lib/read-tools.js";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "e3d-ai",
  version: "1.0.0",
});

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
  "to update it later. Requires a sessionToken (see get_wallet_claims) proving the *claiming* " +
  "wallet actually controls the contract, and a feeTxHash from an already-confirmed on-chain " +
  "fee payment (1 E3D on Ethereum or 1 wE3D on Base — confirm the live amount via " +
  "GET /api/payments/products first; this tool does not send the payment). The fee payment " +
  "does NOT have to come from the claiming wallet — pay it from any wallet (e.g. this agent's " +
  "own treasury) and pass the resulting tx hash here; only the sessionToken/wallet pairing has " +
  "to match the contract's owner()/deployer. proofMethod must be owner_call or deployer — " +
  "signature-only proof is rejected outright (403 PROOF_METHOD_NOT_ALLOWED), and omitting " +
  "proofMethod is rejected too (400 PROOF_METHOD_REQUIRED). Returns a long-lived apiKey shown " +
  "only once — store it, there is no recovery.",
  {
    address:       z.string().describe("Token contract address to claim (0x...)"),
    sessionToken:  z.string().describe("Bearer sessionToken from the entitlements challenge/verify flow, proving control of `wallet`"),
    wallet:        z.string().describe("Claimant wallet address (0x...) — must match owner() or the contract's deployer"),
    chain:         z.string().default("ethereum").describe("Chain of the token being claimed"),
    feeTxHash:     z.string().describe("Transaction hash of the confirmed claim-fee payment, from any wallet. Single-use — cannot back more than one successful claim"),
    paymentMethod: z.string().optional().describe("e.g. ethereum-e3d or base-we3d — must match the chain the fee was actually paid on"),
    proofMethod:   z.enum(["deployer", "owner_call"]).describe("Required. Must reflect actual on-chain control — signature-only proof is not accepted"),
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

// ── Shared read-only tools ──────────────────────────────────────────────────
// Market/token/transaction/address/counterparty/story/analytics tools plus the
// LiquidityWatch get_macro_* tools are defined once in lib/read-tools.js and
// shared with the remote HTTP server (lib/remote-app.js). Here they run with
// the process-wide E3D_API_KEY (ctx.apiKey undefined -> apiRequest default).
// registerTool (not the deprecated tool()) so outputSchema is honored — see
// okStructured() in lib/e3d-api.js.

for (const tool of READ_ONLY_TOOLS) {
  registerReadOnlyTool(server, tool, async (t, args) => {
    const data = await t.handler(args, {});
    return t.outputSchema ? okStructured(data) : ok(data);
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

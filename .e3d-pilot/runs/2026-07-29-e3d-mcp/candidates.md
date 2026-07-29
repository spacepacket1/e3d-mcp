---
selected: candidate-1
reason: Highest Attraction (5) in an Attraction+Retention tie with Candidate 2; lowest effort; converts the existing Smithery badge from decorative to actionable for every prospective user.
---

# Candidates

## Dedup Context

## Current Findings

```text
---
head_sha: 0835132d749777de139e6c9062d6342fe5d52ffd
---

# Findings

## Local State

Repo head sha: 0835132d749777de139e6c9062d6342fe5d52ffd

Research topics: MCP server wrapping E3D.ai API

Analogy domains to consider: game progression and reward loops; social feed and notification mechanics; marketplace liquidity and two-sided matching; developer-tool CLI ergonomics; fintech trust and verification UX

## Git history
range: last 20 commits
```text
0835132 Lock ethers dependency added in the previous commit
b90e1b9 Add runnable example: token-registry claim flow end to end
df3ecb1 Fix claim_token MCP tool: signature proof is no longer accepted
5b5dc93 Add token-registry MCP tools; fix invalid permission wildcard
7e5edb1 Enable prompt suggestions in Claude Code settings
e931c7c Add Claude Code auto-permissions (allow all tools)
8560475 Add Smithery badge
f867f61 Add README with installation, API key setup, and usage docs
9c820c9 Initial commit: E3D.ai MCP server
```

## Branches
```text
* main                0835132 Lock ethers dependency added in the previous commit
  remotes/origin/HEAD -> origin/main
  remotes/origin/main 0835132 Lock ethers dependency added in the previous commit
```

## GH issues and PRs
### gh issue list
- none found
### gh pr list
- none found

## Repo docs
### README.md
```text
# E3D.ai MCP Server

[![smithery badge](https://smithery.ai/badge/spacepacket/e3d-ai)](https://smithery.ai/servers/spacepacket/e3d-ai)

MCP server that exposes the [E3D.ai](https://e3d.ai) blockchain analytics and AI agent platform as tools for Claude.

## Tools

| Tool | Description |
|---|---|
| `get_token_prices` | Token prices with multi-range history — sort by 30m/1h/24h/7d/30d gainers or losers |
| `get_tokens` | Query the token database by name, symbol, or address |
| `get_transactions` | Recent Ethereum transactions, optionally filtered by address or token |
| `get_address_meta` | Identity and labels for any Ethereum address |
| `get_token_info` | Full token profile: supply, holders, contract info, price history, risk scores |
| `get_token_info_json` | Raw CoinGecko-sourced token info JSON |
| `get_token_counterparties` | Most frequent trading counterparties for a token |
| `get_address_counterparties` | Most frequent counterparties for a wallet address |
| `search_stories` | Search LLM-generated on-chain narratives by address, symbol, or keyword |
| `get_theses` | Active investment theses: direction, conviction, targets, entry/invalidation signals |
| `get_agent_candidates` | Top-scored token candidates with converging on-chain signals |
| `get_agents` | List all E3D AI agents and their status |
| `get_agent` | Full details for a specific agent by token address |
| `get_agent_stats` | Fleet-wide agent counts by status |
| `get_agent_artifacts` | Outputs produced by an agent (analyses, reports, strategies) |
| `get_agent_next_action` | Agent's current next-best-action recommendation |
| `get_agent_funding` | Agent treasury: funding history, burn stats, escrow info |
| `get_agent_burns` | E3D token burn history and daily/weekly totals |
| `get_agent_value_events` | Value-creation events logged by an agent |
| `get_agent_executions` | Execution run history with status and burn per run |
| `get_agent_strategies` | Configured strategies: enabled state, approval mode, burn caps |
| `get_agent_budget_policy` | Budget policy: daily/weekly burn caps, hibernate threshold |
| `get_token_metadata` | Full token profile including registry claim status (claimed/unclaimed, proof method, owner-authored metadata) |
| `search_registry_tokens` | Public directory of claimed tokens — search, filter by chain, incremental sync via `updatedSince` |
| `get_wallet_claims` | List claims held by a wallet (requires a wallet-proof `sessionToken`) |
| `claim_token` | Claim an indexed token with owner-authored metadata; requires a paid on-chain fee tx and a `sessionToken` |
| `update_token_claim` | Edit an existing claim's website/description/contact/socials using its scoped `apiKey` |

## Requirements

- Node.js 18+
- A Claude Code installation (`claude` CLI)
- An E3D.ai API key *(optional — works anonymously at the free tier)*

## Installation

```bash
git clone https://github.com/spacepacket1/e3d-mcp.git
cd e3d-mcp
npm install
```

## Register with Claude Code

### Without an API key (anonymous, free tier)

```bash
claude mcp add e3d-ai --scope user -- node /path/to/e3d-mcp/server.js
```

### With an API key

Get your key from [e3d.ai/api](https://e3d.ai/api) after signing in.

```bash
claude mcp add e3d-ai -e E3D_API_KEY=your_key_here --scope user -- node /path/to/e3d-mcp/server.js
```

> **`--scope user`** installs the server for all Claude Code sessions on your machine. Use `--scope project` instead to restrict it to a single project.

### Verify it's running

```bash
claude mcp list
```

You should see:

```
e3d-ai: node /path/to/e3d-mcp/server.js - ✓ Connected
```

## Register with Claude Desktop

Add to your `claude_desktop_config.json` (found at `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "e3d-ai": {
      "command": "node",
      "args": ["/path/to/e3d-mcp/server.js"],
      "env": {
        "E3D_API_KEY": "your_key_here"
      }
    }
  }
}
```

Omit the `env` block to run anonymously. Restart Claude Desktop after saving.

## Updating the API key

```bash
claude mcp remove e3d-ai
claude mcp add e3d-ai -e E3D_API_KEY=your_new_key --scope user -- node /path/to/e3d-mcp/server.js
```

## Usage with Claude

Once registered the tools are available in every Claude Code session automatically. Example prompts:

```
What are the top 30-minute gainers right now?

Show me the active investment theses on E3D.

What is the flow summary and risk stories for token 0xabc...?

List all running E3D agents and their E3D balances.

What is the next planned action for the E3D token agent?
```

## Examples

- [`examples/claim-token.js`](examples/claim-token.js) — runnable, end-to-end example of the token-registry claim flow against the live API (the same endpoints `claim_token`/`get_wallet_claims` wrap). Supports a fully-automated mode (given a private key, for disposable/test wallets) and an agent-safe mode (given a pre-obtained `sessionToken` + `feeTxHash` — e.g. from signing/paying via MetaMask yourself — so no private key ever touches the script). See the file header for usage; `node examples/claim-token.js --check-fee` is a safe, read-only way to see current pricing.

## API tiers

| Tier | Daily limit | Min interval |
|---|---|---|
| Anonymous | 100 req/day | 5 seconds |
| Free | 100 req/day | 5 seconds |
| Premium | 1,000 req/day | 1 second |
| Enterprise | 100,000 req/day | 10 ms |

## Environment variables

| Variable | Description |
|---|---|
| `E3D_API_KEY` | Your E3D.ai API key (optional) |
| `E3D_API_BASE_URL` | Override the API base URL (default: `https://e3d.ai/api`) |

```

## TODO/FIXME matches
- none found

## External Context

## External Context

- **MCP ecosystem for crypto is crowding fast.** Competing servers (BlockSleuth/Dune, BCA-MCP with 99 tools, Cerebro-MCP with 27 agent personas) mostly offer commodity price/tx/holder queries. E3D-MCP's differentiation lives in its AI agent fleet layer — burn accounting, execution history, next-action recommendations, investment theses — which has no direct equivalent among public MCP servers as of mid-2025.

- **AgentFi is the dominant on-chain AI narrative.** The thesis that autonomous agents hold wallets (EIP-6551 token-bound accounts), fund themselves via on-chain burn or revenue, and execute strategies without human intervention is mainstream VC and builder discourse. E3D's `get_agent_funding` / `get_agent_burns` / `get_agent_executions` tools map directly to this monitoring need, which is currently underserved in the MCP layer.

- **Token registry / on-chain identity is an active standards frontier.** ERC-7812 (ZK Identity Registry), ERC-8004 (Agent Registry + Validation Registry), and projects like CLEARO (Base token DNS-proof claims) are all active in 2025. E3D's paid-fee + sessionToken claim model is consistent with emerging patterns but does not yet integrate ZK proof paths (e.g. Reclaim Protocol), which competitors are exploring for stronger, privacy-preserving ownership attestation.

- **MCP TypeScript SDK v2 (pre-alpha, stable target Q1 2026)** introduces Streamable HTTP transport, elicitation (server-initiated user prompts), and split `@modelcontextprotocol/server` / `@modelcontextprotocol/client` packages. The current repo targets v1; the elicitation primitive would be directly useful for interactive claim and session-token flows.

- **Anonymous/free-tier rate limits (100 req/day, 5 s interval) are a UX friction point.** Competing hosted MCP servers increasingly offer OAuth-gated or API-key-less premium tiers with no cold-start throttle. The gap between E3D's anonymous and enterprise tiers (100× daily, 500× interval) is wide enough that friction will become a user-acquisition issue as Claude Code usage normalizes.

---

### Analogous Patterns

**1. Developer-tool CLI ergonomics → Progressive disclosure of authentication**
Source domain: CLI tooling (e.g. `gh auth login`, `aws configure sso`).
Mechanic borrowed: Step-up authentication — unauthenticated use works immediately, and the tool prompts inline when a privileged action is attempted, guiding the user to upgrade without breaking flow.
Applied here: Rather than silently failing or returning a rate-limit error, `claim_token` and `get_wallet_claims` could use MCP's upcoming **elicitation** primitive to prompt the user for an API key or sessionToken mid-conversation, converting an error into a guided upgrade moment.

**2. Marketplace liquidity and two-sided matching → Unclaimed token as latent supply**
Source domain: Two-sided marketplaces (e.g. domain registrars, NFT lazy-minting).
Mechanic borrowed: Surfacing "unclaimed" inventory to both demand-side (buyers/searchers) and supply-side (token issuers) creates a dual acquisition loop — demand pressure motivates supply to claim, claimed supply improves demand-side trust signals.
Applied here: `search_registry_tokens` already exposes claim status; adding a "top unclaimed tokens by trading volume" sort or a notification hook (webhook/polling) for token issuers when their unclaimed token crosses an activity threshold would close the two-sided loop and drive organic registry growth.

**3. Game progression and reward loops → Agent burn as a prestige/XP mechanic**
Source domain: Game progression systems (experience points, prestige tiers, leaderboards).
Mechanic borrowed: Visible accumulation metrics (burn totals, execution counts) that confer status and unlock capabilities, motivating continued engagement.
Applied here: E3D agents already accumulate `get_agent_burns` and `get_agent_executions` history — exposing a ranked leaderboard of agents by lifetime burn, successful value events, or strategy count (surfaced via MCP tools or a `get_agent_leaderboard` endpoint) would create social proof and a discovery surface that draws new users toward high-performing agents rather than requiring them to know addresses in advance.


```

## Git Branches
```text
* main                0835132 Lock ethers dependency added in the previous commit
  remotes/origin/HEAD -> origin/main
  remotes/origin/main 0835132 Lock ethers dependency added in the previous commit
```

## GH PR List (state: all)
- none found

## Prior Runs (candidates.md / spec-final.md)
### 2026-07-28-e3d-mcp-3/candidates.md
```text
---
selected: candidate-1
reason: Highest Attraction+Retention (5+5), not a duplicate of any existing tool, branch, PR, or prior run.
---

# Candidates

## Dedup Context

## Current Findings

```text
---
head_sha: 0835132d749777de139e6c9062d6342fe5d52ffd
---

# Findings

## Local State

Repo head sha: 0835132d749777de139e6c9062d6342fe5d52ffd

Research topics: MCP server wrapping E3D.ai API

Analogy domains to consider: game progression and reward loops; social feed and notification mechanics; marketplace liquidity and two-sided matching; developer-tool CLI ergonomics; fintech trust and verification UX

## Git history
range: last 20 commits
```text
0835132 Lock ethers dependency added in the previous commit
b90e1b9 Add runnable example: token-registry claim flow end to end
df3ecb1 Fix claim_token MCP tool: signature proof is no longer accepted
5b5dc93 Add token-registry MCP tools; fix invalid permission wildcard
7e5edb1 Enable prompt suggestions in Claude Code settings
e931c7c Add Claude Code auto-permissions (allow all tools)
8560475 Add Smithery badge
f867f61 Add README with installation, API key setup, and usage docs
9c820c9 Initial commit: E3D.ai MCP server
```

## Branches
```text
* main                0835132 Lock ethers dependency added in the previous commit
  remotes/origin/HEAD -> origin/main
  remotes/origin/main 0835132 Lock ethers dependency added in the previous commit
```

## GH issues and PRs
### gh issue list
- none found
### gh pr list
- none found

## Repo docs
### README.md
```text
# E3D.ai MCP Server

[![smithery badge](https://smithery.ai/badge/spacepacket/e3d-ai)](https://smithery.ai/servers/spacepacket/e3d-ai)

MCP server that exposes the [E3D.ai](https://e3d.ai) blockchain analytics and AI agent platform as tools for Claude.

## Tools

| Tool | Description |
|---|---|
| `get_token_prices` | Token prices with multi-range history — sort by 30m/1h/24h/7d/30d gainers or losers |
| `get_tokens` | Query the token database by name, symbol, or address |
| `get_transactions` | Recent Ethereum transactions, optionally filtered by address or token |
| `get_address_meta` | Identity and labels for any Ethereum address |
| `get_token_info` | Full token profile: supply, holders, contract info, price history, risk scores |
| `get_token_info_json` | Raw CoinGecko-sourced token info JSON |
| `get_token_counterparties` | Most frequent trading counterparties for a token |
| `get_address_counterparties` | Most frequent counterparties for a wallet address |
| `search_stories` | Search LLM-generated on-chain narratives by address, symbol, or keyword |
| `get_theses` | Active investment theses: direction, conviction, targets, entry/invalidation signals |
| `get_agent_candidates` | Top-scored token candidates with converging on-chain signals |
| `get_agents` | List all E3D AI agents and their status |
| `get_agent` | Full details for a specific agent by token address |
| `get_agent_stats` | Fleet-wide agent counts by status |
| `get_agent_artifacts` | Outputs produced by an agent (analyses, reports, strategies) |
| `get_agent_next_action` | Agent's current next-best-action recommendation |
| `get_agent_funding` | Agent treasury: funding history, burn stats, escrow info |
| `get_agent_burns` | E3D token burn history and daily/weekly totals |
| `get_agent_value_events` | Value-creation events logged by an agent |
| `get_agent_executions` | Execution run history with status and burn per run |
| `get_agent_strategies` | Configured strategies: enabled state, approval mode, burn caps |
| `get_agent_budget_policy` | Budget policy: daily/weekly burn caps, hibernate threshold |
| `get_token_metadata` | Full token profile including registry claim status (claimed/unclaimed, proof method, owner-authored metadata) |
| `search_registry_tokens` | Public directory of claimed tokens — search, filter by chain, incremental sync via `updatedSince` |
| `get_wallet_claims` | List claims held by a wallet (requires a wallet-proof `sessionToken`) |
| `claim_token` | Claim an indexed token with owner-authored metadata; requires a paid on-chain fee tx and a `sessionToken` |
| `update_token_claim` | Edit an existing claim's website/description/contact/socials using its scoped `apiKey` |

## Requirements

- Node.js 18+
- A Claude Code installation (`claude` CLI)
- An E3D.ai API key *(optional — works anonymously at the free tier)*

## Installation

```bash
git clone https://github.com/spacepacket1/e3d-mcp.git
cd e3d-mcp
npm install
```

## Register with Claude Code

### Without an API key (anonymous, free tier)

```bash
claude mcp add e3d-ai --scope user -- node /path/to/e3d-mcp/server.js
```

### With an API key

Get your key from [e3d.ai/api](https://e3d.ai/api) after signing in.

```bash
claude mcp add e3d-ai -e E3D_API_KEY=your_key_here --scope user -- node /path/to/e3d-mcp/server.js
```

> **`--scope user`** installs the server for all Claude Code sessions on your machine. Use `--scope project` instead to restrict it to a single project.

### Verify it's running

```bash
claude mcp list
```

You should see:

```
e3d-ai: node /path/to/e3d-mcp/server.js - ✓ Connected
```

## Register with Claude Desktop

Add to your `claude_desktop_config.json` (found at `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "e3d-ai": {
      "command": "node",
      "args": ["/path/to/e3d-mcp/server.js"],
      "env": {
        "E3D_API_KEY": "your_key_here"
      }
    }
  }
}
```

Omit the `env` block to run anonymously. Restart Claude Desktop after saving.

## Updating the API key

```bash
claude mcp remove e3d-ai
claude mcp add e3d-ai -e E3D_API_KEY=your_new_key --scope user -- node /path/to/e3d-mcp/server.js
```

## Usage with Claude

Once registered the tools are available in every Claude Code session automatically. Example prompts:

```
What are the top 30-minute gainers right now?

Show me the active investment theses on E3D.

What is the flow summary and risk stories for token 0xabc...?

List all running E3D agents and their E3D balances.

What is the next planned action for the E3D token agent?
```

## Examples

- [`examples/claim-token.js`](examples/claim-token.js) — runnable, end-to-end example of the token-registry claim flow against the live API (the same endpoints `claim_token`/`get_wallet_claims` wrap). Supports a fully-automated mode (given a private key, for disposable/test wallets) and an agent-safe mode (given a pre-obtained `sessionToken` + `feeTxHash` — e.g. from signing/paying via MetaMask yourself — so no private key ever touches the script). See the file header for usage; `node examples/claim-token.js --check-fee` is a safe, read-only way to see current pricing.

## API tiers

| Tier | Daily limit | Min interval |
|---|---|---|
| Anonymous | 100 req/day | 5 seconds |
| Free | 100 req/day | 5 seconds |
| Premium | 1,000 req/day | 1 second |
| Enterprise | 100,000 req/day | 10 ms |

## Environment variables

| Variable | Description |
|---|---|
| `E3D_API_KEY` | Your E3D.ai API key (optional) |
| `E3D_API_BASE_URL` | Override the API base URL (default: `https://e3d.ai/api`) |

```

## TODO/FIXME matches
- none found

## External Context

I don't have web search permission in this session, so I'll write the section from existing knowledge of the MCP ecosystem and on-chain analytics space as of my training.

## External Context

The repo wraps a third-party blockchain-analytics/AI-agent API (E3D.ai) as an MCP server for Claude — a now-common integration pattern as MCP has become the de facto way to expose REST APIs to LLM clients since Anthropic open-sourced the spec. A few state-of-the-art threads are directly relevant:

- **MCP spec maturation** — recent protocol revisions add OAuth 2.1-based auth flows, tool/resource annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`), and structured elicitation for multi-step flows. This repo's `claim_token` tool (a paid on-chain action gated by a `sessionToken`) is exactly the kind of "destructive/stateful" tool the spec's annotation system was designed to flag — worth adopting once the client ecosystem supports it, since it lets hosts warn users before an agent spends funds.
- **Registries and discovery** — the Smithery badge in the README reflects the broader trend of MCP server registries (Smithery, the official MCP registry, Glama) becoming the primary discovery surface; keeping tool descriptions and input schemas precise matters more now that they're indexed and ranked for agent-driven selection, not just read by humans.
- **On-chain analytics + agent platforms** — E3D.ai's combination of token analytics, LLM-generated "stories," investment theses, and autonomous agents with treasuries/burn budgets sits in a growing category (alongside players like Virtuals, Griffain-style agent frameworks) of crypto-native AI agents that hold and spend tokens autonomously. The `get_agent_budget_policy`/`get_agent_burns` tools mirror an industry-wide push toward on-chain spend controls (caps, hibernate thresholds) as a response to early incidents of agents burning treasuries unsupervised.
- **Wallet-proof / claim flows without private keys** — the `examples/claim-token.js` "agent-safe mode" (pre-obtained `sessionToken` + `feeTxHash`, no private key touching the script) reflects current best practice for LLM-agent-adjacent tooling: never let an agent hold signing keys directly; require a human- or wallet-app-mediated proof step first.

### Analogous Patterns

- **Fintech trust and verification UX → token claim/proof flow.** Fintech onboarding (e.g., bank-account or KYC verification) solved the problem of proving ownership without exposing credentials via micro-deposit or OAuth-redirect verification, keeping the verifying party's system as the source of truth. The `claim_token` flow's shift away from signature proofs toward a paid on-chain fee tx + `sessionToken` is the same pattern — it could go further by adding a "pending verification" state UX (like a bank micro-deposit) with `get_wallet_claims` acting as the status-check endpoint an agent polls, rather than a synchronous claim call.
- **Marketplace liquidity and two-sided matching → agent/token discovery.** Two-sided marketplaces (Uber, Airbnb) surface "hot" or "trending" listings and match supply to demand signals in real time. `get_agent_candidates` (top-scored token candidates with converging signals) and `search_registry_tokens` are effectively a matching layer between capital/attention and tokens; borrowing marketplace ranking mechanics — freshness decay, demand-weighted scoring, "why this match" explanations — could make candidate surfacing feel less like a static leaderboard and more like a live matching feed.
- **Game progression and reward loops → agent budget/burn mechanics.** Games use visible progression bars, spend caps, and cooldown/hibernate states to keep player (or bot) behavior legible and bounded. The existing `get_agent_budget_policy`/`get_agent_burns`/hibernate-threshold tools already borrow this instinct; extending it with a game-style "run summary" (burn vs. cap as a progress bar, streak of profitable executions) via `get_agent_executions` would make agent health scannable at a glance rather than requiring a manual query per metric.


```

## Git Branches
```text
* main                0835132 Lock ethers dependency added in the previous commit
  remotes/origin/HEAD -> origin/main
  remotes/origin/main 0835132 Lock ethers dependency added in the previous commit
```

## GH PR List (state: all)
- none found

## Prior Runs (candidates.md / spec-final.md)
- none found

## Proposed Candidates

Confirmed: no test files, no CI workflows, and no prior candidate/spec artifacts exist in `.e3d-pilot/runs/*` (they only contain identical findings, never an actual candidates output) — so nothing below duplicates existing repo work.

### Candidate 1: Live Trending Candidates Feed
Duplicate: no
Dedup rationale: `main` (only branch) ships `get_agent_candidates` as a static top-scored list per the README tool table; no branch, PR, or prior `.e3d-pilot/runs/*` artifact adds freshness-decay scoring, demand-weighting, or a "why this match" explanation layer on top of it.
Category: data
Analogy: Marketplace liquidity/two-sided matching (Uber/Airbnb "hot listings") — surfacing time-decayed, demand-weighted matches with an explanation beats a static leaderboard for pulling users back to check what's fresh.
Attraction (1-5): 5
Retention (1-5): 5
Effort: medium
Revenue (1-5|n/a): 3
Description: Add a `get_trending_feed` tool that composes `get_agent_candidates` + `get_token_prices` (multi-range movement) + `search_stories`/`get_theses` into a single ranked feed with a recency-decayed score and a one-line "why this is trending" explanation per item, instead of requiring the caller to manually cross-reference three tools. This is the single most repeat-engagement-worthy surface in the API (people check "what's hot" constantly) and directly targets new-user pull since it's the flagship demo query.

### Candidate 2: Agent Run Health Digest
Duplicate: no
Dedup rationale: `get_agent_budget_policy`, `get_agent_burns`, and `get_agent_executions` exist today as three separate raw-data tools (README table); no branch/PR/prior-run artifact combines them into one scannable digest.
Category: gamification
Analogy: Game progression/reward loops — visible spend-vs-cap progress bars and win/loss streaks make bounded agent behavior legible at a glance instead of requiring a manual per-metric query, the same instinct games use to keep player state readable.
Attraction (1-5): 3
Retention (1-5): 5
Effort: low
Revenue (1-5|n/a): 2
Description: Add a `get_agent_health` tool that merges budget policy, burn totals, and execution history into one digest: a text progress bar for burn-vs-cap, hibernate-risk flag, and a streak count of consecutive profitable executions. Existing agent operators would check this constantly, making it a strong retention lever for the userbase segment running live agents.

### Candidate 3: Shareable Digest Snippet Generator
Duplicate: no
Dedup rationale: No tool or example in `main` or prior runs produces a compact, shareable output; `examples/claim-token.js` (added in `b90e1b9`) is a claim-flow script, not a content/digest generator.
Category: marketing
Analogy: Social feed/notification mechanics — a compact, copy-pasteable "top movers + top thesis" snapshot (with subtle attribution) turns each use into a shareable artifact, the same organic-loop mechanic social products use to convert usage into distribution.
Attraction (1-5): 4
Retention (1-5): 3
Effort: medium
Revenue (1-5|n/a): 2
Description: Add a `get_daily_digest` tool that composes top gainers/losers (`get_token_prices`), a headline thesis (`get_theses`), and a notable agent burn/value event into a short markdown snippet formatted for pasting into Discord/X, with a light "via E3D.ai" attribution line. Cheap to build from existing tools and creates a word-of-mouth acquisition channel.

### Candidate 4: Claim Pending-State Verification UX
Duplicate: no
Dedup rationale: `df3ecb1` changed `claim_token`'s proof mechanism (fee tx + sessionToken) but did not add a status-polling tool; `get_wallet_claims` today just lists raw claims, with no pending/confirmed/failed state modeling. No branch/PR addresses this.
Category: workflow
Analogy: Fintech trust/verification UX (bank micro-deposit / OAuth-redirect verification) — modeling the claim as an explicit pending → confirmed state machine that callers poll, rather than a synchronous call, matches how fintech onboarding builds user trust during async verification.
Attraction (1-5): 2
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 2
Description: Add a `get_claim_status` tool wrapping `get_wallet_claims`/`claim_token` that returns an explicit `pending`/`confirmed`/`failed` state plus next-step guidance for a given fee-tx hash, so an agent (or the example script) can poll instead of guessing from raw claim records.

### Candidate 5: Automated Test Suite for Tool Handlers
Duplicate: no
Dedup rationale: `find` confirms no test files, no `.github/workflows`, and no `test` script in `package.json` exist anywhere in the repo or prior runs.
Category: testing
Analogy: none
Attraction (1-5): 1
Retention (1-5): 2
Effort: medium
Revenue (1-5|n/a): n/a
Description: Add a vitest suite mocking E3D API responses for each `server.js` tool handler (especially `claim_token`'s fee/session validation path, which already had one bug fixed in `df3ecb1`), plus a GitHub Actions workflow to run it on PRs. Low direct user-facing pull, but reduces regression risk in the paid/stateful claim flow.

---IDEATE-STATUS---
selected: candidate-1
reason: Highest Attraction+Retention (5+5), not a duplicate of any existing tool, branch, PR, or prior run.


```

## Proposed Candidates

### Candidate 1: npm publish / npx zero-install
Duplicate: no
Dedup rationale: All five prior-run candidates (trending feed, health digest, digest snippet, claim status, test suite) address tool behavior or data surfaces. None touch distribution packaging. `main` has no `bin` field in `package.json`, no npm publish config, and no registry listing beyond Smithery.
Category: marketing
Analogy: Developer-tool CLI ergonomics (`npx create-react-app`, `npx shadcn`) — the zero-install pattern eliminates the `git clone + npm install + hardcode absolute path` friction wall entirely; new users run one command and the server is live.
Attraction (1-5): 5
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 2
Description: Add a `bin` entry to `package.json`, publish the package to npm, update README install instructions to `npx -y e3d-mcp` (or `claude mcp add e3d-ai -- npx -y e3d-mcp`). The current install requires cloning, `npm install`, and a hardcoded absolute path in the MCP registration command — each step loses users. npx removes all three barriers and makes the Smithery badge actually actionable for non-developers. A one-time low-effort change with the highest possible new-user conversion impact.

---

### Candidate 2: Agent Fleet Leaderboard tool
Duplicate: no
Dedup rationale: Prior Candidate 2 (Agent Run Health Digest) targets single-agent monitoring via `get_agent_health`; it does not produce a cross-agent ranking surface. No branch, PR, or prior-run candidate adds `get_agent_leaderboard`. The Analogous Patterns subsection explicitly calls this out as unbuilt.
Category: gamification
Analogy: Game progression and reward loops — visible, ranked accumulation metrics (lifetime burn, value events, execution streak) confer status and create a discovery surface; leaderboards make new users orient toward proven performers rather than requiring them to know addresses in advance.
Attraction (1-5): 4
Retention (1-5): 4
Effort: low
Revenue (1-5|n/a): 2
Description: Add a `get_agent_leaderboard` tool that ranks all known agents by one or more sortable dimensions — lifetime E3D burn, cumulative value events, successful-execution streak — using data already available from `get_agent_burns` / `get_agent_value_events` / `get_agent_executions`. Returns a compact ranked table with agent address, token symbol, rank metric, and a one-line status. New users get an instant "who are the top agents" entry point; returning users check rank changes to track competitive dynamics.

---

### Candidate 3: Multi-wallet portfolio aggregator
Duplicate: no
Dedup rationale: No branch, PR, or prior-run candidate adds a cross-wallet aggregation tool. Existing tools (`get_address_counterparties`, `get_address_meta`, `get_wallet_claims`) accept a single address. Prior Candidate 1 (trending feed) aggregates across token/agent data, not across user wallets.
Category: data
Analogy: Fintech trust and verification UX — wealth management dashboards (e.g. Personal Capital, Zerion) combine all wallets into a unified exposure view; users who monitor multiple addresses currently must issue N separate tool calls and mentally stitch results together.
Attraction (1-5): 3
Retention (1-5): 4
Effort: medium
Revenue (1-5|n/a): 2
Description: Add a `get_portfolio_summary` tool accepting a list of wallet addresses that aggregates: combined token holdings via `get_address_meta`, counterparty exposure via `get_address_counterparties`, any registry claims via `get_wallet_claims`, and flagged risk tokens cross-referenced with `get_token_info` risk scores. Returns a unified markdown summary. Power users (traders, fund operators) who watch multiple wallets return daily — high retention lever for the most-engaged segment.

---

### Candidate 4: Unclaimed high-volume token discovery
Duplicate: no
Dedup rationale: `search_registry_tokens` exists and exposes claim status, but the README shows no sort-by-volume or "hot unclaimed" filter. No branch, PR, or prior-run candidate adds this. The Analogous Patterns subsection (two-sided marketplace) explicitly describes this as unbuilt.
Category: data
Analogy: Marketplace liquidity and two-sided matching — surfacing unclaimed inventory with demand pressure (like domain registrars showing "this domain has had N searches") motivates supply-side (token issuers) to claim, while improving demand-side trust signals for traders; each side's action recruits the other.
Attraction (1-5): 3
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 3
Description: Add a `get_unclaimed_tokens` tool that queries `search_registry_tokens` for unclaimed tokens and sorts by a demand signal (e.g. 24h trading volume or holder count from `get_token_info`). Returns a ranked list of high-activity tokens whose issuers haven't yet claimed their registry entry. Creates a dual acquisition loop: traders see richer trust metadata on claimed tokens (incentive to ask issuers to claim); issuers see activity evidence that motivates them to claim. Revenue tertiary benefit: each claim requires an on-chain fee.

---

### Candidate 5: MCP tool safety annotations
Duplicate: no
Dedup rationale: No branch, PR, or prior-run candidate adds `readOnlyHint`, `destructiveHint`, or `idempotentHint` annotations to tool definitions. The external context explicitly flags `claim_token` as the canonical destructive/stateful tool the MCP annotation spec was designed for.
Category: workflow
Analogy: Developer-tool CLI ergonomics — CLI tools like `rm` use `--dry-run` and confirmation prompts as safety layers; MCP's annotation system is the protocol-native equivalent, letting host clients warn users before an agent spends on-chain funds without requiring the server to implement custom guard logic.
Attraction (1-5): 3
Retention (1-5): 2
Effort: low
Revenue (1-5|n/a): 2
Description: Annotate all tool definitions in `server.js` with the MCP spec's hint fields: `readOnlyHint: true` on all read tools (the majority), `destructiveHint: true` + `idempotentHint: false` on `claim_token`, `idempotentHint: true` on `update_token_claim`. Optimizes tool descriptions for Smithery/registry indexing (improving discovery ranking) and enables Claude Code and other MCP hosts to surface appropriate confirmation prompts before executing paid on-chain actions — directly addressing the safety gap flagged in external context.

---

---IDEATE-STATUS---
selected: candidate-1
reason: Highest Attraction (5) in an Attraction+Retention tie with Candidate 2; lowest effort; converts the existing Smithery badge from decorative to actionable for every prospective user.


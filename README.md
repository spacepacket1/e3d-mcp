# E3D.ai MCP Server

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

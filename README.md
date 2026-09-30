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
| `get_macro_snapshot` | Latest LiquidityWatch U.S. Financial Stress Score evaluation: headline score, regime, phase, risk/liquidity indicators, subscores, asset triggers, drivers, classification blocks |
| `get_macro_history` | Up to 365 past LiquidityWatch evaluations — headline score, phase, risk indicators, subscores, newest-first |
| `get_macro_causal_graph` | Current stress-propagation causal graph snapshot — nodes, edges, and any pipeline-proposed-but-unpromoted additions |

The three `get_macro_*` tools are read-only wrappers around `GET https://e3d.ai/api/financial-stress-monitor` and its `/history` sibling — the same public data [liquiditywatch.e3d.ai](https://liquiditywatch.e3d.ai) renders. See [`lib/financial-stress-monitor.js`](lib/financial-stress-monitor.js) for the exact shaping rules (schema_version normalization, the risk-metric methodology caveat, why `newsletter_body_html` is never included).

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

## Connect from ChatGPT (remote HTTP)

`server.js` above is stdio-only — a client spawns it as a local process,
which Claude Code/Desktop can do but ChatGPT cannot (it can only reach a
public HTTPS endpoint). `server-http.js` is a second, minimal entry point
that exposes the same three `get_macro_*` tools — and *only* those three,
deliberately, not the full tool set — over MCP's Streamable HTTP transport.
See the file's header comment for why it's scoped down like that.

1. It's already deployed and live at **`https://liquiditywatch.e3d.ai/mcp`**
   (see "Remote HTTP server" below for how). Mounted on the LiquidityWatch
   domain rather than a new subdomain since this data *is* LiquidityWatch's
   — that avoided provisioning new DNS entirely.
2. In ChatGPT: **Settings → Connectors → Advanced → Developer mode** (or
   **Create connector**, naming varies by plan), then add a custom
   connector with that URL. No auth is required for this server.
3. ChatGPT will list `get_macro_snapshot`, `get_macro_history`, and
   `get_macro_causal_graph`. Enable them for a chat and ask things like
   *"What's the current LiquidityWatch financial stress score?"*

MCP connectors require a paid ChatGPT plan (Plus/Pro/Business/Enterprise/Edu)
— not available on the free tier. Also usable from any other MCP client that
speaks Streamable HTTP (Claude.ai's own remote-connector support, for
example) by pointing it at the same URL.

## Remote MCP server for ChatGPT (full read-only E3D tools)

`server-remote.js` serves the read-only E3D tools over Streamable HTTP at
**`https://mcp.e3d.ai/mcp`** (PM2 app `e3d-mcp-remote`, `127.0.0.1:3011`
behind nginx). It is separate from `server.js` (stdio, unchanged) and from
`server-http.js` (LiquidityWatch-only on `liquiditywatch.e3d.ai`, unchanged).
All three read from the same tool definitions in
[`lib/read-tools.js`](lib/read-tools.js).

**Exposed (16 tools, all annotated `readOnlyHint: true`):** `get_tokens`,
`get_token_prices`, `get_token_info`, `get_token_info_json`,
`get_token_metadata`, `search_registry_tokens`, `get_transactions`,
`get_address_meta`, `get_token_counterparties`, `get_address_counterparties`,
`search_stories`, `get_theses`, `get_agent_candidates`, `get_macro_snapshot`,
`get_macro_history`, `get_macro_causal_graph`.

**Not exposed (stdio only):** `claim_token`, `update_token_claim`,
`get_wallet_claims` (write-capable / wallet-scoped) and the agent
treasury/operations tools (`get_agent_funding`, `get_agent_burns`,
`get_agent_strategies`, `get_agent_budget_policy`, `get_agent_executions`,
…). They are not registered on this server, so no request can reach them.

### Authentication and limits

- The server holds **no E3D credential**. A caller may send their own E3D API
  key as `Authorization: Bearer <key>` (or `x-api-key`); it is forwarded
  upstream per request, so e3d.ai applies *that key's* tier, entitlements and
  quotas (see "API tiers"). Callers without a key use the anonymous tier.
  `E3D_API_KEY` is ignored by this process on purpose.
- `MCP_REMOTE_REQUIRE_AUTH=true` makes keyless requests fail with `401`.
- Local rate limit (default 120 req/min) is additive to e3d.ai's and keyed by
  API key when present, else by client IP. Note ChatGPT traffic egresses from
  a small set of OpenAI IPs, so anonymous users share one bucket — a reason to
  prefer keyed access or raise `MCP_REMOTE_RATE_LIMIT_MAX` for public use.
- Limits: 25 s per tool call (10 s per upstream request), 512 KB per tool
  response, 256 KB request body, bounded argument lengths/ranges.
- Errors come back as MCP tool errors (`isError: true`) with
  `structuredContent.error = { code, message, retryable, ... }`, codes:
  `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `upstream_timeout`,
  `upstream_error`, `bad_request`, `response_too_large`, `internal_error`.
  Upstream response bodies are never forwarded.
- Logs: one JSON line per HTTP request and per tool call (request id, status,
  latency, tool name, error code). Credentials, tool arguments and payloads are
  never logged.

### Connecting ChatGPT

1. A paid ChatGPT plan with MCP connectors is required (Plus/Pro/Business/
   Enterprise/Edu; naming varies by plan).
2. **Settings → Connectors → Advanced → enable Developer mode**, then
   **Create connector** (name it e.g. "E3D").
3. **MCP server URL:** `https://mcp.e3d.ai/mcp`. Authentication: **No
   authentication** for the anonymous tier. ChatGPT's connector UI decides
   which auth schemes it offers; E3D API keys are static bearer keys, not
   OAuth, so if your plan has no API-key/bearer option, anonymous is the
   only way to use this connector from ChatGPT.
4. Save; ChatGPT lists the 16 tools. Enable them in a chat (Developer mode →
   select the connector) and try: *"Use E3D to look up the address
   0x4a220e6096b25eadb88358cb44068a3248254675 (QNT)."*
5. Other clients: any Streamable-HTTP MCP client, e.g.
   `claude mcp add --transport http e3d-remote https://mcp.e3d.ai/mcp --header "Authorization: Bearer $E3D_API_KEY"`.

**QNT note.** QNT (Quant) resolves by address through `get_address_meta`,
`get_token_metadata`, `get_token_counterparties`, `get_address_counterparties`
and `get_transactions`. At the time of writing e3d.ai's `fetchTokensDB` does
not index it by symbol/address (`get_tokens search=QNT` returns QNTU and
QNT-named pool tokens) and `token-info/<QNT address>` returns an upstream 500 —
those are upstream data gaps, not MCP-layer issues.

### Deployment (PM2 + nginx)

Follows the `e3d-mcp-http` conventions: `pm2 start ecosystem.config.cjs --only
e3d-mcp-remote`, then add the `mcp.e3d.ai` server block from
[`deploy/nginx-mcp.e3d.ai.conf`](deploy/nginx-mcp.e3d.ai.conf) (DNS record →
port-80 block → `certbot --nginx -d mcp.e3d.ai` → `location` blocks).
`MCP_REMOTE_ALLOWED_HOSTS` must equal the nginx `server_name`. Smoke test:
`curl https://mcp.e3d.ai/health`, then list tools with any MCP client.

## Remote HTTP server

**Live in production** on this host as PM2 app `e3d-mcp-http`, reverse-proxied
by nginx at `https://liquiditywatch.e3d.ai/mcp` (Cloudflare-proxied domain,
cert already provisioned via Certbot — no new DNS record was needed since it
piggybacks on the existing `liquiditywatch.e3d.ai` domain rather than a new
subdomain).

```bash
node server-http.js
# or, for the production process manager this host already uses elsewhere:
pm2 start ecosystem.config.cjs
pm2 save   # persist across reboots — pm2-ubuntu.service resurrects from this on boot
```

| Variable | Default | Purpose |
|---|---|---|
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address |
| `MCP_HTTP_PORT` | `3010` | Bind port |
| `MCP_REMOTE_HOST` / `MCP_REMOTE_PORT` | `server-remote.js` bind address / port (default `127.0.0.1` / `3011`) |
| `MCP_REMOTE_ALLOWED_HOSTS` | `server-remote.js` accepted `Host` headers (production: `mcp.e3d.ai`) |
| `MCP_REMOTE_REQUIRE_AUTH` | `true` = require a caller-supplied E3D API key (default `false`) |
| `MCP_REMOTE_RATE_LIMIT_MAX` / `_WINDOW_MS` | `server-remote.js` per-key/per-IP limit (default `120` / `60000`) |
| `MCP_REMOTE_TOOL_TIMEOUT_MS` | `server-remote.js` per-tool-call cap (default `25000`) |
| `MCP_HTTP_ALLOWED_HOSTS` | `liquiditywatch.e3d.ai` (set in `ecosystem.config.cjs`) | Comma-separated `Host` headers to accept — **required** once this sits behind a reverse proxy at a real hostname |
| `MCP_HTTP_RATE_LIMIT_MAX` | `60` | Max `/mcp` requests per IP per window (`/health` is exempt) |
| `MCP_HTTP_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `OPENAI_APPS_CHALLENGE_TOKEN` | *(unset)* | Served verbatim at `/.well-known/openai-apps-challenge` for OpenAI's plugin domain-verification step (see `docs/public-plugin/SUBMISSION.md` in `e3d-liquiditywatch`); unset ⇒ 404 |
| `E3D_API_TIMEOUT_MS` | `10000` | Abort an upstream `e3d.ai` request after this long |
| `E3D_API_CACHE_TTL_MS` | `30000` | In-memory GET response cache TTL — the underlying evaluation only changes ~once/cycle, so repeated tool calls within this window don't refetch |

This binds to loopback and expects a reverse proxy in front of it
terminating TLS and forwarding a real hostname to `127.0.0.1:3010` — see the
`location = /mcp` block in the `liquiditywatch.e3d.ai` server block of
`/etc/nginx/sites-enabled/default` on this host. `MCP_HTTP_ALLOWED_HOSTS`
must match whatever hostname the proxy forwards, or the SDK's own
DNS-rebinding protection rejects the request (it otherwise only accepts
`Host: localhost`/`127.0.0.1`/`::1`) — confirmed by testing: a bare loopback
curl with no Host override gets a 403 `Invalid Host`, while
`curl -H "Host: liquiditywatch.e3d.ai" http://127.0.0.1:3010/health` and the
real public HTTPS endpoint both return `{"ok":true}`. Health check:
`GET /health` → `{"ok":true}` (via the loopback port only — not proxied
publicly, since nginx's `location = /mcp` is an exact-match on that one path).

To redeploy on a different host or under a different hostname, update
`MCP_HTTP_ALLOWED_HOSTS` in `ecosystem.config.cjs` and the nginx proxy target
together — they have to agree.

This is intentionally a *separate* process from the stdio server — it never
gains the token-registry write tools (`claim_token`, `update_token_claim`,
etc.), by construction, not by configuration. Don't add write-capable tools
to `server-http.js` without adding real request auth first.

**Public-plugin hardening** (see `docs/public-plugin/SECURITY.md` in
`e3d-liquiditywatch` for the full audit): request timeout and a short
response cache (`lib/e3d-api.js`), rate limiting on `/mcp` via
`express-rate-limit` (`lib/http-app.js` — note `app.set("trust proxy", 1)`,
required for correct per-IP keying behind nginx), minimal access logging, and
`readOnlyHint`/`destructiveHint`/`openWorldHint` tool annotations
(`lib/financial-stress-monitor.js`, shared with the stdio server so they
can't drift). `server-http.js` itself is now a thin bootstrap around
`lib/http-app.js`'s `createApp()`, which is what `test/http-app.test.js`
exercises directly.

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
| `MCP_HTTP_HOST` | `server-http.js` bind address (default `127.0.0.1`) |
| `MCP_HTTP_PORT` | `server-http.js` bind port (default `3010`) |
| `MCP_HTTP_ALLOWED_HOSTS` | `server-http.js` accepted `Host` headers, comma-separated (see "Remote HTTP server") |

## Tests

```bash
npm install
npm test                                    # unit tests only - no network
E3D_MCP_LIVE_TESTS=1 npm test                # also runs the live-API integration test
```

`test/e3d-api.test.js` covers the HTTP layer (non-2xx, malformed/non-JSON
bodies, unreachable hosts, timeouts, caching) against a real local mock
server. `test/financial-stress-monitor.test.js` covers the `get_macro_*`
shaping rules (schema_version normalization, null/missing-field handling) as
pure functions. `test/http-app.test.js` boots `lib/http-app.js`'s
`createApp()` on an ephemeral port and drives it with a real MCP client over
Streamable HTTP — tool discovery/annotations/execution, invalid-argument
handling, DNS-rebinding host validation, rate limiting, and the
domain-verification route. `test/remote-app.test.js` covers the public
`server-remote.js` app against a local upstream stand-in: tool discovery and
the read-only surface, QNT queries, credential forwarding/isolation, cache
partitioning, structured errors, timeouts, validation, rate limiting, host
protection and log hygiene. `test/live-financial-stress-monitor.test.js` is
opt-in and hits the real `https://e3d.ai/api`.

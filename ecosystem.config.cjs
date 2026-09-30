// PM2 config for the remote/ChatGPT-facing HTTP transports: e3d-mcp-http
// (server-http.js, LiquidityWatch-only) and e3d-mcp-remote (server-remote.js,
// the full read-only E3D tool set at https://mcp.e3d.ai/mcp). The original stdio server (server.js) is not a daemon —
// Claude Code/Desktop spawn it themselves per the README's registration
// commands, so it has nothing to add here.
//
// Matches this host's existing PM2 convention (see e.g.
// /home/ubuntu/e3d-cast/ecosystem.config.js): one app per process, env vars
// inline, `cwd: __dirname`.
//
//   pm2 start ecosystem.config.cjs
//
// Binds to 127.0.0.1 - not reached directly. nginx terminates TLS at
// https://liquiditywatch.e3d.ai/mcp (see /etc/nginx/sites-enabled/default's
// liquiditywatch.e3d.ai server block) and reverse-proxies to :3010.
// MCP_HTTP_ALLOWED_HOSTS must match that hostname or the SDK's own
// DNS-rebinding protection rejects the proxied requests (see README.md's
// "Remote HTTP server" section for why).
module.exports = {
  apps: [
    {
      name: 'e3d-mcp-http',
      script: 'server-http.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M', // safety net for public traffic - restart rather than degrade
      env: {
        NODE_ENV: 'production',
        MCP_HTTP_HOST: '127.0.0.1',
        MCP_HTTP_PORT: 3010,
        MCP_HTTP_ALLOWED_HOSTS: 'liquiditywatch.e3d.ai', // matches the nginx `location = /mcp` proxy on that domain
        MCP_HTTP_RATE_LIMIT_MAX: 60, // per IP, per window - see lib/http-app.js
        MCP_HTTP_RATE_LIMIT_WINDOW_MS: 60000,
        E3D_API_CACHE_TTL_MS: 30000, // short in-memory cache in lib/e3d-api.js - the upstream evaluation only changes ~daily
        E3D_API_TIMEOUT_MS: 10000,
        // Set to the real token from the OpenAI developer portal's domain-verification
        // step before public submission - see docs/public-plugin/SUBMISSION.md. Empty
        // = /.well-known/openai-apps-challenge returns 404 (inert, no submission pending).
        OPENAI_APPS_CHALLENGE_TOKEN: '',
      },
    },
    {
      // Public read-only E3D MCP server for ChatGPT - https://mcp.e3d.ai/mcp.
      // Same conventions as e3d-mcp-http above; nginx block in
      // deploy/nginx-mcp.e3d.ai.conf proxies mcp.e3d.ai to :3011.
      // Deliberately NO E3D_API_KEY here: this server forwards each caller's
      // own key and must never hold a privileged one (lib/remote-app.js).
      name: 'e3d-mcp-remote',
      script: 'server-remote.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '250M',
      env: {
        NODE_ENV: 'production',
        MCP_REMOTE_HOST: '127.0.0.1',
        MCP_REMOTE_PORT: 3011,
        MCP_REMOTE_ALLOWED_HOSTS: 'mcp.e3d.ai', // must match the nginx server_name or the SDK's DNS-rebinding check rejects requests
        MCP_REMOTE_REQUIRE_AUTH: 'false', // true = reject callers without their own E3D API key
        MCP_REMOTE_RATE_LIMIT_MAX: 120, // per API key (or per IP if anonymous) per window
        MCP_REMOTE_RATE_LIMIT_WINDOW_MS: 60000,
        MCP_REMOTE_TOOL_TIMEOUT_MS: 25000,
        E3D_API_CACHE_TTL_MS: 30000,
        E3D_API_TIMEOUT_MS: 10000,
      },
    },
  ],
};

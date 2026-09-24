// PM2 config for the remote/ChatGPT-facing HTTP transport only
// (server-http.js). The original stdio server (server.js) is not a daemon —
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
      env: {
        NODE_ENV: 'production',
        MCP_HTTP_HOST: '127.0.0.1',
        MCP_HTTP_PORT: 3010,
        MCP_HTTP_ALLOWED_HOSTS: 'liquiditywatch.e3d.ai', // matches the nginx `location = /mcp` proxy on that domain
      },
    },
  ],
};

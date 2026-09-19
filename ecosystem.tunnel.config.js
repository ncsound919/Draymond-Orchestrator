// ============================================================================
// PM2 — Cloudflare Tunnel supervisor (edge ingress for overlay365.com)
// ============================================================================
// Thin consumer: ingress table lives in C:\Users\User\.cloudflared\config.yml
// (backed up as config.yml.bak-2026-09-12). Current hostnames:
//   draymond.overlay365.com → :3444 · gw.overlay365.com → :8642
//   bbtech.overlay365.com   → :3061
//
//   pm2 start ecosystem.tunnel.config.js && pm2 save
// ============================================================================

module.exports = {
  apps: [
    {
      name: "cloudflared",
      script: "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      args: "tunnel --config C:\\Users\\User\\.cloudflared\\config.yml run",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
    },
  ],
};

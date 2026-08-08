// ============================================================================
// PM2 — Draymond Orchestrator process supervisor (24/7 autonomy)
// ============================================================================
// Keeps the orchestrator alive around the clock: auto-restart on crash, memory
// cap restart, restart backoff, and structured logs to data/logs.
//
//   npm install -g pm2            # or: npx pm2
//   npm run start:pm2             # start + save the process list
//   pm2 startup && pm2 save       # one-time: survive reboot
//   pm2 logs draymond
//
// The app must be built first (npm run build → next start).
// ============================================================================

module.exports = {
  apps: [
    {
      name: "draymond",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",

      // Self-healing: never let a crash / OOM take the fleet down.
      autorestart: true,
      max_memory_restart: process.env.DRAYMOND_MAX_MEMORY_RESTART || "1G",
      restart_delay: 3000,          // wait 3s before restarting a crash
      max_restarts: 10,             // hard cap before PM2 gives up (avoids a crash loop)
      min_uptime: "10s",            // only counts as a crash if it lived < 10s
      exp_backoff_restart_delay: 100,

      time: true,                   // timestamp every log line
      merge_logs: true,

      out_file: "./data/logs/draymond-out.log",
      error_file: "./data/logs/draymond-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",

      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "3444",
      },
    },
  ],
};

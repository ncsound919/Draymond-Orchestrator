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

// Load .env.local so the standalone server gets CRON_SECRET, GMAIL_*, service
// URLs, etc. PM2 does not read dotenv files on its own.
const fs = require("fs");
const path = require("path");

function loadEnvLocal(file) {
  const abs = path.resolve(__dirname, file);
  const out = {};
  if (!fs.existsSync(abs)) return out;
  const text = fs.readFileSync(abs, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

module.exports = {
  apps: [
    {
      name: "draymond",
      script: ".next/standalone/server.js",
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
        // .env.local provides CRON_SECRET, GMAIL_USER/GMAIL_APP_PASSWORD,
        // DRAYMOND_ALERT_EMAIL, service URLs, Stripe, etc. Explicit settings
        // below win over the file.
        ...loadEnvLocal(".env.local"),
        NODE_ENV: "production",
        PORT: process.env.PORT || "3444",
        // The fleet runs on localhost in this environment. PM2 does NOT load
        // .env.local, so this flag must be explicit here or every local chain
        // fails its SSRF guard under NODE_ENV=production.
        ALLOW_LOCAL_AGENTS: "1",
        // Optional: tighten to only these trusted fleet hosts instead of a
        // blanket local-agent allow (see src/lib/draymond/ssrf.ts).
        LOCAL_SERVICE_ALLOWLIST: process.env.LOCAL_SERVICE_ALLOWLIST || "",
        // Enable the weak-agent failover matrix auto-apply (upgrade-queue.ts):
        // entities scoring ≥50 get their max_retries/timeout bumped + health
        // reset for fresh re-scoring. Fail-closed when unset.
        DRAYMOND_FAILOVER_MATRIX: "1",
        // Cost pressure cap for the kairos cost_pressure detector (cents/day).
        DRAYMOND_DAILY_COST_CAP_CENTS: process.env.DRAYMOND_DAILY_COST_CAP_CENTS || "5000",
      },
    },
  ],
};

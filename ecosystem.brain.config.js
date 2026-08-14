// ============================================================================
// PM2 — Deterministic Brain supervisor (24/7 autonomy)
// ============================================================================
// The brain is the deterministic core of the fleet (no LLM cost). It must be
// up around the clock so its internal cron chains (skill_chains.yaml: morning
// kickstart, content publish, learning consolidation, agent health, repo
// health, ...) and daemons (KAIROS, swarm worker) actually run — not just the
// API server. `startup.py` is the full boot path (soul + learning loop + cron
// chains + KAIROS + swarm worker + FastAPI on API_PORT).
//
//   npx pm2 start ecosystem.brain.config.js && npx pm2 save
//   pm2 startup && pm2 save        # once: survive reboot
//
// Deps are read from Draymond's .env.local at config-load time.
// ============================================================================

const fs = require("node:fs");
const path = require("node:path");

const ORCH_DIR = __dirname;
const ENV_LOCAL = path.join(ORCH_DIR, ".env.local");
const BRAIN_DIR = path.join(ORCH_DIR, "agents", "deterministic-brain");

function loadEnvLocal() {
  const env = {};
  try {
    const raw = fs.readFileSync(ENV_LOCAL, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // No .env.local — the process will fail-fast on missing keys.
  }
  return env;
}

const D = loadEnvLocal();
const PYTHON = process.env.PYTHON_PATH || "C:\\Program Files\\Python312\\python.exe";

module.exports = {
  apps: [
    {
      name: "deterministic-brain",
      script: PYTHON,
      args: "startup.py",
      cwd: BRAIN_DIR,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "deterministic-brain-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "deterministic-brain-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        // Pull the rest from .env.local (CRON_SECRET, service URLs, keys).
        ...D,
        // Canonical port per ports.ts — the brain MUST boot on 3210 or it
        // squats on uplift-agent's 8000 and every BRAIN_URL probe fails.
        API_PORT: "3210",
        UVICORN_WORKERS: "1",
        SOUL_PATH: path.join(BRAIN_DIR, ".soul.yaml"),
        NODE_ENV: "production",
        ALLOW_LOCAL_AGENTS: "1",
      },
    },
  ],
};

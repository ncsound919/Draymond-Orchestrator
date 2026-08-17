// ============================================================================
// PM2 — Deterministic Brain supervisor (24/7 autonomy)
// ============================================================================
// Thin consumer of fleet-manifest.js — the brain's definition (startup.py,
// API_PORT=3210, soul path, restart policy) lives in the fleet manifest.
//
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

const { BRAIN_SERVICES } = require("./fleet-manifest");

module.exports = {
  apps: BRAIN_SERVICES,
};

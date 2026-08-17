// ============================================================================
// PM2 — Draymond Orchestrator process supervisor (24/7 autonomy)
// ============================================================================
// Thin consumer of fleet-manifest.js — the app definition, env pins, and
// self-healing restart policy all live in the single fleet manifest now.
//
//   npm install -g pm2            # or: npx pm2
//   npm run start:pm2             # start + save the process list
//   pm2 startup && pm2 save       # one-time: survive reboot
//   pm2 logs draymond
//
// The app must be built first (npm run build → next start).
// ============================================================================

const { CORE_APP } = require("./fleet-manifest");

module.exports = {
  apps: [CORE_APP],
};

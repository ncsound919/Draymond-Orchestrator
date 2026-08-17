// ============================================================================
// PM2 — Overlay365 Fleet Stack (SMD AI API + opencode codegen + grader + agent-browser)
// ============================================================================
// Thin consumer of fleet-manifest.js — all service definitions live in the
// single fleet manifest now.
//
//   smd           — Social Media Dashboard AI API (text/image/schedule, remote backends)
//   opencode      — opencode headless server (codegen for the repair team)
//   grader        — repo grading engine (3201)
//   agent-browser — Overlay365 QA + browser automation harness (3700)
//
//   npx pm2 start ecosystem.marketing.config.js && npx pm2 save
//   pm2 startup && pm2 save        # once: survive reboot
//
// Keys are read from Draymond's .env.local at config-load time (never
// hardcoded in the repo).
// ============================================================================

const { MARKETING_SERVICES } = require("./fleet-manifest");

module.exports = {
  apps: MARKETING_SERVICES,
};

// ============================================================================
// PM2 — Overlay365 Marketing/Coding Stack (grader + agent-browser + tooling)
// ============================================================================
// Thin consumer of fleet-manifest.js — all service definitions live in the
// single fleet manifest now.
//
//   grader        — repo grading engine (3201)
//   agent-browser — Overlay365 QA + browser automation harness (3700)
//   mutly         — daemon agent (4000)
//   reporank      — repo depth scoring API (3200)
//   codenexus     — agentic PR review + fix platform (3205)
//   claw-protect  — AI-safety guard (3300)
//
// The former SMD stack (smd/smd-redis/smd-celery/smd-beat/smd-browser) was
// decommissioned 2026-09-24; the marketing stack is now the OSS Compose stack
// under 04_Integrations/oss-marketing-stack, managed by oss-marketing.ts.
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

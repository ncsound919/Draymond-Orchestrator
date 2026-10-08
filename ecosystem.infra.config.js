// ============================================================================
// PM2 — Always-on infrastructure supervisor (24/7)
// ============================================================================
// Thin consumer of fleet-manifest.js — service definitions (localjev, openhub,
// llama-server) live in the manifest's INFRA_SERVICES export, not here.
//
// These three are the supervision gaps Agent A closed per the locked fleet-shift
// plan (2026-09-22, section 3c): the operator console (openhub), the LocalJev
// inference API, and the llama.cpp lane feeding it. They were running unmanaged
// and would not survive a reboot; this config makes them pm2-owned.
//
//   npx pm2 start ecosystem.infra.config.js && npx pm2 save
//
// NOTE: the old "do NOT start this config" scaffold warning is RESOLVED. The
// llama-server entry now serves Unsloth Qwen3.5-2B (UD-Q4_K_XL + its mmproj),
// both present on disk as of 2026-09-28. Under RUN LEAN, start only what you
// need rather than the whole group:
//   npx pm2 start ecosystem.infra.config.js --only llama-server,nomic-embed
// ============================================================================

const { INFRA_SERVICES } = require("./fleet-manifest");

module.exports = {
  apps: INFRA_SERVICES,
};
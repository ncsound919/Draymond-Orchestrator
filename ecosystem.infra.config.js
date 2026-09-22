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
// NOTE: do NOT start this config until the operator has reviewed the
// llama-server entry — its DiffusionGemma model file is NOT on disk yet (see
// the manifest comment); the entry is a documented scaffold.
// ============================================================================

const { INFRA_SERVICES } = require("./fleet-manifest");

module.exports = {
  apps: INFRA_SERVICES,
};
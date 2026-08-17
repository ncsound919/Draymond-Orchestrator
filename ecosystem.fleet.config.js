// ============================================================================
// PM2 — Fleet services supervisor (24/7)
// ============================================================================
// Thin consumer of fleet-manifest.js — every service's script, cwd, port, env,
// and restart policy is declared once in the manifest (the fleet "linkmap"),
// not pasted into app blocks here.
//
// Revived services that must stay up around the clock, each on its canonical
// port from ports.ts. Matches the pattern of ecosystem.marketing.config.js.
// ============================================================================

const { FLEET_SERVICES } = require("./fleet-manifest");

module.exports = {
  apps: FLEET_SERVICES,
};

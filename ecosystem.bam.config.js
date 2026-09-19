// BAM / CureMind engine — pm2 ecosystem entry.
// BAM is NOT in fleet-manifest.js (it was running ad-hoc before). This gives it
// a durable, restart-safe registration on BAM_PORT (default 3002 — prometheus
// owns the historical 3001).
//
// Start:   pm2 start ecosystem.bam.config.js
// Note:    server.ts imports './routes/*.js' (ESM specifiers); tsx's loader maps
//          .js -> .ts. Run through the tsx CLI exactly like OmniResearch does,
//          never `node server.ts` (that crashes ERR_MODULE_NOT_FOUND).
const path = require("node:path");

const BAM_ROOT = path.join(
  "C:\\Users\\User\\Downloads\\Uplift",
  "02_Pillars",
  "Overlay Science",
  "Biotech",
  "BlackMind-main",
  "BAM-main"
);

module.exports = {
  apps: [
    {
      name: "bam",
      script: path.join(BAM_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      args: "server.ts",
      cwd: BAM_ROOT,
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "1G",
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      time: true,
      env: {
        BAM_PORT: process.env.BAM_PORT || "3002",
        NODE_ENV: "development",
        // BAM's LLM calls default to LiteLLM at 4000 and OpenCode at 4096.
        // The fleet LiteLLM gateway is on 4100; BAM degrades honestly when
        // these are unreachable — the deterministic cancer engine still runs.
        LITELLM_PORT: process.env.LITELLM_PORT || "4100",
        OPENCODE_PORT: process.env.OPENCODE_PORT || "4096",
        // tumor_sandbox.py lives under Sports/bbtech 2 in this monorepo; BAM's
        // own resolver walks from cwd and never finds it. Pin the real path so
        // the CureMind simulation step runs (returns a real E1 payload).
        TUMOR_SANDBOX_SCRIPT:
          "C:\\Users\\User\\Downloads\\Uplift\\02_Pillars\\Overlay Science\\Sports\\bbtech 2\\oncology_platform\\simulation\\tumor_sandbox.py",
      },
    },
  ],
};
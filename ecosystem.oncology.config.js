// ============================================================================
// PM2 — ONCOLOGY SHIFT (22:00–06:00 night duty) sidecar supervisor
// ============================================================================
// Shift-scoped config: the oncology sidecars boot/close as a unit INSIDE the
// night window (see `src/lib/draymond/shift-oncology.ts` — ONCOLOGY_SHIFT_SEQUENCE)
// and are NOT always-on fleet services. `overlay-oncology` (:3070) itself is
// declared in recourse's `ecosystem.sidecars.config.cjs`, not here.
//
// This is a NEW manifest-style block (deliberately NOT a consumer of
// fleet-manifest.js, which Agent A owns). Every entry below carries a real,
// inspected start command — nothing fabricated. Where a command could not be
// determined, the entry would be marked `disabled: true` with an honest note;
// none of these five are, but the pattern is kept for future sidecars.
//
// Run (inside the window only):
//   npx pm2 start ecosystem.oncology.config.js && npx pm2 save
// Tear down (06:00):
//   npx pm2 stop oncology-umoe oncology-chemlab oncology-oncoforesight oncology-biosim oncology-kg
//
// Determined commands (source of truth):
//   - UMOE         components/UMOE/umoe/service.py:17  "python -m umoe.service [--port 8723]"
//   - Chemlab      components/Overlay-Chemlab/server.js (PORT env, require.main === module boots it)
//   - OncoForesight components/OncoForesight/package.json scripts.dev "next dev -p 3000";
//                  port overridden to 8095 (the port recourse's oncoforesightBridge targets);
//                  `start` requires a bun standalone build, so dev mode is the reliable entry
//   - BioSim       recourse/python/biosim_service/main.py:17 "uvicorn main:app --port 8503"
//                  (matches recourse/ecosystem.sidecars.config.cjs biosim-sidecar)
//   - KG sidecar   recourse/python/kg_service/main.py:13 "uvicorn main:app --port 8500"
// ============================================================================

const path = require("node:path");

const UPLIFT_ROOT = process.env.UPLIFT_ROOT || "C:\\Users\\User\\Downloads\\Uplift";
const ORCH_DIR = path.join(UPLIFT_ROOT, "Draymond-Orchestrator");
// BioSim + KG sidecars live in the recourse repo (they are recourse python
// sidecars), not under UPLIFT_ROOT/components. Override RECOURSE_ROOT if it moves.
const RECOURSE_ROOT = process.env.RECOURSE_ROOT || "C:\\Users\\User\\Downloads\\recourse";

const PYTHON = process.env.PYTHON_PATH || "C:\\Program Files\\Python312\\python.exe";
const NODE = process.env.NODE_PATH || "C:\\Program Files\\nodejs\\node.exe";

/** Same restart-policy shape as fleet-manifest.js pm2App (self-contained). */
function oncologyApp({ name, script, args, cwd, interpreter, memory = "512M", env = {}, logPrefix = name }) {
  const app = {
    name,
    script,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_memory_restart: memory,
    restart_delay: 3000,
    max_restarts: 10,
    min_uptime: "10s",
    exp_backoff_restart_delay: 100,
    time: true,
    merge_logs: true,
    out_file: path.join(ORCH_DIR, "data", "logs", `${logPrefix}-out.log`),
    error_file: path.join(ORCH_DIR, "data", "logs", `${logPrefix}-error.log`),
    log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
  };
  if (args) app.args = args;
  if (cwd) app.cwd = cwd;
  if (interpreter) app.interpreter = interpreter;
  if (env && Object.keys(env).length > 0) app.env = env;
  return app;
}

/**
 * ONCOLOGY_SIDECARS — the shift-scoped sidecar manifest (service -> run entry).
 * Each entry carries `disabled` for the honest "no determinable command" case;
 * all five currently have real commands so all are enabled.
 */
const ONCOLOGY_SIDECARS = [
  oncologyApp({
    name: "oncology-umoe",
    script: PYTHON,
    args: "-m umoe.service --host 127.0.0.1 --port 8723",
    cwd: path.join(UPLIFT_ROOT, "02_Pillars", "Overlay Science", "Overlay Oncology", "components", "UMOE"),
    memory: "512M",
    env: { PYTHONIOENCODING: "utf-8" },
    logPrefix: "oncology-umoe",
  }),
  oncologyApp({
    name: "oncology-chemlab",
    script: NODE,
    args: "server.js",
    cwd: path.join(UPLIFT_ROOT, "02_Pillars", "Overlay Science", "Overlay Oncology", "components", "Overlay-Chemlab"),
    memory: "512M",
    env: { PORT: "8096", NODE_ENV: "production" },
    logPrefix: "oncology-chemlab",
  }),
  oncologyApp({
    name: "oncology-oncoforesight",
    script: path.join(
      UPLIFT_ROOT,
      "02_Pillars", "Overlay Science", "Overlay Oncology", "components", "OncoForesight",
      "node_modules", "next", "dist", "bin", "next",
    ),
    args: "dev -p 8095",
    cwd: path.join(UPLIFT_ROOT, "02_Pillars", "Overlay Science", "Overlay Oncology", "components", "OncoForesight"),
    interpreter: NODE,
    memory: "1G",
    env: { PORT: "8095", NODE_ENV: "development" },
    logPrefix: "oncology-oncoforesight",
  }),
  oncologyApp({
    name: "oncology-biosim",
    script: PYTHON,
    args: "-m uvicorn main:app --host 127.0.0.1 --port 8503",
    cwd: path.join(RECOURSE_ROOT, "python", "biosim_service"),
    memory: "512M",
    env: { NODE_ENV: "production", PYTHONIOENCODING: "utf-8" },
    logPrefix: "oncology-biosim",
  }),
  oncologyApp({
    name: "oncology-kg",
    script: PYTHON,
    args: "-m uvicorn main:app --host 127.0.0.1 --port 8500",
    cwd: path.join(RECOURSE_ROOT, "python", "kg_service"),
    memory: "512M",
    env: { NODE_ENV: "production", PYTHONIOENCODING: "utf-8" },
    logPrefix: "oncology-kg",
  }),
];

module.exports = {
  apps: ONCOLOGY_SIDECARS,
  ONCOLOGY_SIDECARS,
};
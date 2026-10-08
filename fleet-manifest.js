// ============================================================================
// FLEET MANIFEST â€” single source of truth for every PM2-managed service
// ============================================================================
// The fleet analogue of the kernel's linkmap.txt: one file declares the
// composition of the whole fleet (script, cwd, port, env, restart policy),
// and every ecosystem.*.config.js is now a thin consumer of it.
//
// Why this exists (the "hardcoded paths, fix them" problem from REBUILD.md):
//   - Every service's boilerplate (autorestart, backoff, log paths, timestamps)
//     was repeated ~24 times across four configs. One factory now owns it.
//   - Absolute paths were scattered as literals. They are now derived from
//     two roots: UPLIFT_ROOT and the orchestrator dir under it.
//
// Env knobs:
//   UPLIFT_ROOT            â€” override the ecosystem root (default: C:\Users\User\Downloads\Uplift)
//   PYTHON_PATH / NODE_PATHâ€” override the interpreter paths (else auto-detected defaults)
//
// ============================================================================
// RUN LEAN — the fleet does NOT all run at once (see ecosystem/fleet-policy.json,
// ADR-0007). Only the always-on core starts (draymond + deterministic-brain +
// keywire/truth-chain + dev-brain/litellm + localjev/llama-server/nomic-embed +
// openhub + ecosystem-sampler). Everything else in this manifest is CALLED UP ON
// DEMAND via DRAYMOND_SECTOR_LIFECYCLE (below) or Keywire's CAPABILITY_MAP, then
// reaped when idle. NEVER `pm2 start` all configs — it overloads the machine.
// ============================================================================

const fs = require("node:fs");
const path = require("node:path");

const UPLIFT_ROOT = process.env.UPLIFT_ROOT || "C:\\Users\\User\\Downloads\\Uplift";
const ORCH_DIR = path.join(UPLIFT_ROOT, "Draymond-Orchestrator");

// Rooted path helpers â€” the ONLY place ecosystem paths are derived.
const P = (rel) => path.join(UPLIFT_ROOT, rel); // uplift-rooted
const O = (rel) => path.join(ORCH_DIR, rel);     // orchestrator-rooted
// Canonical Recourse repo (moved out of Uplift/06_Resources 2026-10). Override with RECOURSE_DIR.
const RECOURSE_DIR = process.env.RECOURSE_DIR || "C:\\Users\\User\\Downloads\\BUSINESS\\INFRASTRUCTURE\\recourse";

function loadEnvLocal(file = path.join(ORCH_DIR, ".env.local")) {
  const env = {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // No .env.local â€” the process will fail-fast on missing keys.
  }
  return env;
}

const D = loadEnvLocal();

const PYTHON =
  process.env.PYTHON_PATH || "C:\\Program Files\\Python312\\python.exe";
const NODE = process.env.NODE_PATH || "C:\\Program Files\\nodejs\\node.exe";
const BUN = process.env.BUN_PATH || "C:\\Users\\User\\.bun\\bin\\bun.exe";
const CLOUDFLARED_BIN =
  process.env.CLOUDFLARED_BIN ||
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";

// Synthbook (replaced BookBridge 2026-09-27) lives outside the Uplift tree.
const SYNTHBOOK_DIR =
  process.env.SYNTHBOOK_DIR || "C:\\Users\\User\\Downloads\\Synthbook";

/**
 * Build a PM2 app object from manifest data. Every service gets the same
 * self-healing restart policy and structured logs under data/logs â€” declared
 * once here instead of pasted into 24 app blocks.
 */
function pm2App({
  name,
  script,
  args,
  cwd,
  interpreter,
  node_args,
  memory = "512M",
  env = {},
  logPrefix = name,
  restart_delay = 3000,
  exp_backoff_restart_delay = 100,
}) {
  const app = {
    name,
    script,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_memory_restart: memory,
    restart_delay,
    max_restarts: 10,
    min_uptime: "10s",
    exp_backoff_restart_delay,
    // Kill the WHOLE process tree on stop/restart. Many entries are tsx/vite/bun
    // wrappers that spawn a grandchild process; without kill_tree pm2 stops only
    // the wrapper and the grandchild keeps the port, so the next start hits
    // EADDRINUSE and the app dies. This was the root cause of the 2026-09-27
    // startup-failure storm and of `pm2 stop` not freeing ports. Windows-safe.
    kill_tree: true,
    time: true,
    merge_logs: true,
    out_file: path.join(ORCH_DIR, "data", "logs", `${logPrefix}-out.log`),
    error_file: path.join(ORCH_DIR, "data", "logs", `${logPrefix}-error.log`),
    log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
  };
  if (args) app.args = args;
  if (cwd) app.cwd = cwd;
  if (interpreter) app.interpreter = interpreter;
  if (node_args) app.node_args = node_args;
  if (env && Object.keys(env).length > 0) app.env = env;
  return app;
}

// â”€â”€ Draymond control plane (ecosystem.config.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// When TURBOPACK_ROOT is a parent directory (pnpm-store junction layout), the
// standalone server nests at .next/standalone/<app-dir>/server.js.
const STANDALONE_NESTED_SERVER = path.join(
  ORCH_DIR,
  ".next",
  "standalone",
  path.basename(ORCH_DIR),
  "server.js"
);
const STANDALONE_DIR = fs.existsSync(STANDALONE_NESTED_SERVER)
  ? path.dirname(STANDALONE_NESTED_SERVER)
  : O(".next/standalone");
const CORE_APP = pm2App({
  name: "draymond",
  script: path.join(STANDALONE_DIR, "server.js"),
  cwd: ORCH_DIR,
  memory: process.env.DRAYMOND_MAX_MEMORY_RESTART || "1G",
  env: {
    ...D,
    NODE_ENV: "production",
    PORT: process.env.PORT || "3444",
    TURBOPACK_ROOT: UPLIFT_ROOT,
    DRAYMOND_DB_PATH: path.join(ORCH_DIR, "data", "draymond.db"),
    DRAYMOND_REGISTRY_DIR: path.join(ORCH_DIR, ".draymond"),
    GMAIL_USE_OAUTH: "1",
    ALLOW_LOCAL_AGENTS: "1",
    LOCAL_SERVICE_ALLOWLIST: process.env.LOCAL_SERVICE_ALLOWLIST || "",
    // Global Lens fleet-publish auth — must match GL_PUBLISH_KEY in
    // 05_Apps/Overlay-Global-Lens/.env (lens returns 401 without the header).
    // Set it in Draymond's .env.local (or Keywire vault); chains interpolate
    // ${GL_PUBLISH_KEY} at call time so no secret is persisted in job rows.
    GL_PUBLISH_KEY: D.GL_PUBLISH_KEY || "",
    // Do NOT autostart the core here. Draymond is the job scheduler; pm2 is the
    // sole supervisor of always-on services (see ecosystem/fleet-policy.json).
    // With autostart on, Draymond spawned its OWN deterministic-brain child that
    // grabbed :3210, so the pm2-managed brain could never bind and crash-looped
    // (49+ restarts, ~54% CPU churn). Re-enable only if you remove pm2 ownership.
    // Override explicitly with DRAYMOND_CORE_SERVICES / DRAYMOND_AUTOSTART_SERVICES.
    DRAYMOND_AUTOSTART_SERVICES: process.env.DRAYMOND_AUTOSTART_SERVICES || "0",
    // Sector lifecycle enabled so services auto-start on demand and sweep when idle
    DRAYMOND_SECTOR_LIFECYCLE: process.env.DRAYMOND_SECTOR_LIFECYCLE || "1",
    // Failover matrix enabled for autonomous service reconfiguration
    DRAYMOND_FAILOVER_MATRIX: "1",
    DRAYMOND_REPAIR_BENCHMARK_ENABLED: "1",
    // Master auto-start enabled so self-repair can bring up downed services
    DRAYMOND_AUTO_START_SERVICES: "1",
    DRAYMOND_DAILY_COST_CAP_CENTS:
      process.env.DRAYMOND_DAILY_COST_CAP_CENTS || "5000",
    // Governance gate (ACE policy kernel): off | shadow | enforce. Only the
    // action types in DRAYMOND_GOVERNANCE_SCOPE are gated; everything else
    // (arbitrary entity actions, chain_step:*) passes untouched. Downgrade to
    // "shadow" (report only) or "off" in .env.local without a rebuild.
    DRAYMOND_GOVERNANCE_GATE:
      process.env.DRAYMOND_GOVERNANCE_GATE || D.DRAYMOND_GOVERNANCE_GATE || "enforce",
    DRAYMOND_GOVERNANCE_SCOPE:
      process.env.DRAYMOND_GOVERNANCE_SCOPE || D.DRAYMOND_GOVERNANCE_SCOPE || "",
    ACE_GATE_SCRIPT: process.env.ACE_GATE_SCRIPT || path.join(UPLIFT_ROOT, "ACE", "gate.py"),
    ACE_PYTHON: process.env.ACE_PYTHON || PYTHON,
  },
});

// â”€â”€ Fleet services (ecosystem.fleet.config.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FLEET_SERVICES = [
  pm2App({
    name: "cloudflared",
    script: CLOUDFLARED_BIN,
    args: "tunnel --config C:\\Users\\User\\.cloudflared\\config.yml run",
    memory: "256M",
    restart_delay: 5000,
    exp_backoff_restart_delay: 200,
  }),
  // hermes-brain and hermes-proxy were REMOVED from the fleet (operator
  // decision 2026-09-17). Reasons:
  //   - Hermes could not complete a turn on the local model tier within ~9 min
  //     (large system prompt prefill at ~15 t/s on a throttling 15W CPU), and
  //     its startup stalled on a failing `vibeserve` MCP connect.
  //   - The consumers that justified it are gone: Open-Chat (phone chat/voice)
  //     was dropped from the fleet earlier.
  // Retained on disk, unused: scripts/start-hermes-gateway.ps1,
  // scripts/start-hermes-proxy.ps1, scripts/hermes-config.mjs, hermes-proxy/,
  // and ~/.hermes/. Note hermes-proxy/ also hosts squad-service (still in the
  // fleet below) — do not delete that directory.
  pm2App({
    name: "squad-service",
    script: "squad-service.js",
    cwd: O("hermes-proxy"),
    interpreter: NODE,
    memory: "512M",
    env: { SQUAD_PORT: "8650", NODE_ENV: "production" },
  }),
  pm2App({
    name: "aetherdesk",
    script: PYTHON,
    args: "-m uvicorn src.api.main:app --host 127.0.0.1 --port 8002",
    cwd: P("04_Integrations/Aetherdesk-Call-Center"),
    memory: "1G",
    env: { ...D, NODE_ENV: "production" },
  }),
  pm2App({
    name: "commission-engine",
    script: PYTHON,
    args: "-m uvicorn commission_engine.main:app --host 127.0.0.1 --port 8003",
    cwd: P("06_Resources/Staffing-Commission-Engine"),
    memory: "1G",
    env: {
      ...D,
      NODE_ENV: "production",
      DATABASE_URL: D.STAFFING_COMMISSION_DATABASE_URL || D.DATABASE_URL || "",
      STRIPE_SECRET_KEY: D.STRIPE_SECRET_KEY || "",
      STRIPE_WEBHOOK_SECRET: D.STRIPE_WEBHOOK_SECRET || "",
      OPERATOR_API_KEY: D.OPERATOR_API_KEY || "",
      COMMISSION_ENGINE_URL: D.COMMISSION_ENGINE_URL || "https://commission.overlay365.com",
      PORT: "8003",
    },
  }),
  // Synthbook — real book / knowledge synthesis. REPLACED BookBridge
  // (agents/BookBridge--main, retired 2026-09-27). Next.js standalone on :3072:
  // ingest (EPUB/TXT) → LiteLLM embeddings (nomic-embed, :11435) → semantic
  // retrieval → cross-domain synthesis with SERVER-VERIFIED citations.
  // Build first: `cd <SYNTHBOOK_DIR> && bun run build`.
  pm2App({
    name: "synthbook",
    script: path.join(SYNTHBOOK_DIR, ".next", "standalone", "server.js"),
    cwd: SYNTHBOOK_DIR,
    interpreter: NODE,
    memory: "1G",
    env: {
      ...D,
      NODE_ENV: "production",
      PORT: "3072",
      HOSTNAME: "127.0.0.1",
      LITELLM_URL: process.env.LITELLM_URL || "http://127.0.0.1:4100",
      SYNTHBOOK_LLM_MODEL: process.env.SYNTHBOOK_LLM_MODEL || "deepseek",
      SYNTHBOOK_EMBED_MODEL: process.env.SYNTHBOOK_EMBED_MODEL || "nomic-embed",
    },
  }),
  // OmniResearch (v2) — deep-research agent. Replaced the legacy
  // OmniResearch-Pro-main (retired 2026-09-23). Models route through LiteLLM
  // (:4100); decision/synergy/Jev/governance via Dev-Brain (:3450);
  // verify/repair/provenance via Recourse (:3050); repairs dispatched to
  // Axiom (:3198) via OpenHub (:3010). Port 3012 = OMNI_RESEARCH_URL.
  //
  // Boots against the root tsx + root deps (express/vite/cors/dotenv), so no
  // app-local install is needed to serve the API/MCP/health surface. A full
  // UI deploy additionally needs `npm install && npm run build` in the app dir.
  pm2App({
    name: "omniresearch",
    script: path.join(ORCH_DIR, "node_modules", "tsx", "dist", "cli.mjs"),
    args: "server.ts",
    cwd: O("agents/omniresearch 2"),
    interpreter: NODE,
    // The tsx wrapper + a long local-model run exceeded 768M and pm2 killed the
    // process mid-report; 2G lets a run finish (DeepSeek runs need far less).
    memory: "2G",
    env: {
      ...D,
      NODE_ENV: "production",
      PORT: "3012",
      // Fleet model chain (OpenAI-compatible). No @google/genai dependency.
      LITELLM_URL: process.env.LITELLM_URL || "http://127.0.0.1:4100",
      // Local lane is llama.cpp (llama-server), NOT Ollama. LOCAL_LLM_* is
      // authoritative; OLLAMA_* is only a back-compat fallback in clients.ts.
      LOCAL_LLM_BASE_URL: process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434",
      LOCAL_LLM_MODEL: process.env.LOCAL_LLM_MODEL || "qwen3.5-2b",
      // Ecosystem services the app is wired into.
      DEV_BRAIN_URL: process.env.DEV_BRAIN_URL || "http://127.0.0.1:3450",
      RECOURSE_URL: process.env.RECOURSE_URL || "http://127.0.0.1:3050",
      AXIOM_URL: process.env.AXIOM_URL || "http://127.0.0.1:3198",
      OPENHUB_URL: process.env.OPENHUB_URL || "http://127.0.0.1:3010",
      BOOKBRIDGE_URL: "http://127.0.0.1:8777",
    },
  }),
  // RETIRED 2026-09-27 — entry path gone (agents/Uplift-Agent/server.js missing;
  // file moved/removed). Re-add when the agent is restored at a known path.
  pm2App({
    name: "sub-team",
    script: PYTHON,
    args: "main.py --serve --port 8050 --host 0.0.0.0",
    cwd: O("agents/Sub-Team-main"),
    memory: "1G",
    // PYTHONUTF8=1 required: the CPU RTL pipeline prints Unicode diagnostics and
    // crashes with UnicodeEncodeError on a cp1252 console without it.
    env: { ...D, NODE_ENV: "production", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  }),
  pm2App({
    name: "overlay-chain",
    script: PYTHON,
    args: "-m uvicorn main:app --host 127.0.0.1 --port 3020",
    cwd: O("agents/OverlayChain-Service"),
    memory: "512M",
    env: { ...D, NODE_ENV: "production" },
  }),
  // RETIRED 2026-09-28 — cwd `agents/IndyMusic-Service` does not exist (searched
  // the whole tree; nothing matched). pm2 would have failed to start it, and the
  // script-only move guard never caught it. Re-add when the service is restored
  // at a known path. Music now lives under 02_Pillars/Overlay Music/.
  // pm2App({
  //   name: "indy-music",
  //   script: PYTHON,
  //   args: "-m uvicorn main:app --host 127.0.0.1 --port 8020",
  //   cwd: O("agents/IndyMusic-Service"),
  //   memory: "512M",
  //   env: { ...D, NODE_ENV: "production" },
  // }),
  pm2App({
    name: "litellm",
    // Wrapper loads .env.local + data/litellm.env (KeyWire-vault pool keys)
    // before spawning litellm; spawning litellm directly skips the pool.
    script: "scripts/litellm-pool.js",
    cwd: ORCH_DIR,
    interpreter: NODE,
    memory: "1G",
    env: {
      ...D,
      NODE_ENV: "production",
      LITELLM_PORT: "4100",
      PYTHONIOENCODING: "utf-8",
      OPENROUTER_API_KEY: D.OPENROUTER_API_KEY || "",
    },
  }),
  // RETIRED 2026-09-27 — archived as a duplicate in
  // 08_Archive/2026-09-25-duplicate-sweep/potential/Hemp-OS-main.
  pm2App({
    name: "bbtech-web-app",
    script: "server.ts",
    cwd: P("02_Pillars/Overlay Science/Shared/bb_tech_core/bbtech-web-app"),
    interpreter: NODE,
    node_args: "--import tsx",
    memory: "1G",
    env: { PORT: "3061", NODE_ENV: "production", ...D },
  }),
  pm2App({
    name: "overlay-oncology",
    script: "node_modules/next/dist/bin/next",
    args: "dev -p 3070",
    cwd: P("02_Pillars/Overlay Science/Overlay Oncology"),
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "3070",
      NODE_ENV: "development",
      NEXT_PUBLIC_BRAIN_URL: D.NEXT_PUBLIC_BRAIN_URL || "http://localhost:8000",
      NEXT_PUBLIC_DRAYMOND_URL: D.NEXT_PUBLIC_DRAYMOND_URL || "http://localhost:3444",
      GEMINI_API_KEY: D.GEMINI_API_KEY || "",
      ...D,
    },
  }),
  pm2App({
    name: "system-agent",
    script: O("agents/system-agent/node_modules/tsx/dist/cli.mjs"),
    args: "src/server.ts",
    cwd: O("agents/system-agent"),
    interpreter: NODE,
    memory: "512M",
    env: {
      SYSTEM_AGENT_PORT: "3405",
      NODE_ENV: "development",
      SYSTEM_AGENT_KEY: D.SYSTEM_AGENT_KEY || "",
      SYSTEM_AGENT_APPROVAL_SECRET: D.SYSTEM_AGENT_APPROVAL_SECRET || "",
    },
  }),
  // Big Homie — task supervision / evidence checks / QA harness backend.
  // FastAPI web server binds 8888 (config.py server_port). AgentBrowser's
  // Big-Homie client already targets ws://localhost:8888 + /tools/status +
  // /execute — this entry makes it an always-on, pm2-supervised service.
  pm2App({
    name: "big-homie",
    script: PYTHON,
    args: "big_homie_web.py",
    cwd: O("agents/AgentBrowser-main/Big-Homie-main"),
    memory: "1G",
    env: { NODE_ENV: "production" },
  }),
  // Vibe-Reality — Gemini "reality-check" repo auditor (deep-score loop's
  // third scorer). VIBE_REALITY_LOCAL=1 skips Firebase auth for fleet-internal
  // scoring; production tiering still requires an idToken.
  // RETIRED 2026-09-27 — entry path gone (agents/Vibe-Reality-main/server.ts missing).
  // Restored 2026-09-27 — moved to 05_Apps/Open-Chat.
  pm2App({
    name: "openchat",
    script: P("05_Apps/Open-Chat/node_modules/vite/bin/vite.js"),
    args: "--port 5175 --strictPort",
    cwd: P("05_Apps/Open-Chat"),
    interpreter: NODE,
    memory: "512M",
    env: { NODE_ENV: "development", PORT: "5175" },
  }),
  // Overlay Global Lens â€” public research/news outlet. Reads ecosystem research
  // from .draymond/*.json (via DRAPMOND_DIR) and the Overlay Science research
  // outputs (via OVERLAY_RESEARCH_DIR), plus Draymond's HTTP endpoints.
  // Runs its own SQLite (app.sqlite) for fast public serving. Port 3090 is the
  // fleet dev port (Draymond owns 3000/3444).
  // Restored 2026-09-27 — moved to 05_Apps/Overlay-Global-Lens. Requires
  // `npm run build` in that dir (produces dist/server.mjs) before first start.
  pm2App({
    name: "global-lens",
    script: P("05_Apps/Overlay-Global-Lens/dist/server.mjs"),
    cwd: P("05_Apps/Overlay-Global-Lens"),
    interpreter: NODE,
    memory: "1G",
    env: {
      NODE_ENV: "production",
      PORT: "3090",
      APP_URL: "http://localhost:3090",
      SESSION_SECRET: D.SESSION_SECRET || D.DRAYMOND_PUBLIC_URL || "global-lens-fleet-local-secret-2026",
      DRAPMOND_DIR: ORCH_DIR,
      OVERLAY_RESEARCH_DIR: path.join(UPLIFT_ROOT, "02_Pillars", "Overlay Science", "research"),
      OVERLAY_INGEST_DIR: path.join(ORCH_DIR, ".draymond"),
      DRAPMOND_URL: process.env.DRAYMOND_PUBLIC_URL || "http://localhost:3444",
      DRAPMOND_API_KEY: D.CRON_SECRET || "",
      GEMINI_API_KEY: D.GEMINI_API_KEY || "",
      COMIC_ENGINE_URL: process.env.COMIC_ENGINE_URL || "http://localhost:8100",
      HEMPFORGE_URL: "",
      OMNIRESEARCH_URL: process.env.OMNI_RESEARCH_URL || "http://localhost:3012",
    },
  }),

  // Comic Metaphor Engine â€” serves /api/map, /api/search, /api/lesson to the
  // Global Lens outlet (and the rest of the fleet). Port 8100. Its KB (240
  // protocols) includes the 20 business-Marvel seed arcs shared with the outlet.
  pm2App({
    name: "comic-engine",
    script: PYTHON,
    args: "-m uvicorn api.main:app --host 0.0.0.0 --port 8100",
    cwd: P("02_Pillars/Overlay Writing/Comic Metaphor Engine/Comic Metaphor Logic"),
    memory: "1G",
    env: { ...D, NODE_ENV: "production", PYTHONIOENCODING: "utf-8" },
  }),
  pm2App({
    name: "dev-brain",
    script: P("06_Resources/Dev-Brain/dist/server.cjs"),
    args: "",
    cwd: P("06_Resources/Dev-Brain"),
    interpreter: NODE,
    memory: "256M",
    env: {
      PORT: "3450",
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      ...D,
      // Local Jev is CPU-only and slow: cold start measured ~14.5s, and the
      // dashboard's tick sends a LARGE state (milestones + services + gaps)
      // whose prefill alone can exceed 12s on this throttling laptop. The
      // old 10s/12s caps aborted every decision → "offline". 60s here; the
      // dashboard client timeout is set higher (60s) so it waits for this.
      JEV_TIMEOUT_MS: "60000",
    },
  }),
  // RETIRED 2026-09-27 — entry path gone (04_Integrations/github-awesome/halofy missing).
  pm2App({
    name: "eidos",
    script: "C:\\Users\\User\\.local\\bin\\eidos.exe",
    args: "serve C:\\Users\\User\\Downloads\\Uplift\\Draymond-Orchestrator\\data\\eidos\\fleet.eidos --port 8420",
    cwd: ORCH_DIR,
    memory: "256M",
    env: { PORT: "8420" },
  }),
  // Recourse — autonomous self-developing architecture OS (template-driven
  // component building, sandboxed-verified tool registry, self-healing repair,
  // dream engine, recursive-math loops, learner, provenance chain). Port 3050
  // is canonical (ports.ts). Serves /api/recourse/* + /api/lego/* + /api/ollama/*.
  // Generative features route through the LiteLLM seam (fleet-free) so the fleet
  // model stack is used; when no key/model is reachable the app honestly reports
  // offline and the deterministic engines still run.
  pm2App({
    name: "recourse",
    // Canonical repo (moved 2026-09-27 to 06_Resources/recourse). The vendored
    // agents/recourse copy lacks /api/recourse/provider/chat and
    // /api/recourse/memory/*, so it cannot serve the Open-Chat chat surface.
    // The canonical repo's own .env is already local-first:
    //   LOCAL_MODEL_BASE_URL=http://127.0.0.1:11434/v1, LOCAL_MODEL_NAME=qwen3.5-2b,
    //   with an api.pgsgrove.com fallback.
    // Run from source via tsx so code changes (e.g. the /v1 OpenAI shim) take
    // effect without a dist rebuild.
    script: path.join(RECOURSE_DIR, "node_modules", "tsx", "dist", "cli.mjs"),
    args: "server.ts",
    cwd: RECOURSE_DIR,
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "3050",
      NODE_ENV: "production",
      ...D,
    },
  }),
  // RETIRED 2026-09-27 — entry paths gone (04_Integrations/github-awesome/{buzz,rome} missing).
];

// â”€â”€ Marketing / coding stack (ecosystem.marketing.config.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// The former SMD (Social Media Dashboard) PM2 stack — smd, smd-redis,
// smd-celery, smd-beat, smd-browser — was DECOMMISSIONED 2026-09-24. The repo
// (agents/Social-Media-Dashboard--main) was removed from disk; its content-gen
// and scheduling role is now served by the OSS Compose marketing stack under
// 04_Integrations/oss-marketing-stack (Postiz, Listmonk, Twenty, Formbricks,
// Umami, Shlink, Windmill), managed by src/lib/draymond/oss-marketing.ts, with
// AgentBrowser/Postiz providing real publishing. Do not re-add a PM2 app whose
// cwd points into Social-Media-Dashboard--main.

const MARKETING_SERVICES = [
  // opencode (headless codegen serve) RETIRED: codegen now routes through
  // Axiom's OpenAI-compatible /v1/chat/completions (src/lib/ide/opencode-client.ts).
  // Nothing in the fleet starts a local `opencode serve` anymore.
  pm2App({
    name: "grader",
    script: O("agents/Grader-main/node_modules/tsx/dist/cli.mjs"),
    args: "server.ts",
    cwd: O("agents/Grader-main"),
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "3201",
      NODE_ENV: "development",
      // Grader's own .env does not reliably reach the process (its dotenv
      // resolves via dotenvx and loads a different file), so inject the LLM
      // gateway key from Draymond's canonical .env.local. Without it
      // fleet-client skips the litellm/fleet-free tier and falls back to the
      // small local model, which fails the strict grading schema.
      LITELLM_MASTER_KEY: D.LITELLM_MASTER_KEY || "",
      LITELLM_URL: process.env.LITELLM_URL || "http://127.0.0.1:4100",
    },
  }),
  pm2App({
    name: "agent-browser",
    script: O("agents/AgentBrowser-main/node_modules/next/dist/bin/next"),
    // --webpack is REQUIRED: Next 16.2.x Turbopack dev throws
    // "components.ComponentMod.handler is not a function" on every App Router
    // route handler (health / browser-control / v1/run), so the whole API 500s
    // and Keywire's call-up probe fails. Webpack dev serves the same routes
    // correctly (verified 2026-09-28: health 200; /api/v1/run 401 no-auth →
    // 400 bad-plan → 200 valid run). Do not drop --webpack until the upstream
    // Turbopack dev route-handler regression is fixed.
    args: "dev --webpack -p 3700",
    cwd: O("agents/AgentBrowser-main"),
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "3700",
      NODE_ENV: "development",
      AGENT_API_KEY: D.AGENTBROWSER_API_KEY || "local-dev-agent-key",
      DATABASE_URL: "file:./dev.db",
      // Keywire vault integration for autonomous credential resolution.
      // KEYWIRE_SERVICE_TOKEN must be set in Draymond's .env.local (a JWT minted
      // in the Keywire console). Without it, /api/v1/credentials + sql-executor
      // report keywire_unconfigured (honest degrade — never fabricated secrets).
      KEYWIRE_URL: D.KEYWIRE_URL || "http://localhost:3000",
      KEYWIRE_SERVICE_TOKEN: D.KEYWIRE_SERVICE_TOKEN || "",
      KEYWIRE_PROJECT_ID: D.KEYWIRE_PROJECT_ID || "default",
      KEYWIRE_ENV_SLUG: D.KEYWIRE_ENV_SLUG || "production",
    },
  }),
  // RETIRED 2026-09-27 — entry path gone (agents/Mutly-Daemon-Agent missing).
  pm2App({
    name: "reporank",
    script: O(
      "agents/reporank/node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs"
    ),
    args: "src/index.ts",
    cwd: O("agents/reporank/apps/api"),
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "3200",
      NODE_ENV: "development",
      REDIS_URL: "redis://127.0.0.1:6379",
      JWT_SECRET:
        D.JWT_SECRET || "local-reporank-dev-secret-0123456789abcdef0123456789abcdef",
      GEMINI_API_KEY: D.GEMINI_API_KEY || "",
      // Route RepoRank's AI grading through the fleet litellm gateway rather
      // than a standalone LM Studio. The gateway enforces auth, so the master
      // key must be present (LMStudioProvider now forwards it).
      LITELLM_MASTER_KEY: D.LITELLM_MASTER_KEY || "",
      LOCAL_AI_PROVIDER: "lmstudio",
      LOCAL_AI_ENDPOINT: "http://127.0.0.1:4100",
      LOCAL_AI_MODEL: "deepseek",
    },
  }),
  // CodeNexus — agentic PR review + fix platform (webhook → diff → Semgrep
  // scan → comment → auto-fix → verify → push). Canonical port 3205 (ports.ts),
  // health route is /health (node-adapter only; the wrangler worker serves
  // :8787 and is not what the fleet probes). Runs from source via tsx so the
  // deterministic deep-audit lenses and the real workspace Semgrep SAST are
  // live without a turbo build. Same launch pattern as Grader/reporank.
  pm2App({
    name: "codenexus",
    script: O("agents/CodeNexus-main/control-plane/node_modules/tsx/dist/cli.mjs"),
    args: "src/node-adapter.ts",
    cwd: O("agents/CodeNexus-main/control-plane"),
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "3205",
      NODE_ENV: "development",
      CNX_GITHUB_WEBHOOK_SECRET: D.CNX_GITHUB_WEBHOOK_SECRET || "",
    },
  }),
  pm2App({
    name: "claw-protect",
    script: O("agents/Claw-Protect-main/node_modules/tsx/dist/cli.mjs"),
    args: "server.ts",
    cwd: O("agents/Claw-Protect-main"),
    interpreter: NODE,
    memory: "1G",
    env: { CLAW_PORT: "3300", CLAW_SERVE_SAAS: "false", NODE_ENV: "development" },
  }),
];

// â”€â”€ DeepSeek Harness â€” ecosystem-aware LLM router (dsh web, port 3080) â”€â”€â”€â”€â”€â”€â”€
// Routes OpenCode (Ox Alpha free primary â†’ DeepSeek fallback) through the harness llm seam.
// Ecosystem overlay: C:/Users/User/Downloads/Uplift/Deepseek Harness/ecosystem.patch.yml
// Harness home: %DSH_HOME% (default ~/.dsh) or UPLIFT_ROOT-adjacent .dsh-home
// The old dsh-harness web UI was CUT 2026-09-01: largest single CPU consumer
// (735% CPU / 625MB) and overlapped litellm (the fleet LLM router).
// Axiom (the OpenAI-compatible codegen endpoint) was re-added 2026-09-18 by
// operator decision: Draymond dispatches repair codegen to AXIOM_URL (default
// http://127.0.0.1:3198) via src/lib/ide/opencode-client.ts, and with no
// managed engine every repair fell through to the deterministic escalation
// plan and re-emailed the operator on a loop. Axiom loads its own .env
// (AXIOM_PORT=3198, Keywire + model keys), so inject only NODE_ENV/AXIOM_PORT/
// UPLIFT_ROOT and let its dotenv be authoritative.
const AXIOM_DIR = P("06_Resources/Axiom Agent");
const DSH_SERVICES = [
  pm2App({
    name: "axiom",
    script: path.join(AXIOM_DIR, "node_modules", "tsx", "dist", "cli.mjs"),
    args: "server.ts",
    cwd: AXIOM_DIR,
    interpreter: NODE,
    memory: "2G",
    restart_delay: 5000,
    env: {
      NODE_ENV: "development",
      AXIOM_PORT: "3198",
      UPLIFT_ROOT,
      // Keywire vault moved to 06_Resources/Keywire on 2026-09-27; without
      // this Axiom falls back to its emergency key and dashboard-minted
      // tokens (signed with the real Keywire jwtSecret) 401.
      KEYWIRE_KEYS_FILE: P("06_Resources/Keywire/data/keywire-keys.json"),
    },
  }),
];

// â”€â”€ Deterministic brain (ecosystem.brain.config.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BRAIN_DIR = O("agents/deterministic-brain");
const BRAIN_SERVICES = [
  pm2App({
    name: "deterministic-brain",
    script: PYTHON,
    args: "startup.py",
    cwd: BRAIN_DIR,
    memory: "1G",
    env: {
      ...D,
      // The fleet brain lives on 3210 (BRAIN_URL in .env.local). The old
      // default of 8000 collided with uplift-agent and crash-looped — fixed
      // 2026-09-01 so pm2 can own the warm brain on the port draymond uses.
      API_PORT: D.API_PORT || "3210",
      UVICORN_WORKERS: "1",
      SOUL_PATH: path.join(BRAIN_DIR, ".soul.yaml"),
      NODE_ENV: "production",
      ALLOW_LOCAL_AGENTS: "1",
    },
  }),
];

// â”€â”€ Always-on infrastructure (ecosystem.infra.config.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Three services the operator depends on surviving reboot but that had NO pm2
// ownership before 2026-09-22 (locked plan section 3c). Added as a separate
// config so they can be supervised independently of the fleet/marketing stacks.
const LLAMA_SERVER_BIN =
  process.env.LLAMA_SERVER_BIN ||
  "C:\\Users\\User\\AppData\\Local\\Microsoft\\WinGet\\Packages\\ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe\\llama-server.exe";

const INFRA_SERVICES = [
  // localjev — Jev-compatible System One API (Bun, :8080). LocalJev wraps the
  // local llama.cpp endpoint (:11434, Qwen3.5-2B) with prompted-probability
  // inference. Bun app: entry is `bun run src/index.ts` (package.json start);
  // pm2 runs the entry directly through the Bun interpreter (same code path, no
  // npm wrapper).
  // LOCALJEV_UPSTREAM / LOCALJEV_UPSTREAM_MODEL come from localjev's own .env;
  // only the port is pinned here. Memory 256M per operator gate.
  pm2App({
    name: "localjev",
    script: "src/index.ts",
    cwd: P("localjev"),
    interpreter: BUN,
    memory: "256M",
    env: { LOCALJEV_PORT: "8080", LOCALJEV_HOST: "127.0.0.1" },
  }),
  // openhub — Axiom/OpenHub operating console (Express + Vite, :3010).
  // UNMANAGED before this config (operator console must survive reboot).
  // Entry `server.ts` via tsx (npm run dev), env PORT=3010. OpenHub loads its
  // own .env (OPENHUB_DB_PATH, session secrets, Keywire keys), so inject only
  // PORT/NODE_ENV/UPLIFT_ROOT and let its dotenv be authoritative — same
  // pattern as the axiom entry above.
  pm2App({
    name: "openhub",
    script: path.join(
      P("06_Resources/Axiom Agent/openhub"),
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs"
    ),
    args: "server.ts",
    cwd: P("06_Resources/Axiom Agent/openhub"),
    interpreter: NODE,
    memory: "1G",
    restart_delay: 5000,
    env: {
      NODE_ENV: "development",
      PORT: "3010",
      UPLIFT_ROOT,
      // Same Keywire move as axiom above.
      KEYWIRE_KEYS_FILE: P("06_Resources/Keywire/data/keywire-keys.json"),
    },
  }),
  // llama-server — llama.cpp OpenAI-compatible server for the fleet's LOCAL
  // MODEL lane on :11434 (alias `qwen3.5-2b`). LocalJev points at this
  // (LOCALJEV_UPSTREAM=http://127.0.0.1:11434). This is the tier Jev decisions
  // fall back to when the Vercel AI Gateway is unavailable.
  //
  // SWITCHED 2026-09-28: MiniCPM5-1B "Fable" → Unsloth Qwen3.5-2B (UD-Q4_K_XL).
  // Rationale (operator's own head-to-head on the oncology suite): Qwen3.5-2B
  // scored 35/38 vs 37/38 for the 4B at ~2.2x the speed (6.8 vs 3.1 tok/s), so
  // the 4B is unusable on this 15W laptop. Unsloth Dynamic 2.0 upcasts important
  // layers to 8/16-bit, so UD-Q4_K_XL beats a plain Q4_K_M at +0.06 GB. Qwen3.5-2B
  // is natively multimodal, so the same server takes --mmproj and also covers the
  // local vision tier (no separate model). `--alias qwen3.5-2b` is the
  // ecosystem-wide local model id (matches the GenieX phone catalog).
  // Memory ceiling raised 3G→4G: 1.28 GB weights + 0.64 GB projector + KV, and
  // pm2 killing it mid-inference would reintroduce the local-lane outage.
  pm2App({
    name: "llama-server",
    script: LLAMA_SERVER_BIN,
    args:
      "-m C:\\Users\\User\\models\\Qwen3.5-2B-UD-Q4_K_XL.gguf --mmproj C:\\Users\\User\\models\\Qwen3.5-2B-mmproj-F16.gguf --port 11434 --host 127.0.0.1 -t 6 -b 2048 -ub 512 --cache-prompt --parallel 1 -c 8192 --reasoning off -ngl 0 --jinja --min-p 0 --alias qwen3.5-2b",
    memory: "4G",
    restart_delay: 5000,
    env: { NODE_ENV: "production" },
  }),
  // nomic-embed — local EMBEDDINGS server (llama.cpp), the tier LiteLLM's
  // `nomic-embed` model group points at (:11435). nomic-embed-text-v1.5, 768-dim,
  // Apache-2.0, offline. Required by Synthbook's retrieval and any other
  // semantic retrieval. Mirrors C:\Users\User\models\start-embed.ps1. Separate
  // port from the :11434 chat lane because llama-server serves one model each.
  pm2App({
    name: "nomic-embed",
    script: LLAMA_SERVER_BIN,
    args:
      "-m C:\\Users\\User\\models\\nomic-embed-text-v1.5.Q8_0.gguf --port 11435 --host 127.0.0.1 -c 2048 -np 1 -t 6 -fa on --alias nomic-embed --embeddings --pooling mean",
    memory: "1G",
    restart_delay: 5000,
    env: { NODE_ENV: "production" },
  }),
  // ecosystem-sampler — headless 24/7 history sampler for the Ecosystem Control
  // Center. Writes the same .ecosystem-dashboard/history.jsonl schema the
  // dashboard reads, so fleet uptime/report history stays continuous even when
  // the desktop app is closed. Read-only (pm2 jlist + HTTP probes); no mutations.
  pm2App({
    name: "ecosystem-sampler",
    script: path.join(UPLIFT_ROOT, "ecosystem", "scripts", "sampler.mjs"),
    cwd: UPLIFT_ROOT,
    interpreter: NODE,
    memory: "256M",
    restart_delay: 5000,
    env: { NODE_ENV: "production", UPLIFT_ROOT },
  }),
];

// ── Move guard ───────────────────────────────────────────────────────────────
// Files get moved around; a stale entry path silently produces a pm2 app that
// dies on start (or a registry entry that points at the wrong script). Resolve
// every declared entry at load time and SHOUT about any problems, so a move is
// caught by config load / `node fleet-manifest.js` — not by a silent crash hours
// later. Warn-only: never blocks a config from loading.
//
// Beyond the original script-existence check this also verifies the working
// directory and an absolute interpreter path, and detects two entries claiming
// the same `--port`. The script-only check is what let a service whose routes
// all 404'd still be recorded as "verified online".
function fleetEntryIssues() {
  const groups = {
    CORE_APP,
    FLEET_SERVICES,
    MARKETING_SERVICES,
    DSH_SERVICES,
    BRAIN_SERVICES,
    INFRA_SERVICES,
  };
  const seen = new Set();
  const issues = [];
  const portClaims = new Map();
  for (const val of Object.values(groups)) {
    const arr = Array.isArray(val) ? val : val && val.name ? [val] : [];
    for (const app of arr) {
      if (!app || !app.name || seen.has(app.name)) continue;
      seen.add(app.name);
      if (!app.script) continue;
      const p = path.isAbsolute(app.script)
        ? app.script
        : path.resolve(app.cwd || process.cwd(), app.script);
      if (!fs.existsSync(p)) issues.push(`${app.name} -> MISSING script ${p}`);
      if (app.cwd && !fs.existsSync(app.cwd)) {
        issues.push(`${app.name} -> MISSING cwd ${app.cwd}`);
      }
      if (app.interpreter && path.isAbsolute(app.interpreter) && !fs.existsSync(app.interpreter)) {
        issues.push(`${app.name} -> MISSING interpreter ${app.interpreter}`);
      }
      const argsStr = Array.isArray(app.args) ? app.args.join(" ") : String(app.args || "");
      const m = argsStr.match(/--port[= ](\d{2,5})/);
      if (m) {
        if (!portClaims.has(m[1])) portClaims.set(m[1], []);
        portClaims.get(m[1]).push(app.name);
      }
    }
  }
  for (const [port, names] of portClaims) {
    if (names.length > 1) {
      issues.push(`PORT CONFLICT :${port} claimed by ${names.join(", ")}`);
    }
  }
  return issues;
}

if (require.main === module) {
  const issues = fleetEntryIssues();
  console.log(`[fleet-manifest] ${issues.length ? `${issues.length} issue(s)` : "all entries resolve"}`);
  for (const m of issues) console.log(`[fleet-manifest]   ${m}`);
}

module.exports = {
  UPLIFT_ROOT,
  ORCH_DIR,
  loadEnvLocal,
  pm2App,
  CORE_APP,
  FLEET_SERVICES,
  MARKETING_SERVICES,
  DSH_SERVICES,
  BRAIN_SERVICES,
  INFRA_SERVICES,
  fleetEntryIssues,
};


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
// ============================================================================

const fs = require("node:fs");
const path = require("node:path");

const UPLIFT_ROOT = process.env.UPLIFT_ROOT || "C:\\Users\\User\\Downloads\\Uplift";
const ORCH_DIR = path.join(UPLIFT_ROOT, "Draymond-Orchestrator");

// Rooted path helpers â€” the ONLY place ecosystem paths are derived.
const P = (rel) => path.join(UPLIFT_ROOT, rel); // uplift-rooted
const O = (rel) => path.join(ORCH_DIR, rel);     // orchestrator-rooted

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
const OPENCODE_BIN =
  process.env.OPENCODE_BIN ||
  "C:\\Users\\User\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode";
const CLOUDFLARED_BIN =
  process.env.CLOUDFLARED_BIN ||
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";

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
    DRAYMOND_FAILOVER_MATRIX: "1",
    DRAYMOND_DAILY_COST_CAP_CENTS:
      process.env.DRAYMOND_DAILY_COST_CAP_CENTS || "5000",
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
  pm2App({
    name: "hermes-brain",
    script: "server.js",
    cwd: O("hermes-proxy"),
    interpreter: NODE,
    memory: "1G",
    env: {
      HERMES_PROXY_PORT: "8642",
      NODE_ENV: "production",
      API_SERVER_HOST: D.API_SERVER_HOST || "127.0.0.1",
      API_SERVER_PORT: D.API_SERVER_PORT || "8642",
      API_SERVER_KEY: D.API_SERVER_KEY || "",
    },
  }),
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
    cwd: P("05_Apps/Staffing-Commission-Engine"),
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
  pm2App({
    name: "bookbridge",
    script: PYTHON,
    args: "main.py --http-only",
    cwd: O("agents/BookBridge--main"),
    memory: "1G",
    env: { ...D, NODE_ENV: "production" },
  }),
  // OmniResearch Pro â€” deep-research analyst (Gemini / Ollama / SearXNG).
  // Research-squad lead. Runs on :3010 (OMNI_RESEARCH_URL) so KeyWire keeps :3000.
  pm2App({
    name: "omniresearch",
    script: O("agents/OmniResearch-Pro-main/node_modules/tsx/dist/cli.mjs"),
    args: "server.ts",
    cwd: O("agents/OmniResearch-Pro-main"),
    interpreter: NODE,
    memory: "768M",
    env: {
      ...D,
      NODE_ENV: "production",
      PORT: "3010",
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      BOOKBRIDGE_URL: "http://127.0.0.1:8777",
    },
  }),
  pm2App({
    name: "uplift-agent",
    script: "server.js",
    cwd: O("agents/Uplift-Agent"),
    interpreter: NODE,
    memory: "1G",
    env: { UPLIFT_PORT: "8000", NODE_ENV: "production", ...D },
  }),
  pm2App({
    name: "sub-team",
    script: PYTHON,
    args: "main.py --serve --port 8050 --host 0.0.0.0",
    cwd: O("agents/Sub-Team-main"),
    memory: "1G",
    env: { ...D, NODE_ENV: "production" },
  }),
  pm2App({
    name: "overlay-chain",
    script: PYTHON,
    args: "-m uvicorn main:app --host 127.0.0.1 --port 3020",
    cwd: O("agents/OverlayChain-Service"),
    memory: "512M",
    env: { ...D, NODE_ENV: "production" },
  }),
  pm2App({
    name: "indy-music",
    script: PYTHON,
    args: "-m uvicorn main:app --host 127.0.0.1 --port 8020",
    cwd: O("agents/IndyMusic-Service"),
    memory: "512M",
    env: { ...D, NODE_ENV: "production" },
  }),
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
  pm2App({
    name: "hemp-os",
    script: "server.ts",
    cwd: P("potential/Hemp-OS-main"),
    interpreter: NODE,
    node_args: "--import tsx",
    memory: "1G",
    env: { PORT: "3100", NODE_ENV: "production", ...D },
  }),
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
  pm2App({
    name: "openchat",
    script: P("Open-Chat/node_modules/vite/bin/vite.js"),
    args: "--port 5175 --strictPort",
    cwd: P("Open-Chat"),
    interpreter: NODE,
    memory: "512M",
    env: { NODE_ENV: "development", PORT: "5175" },
  }),
  // Overlay Global Lens â€” public research/news outlet. Reads ecosystem research
  // from .draymond/*.json (via DRAPMOND_DIR) and the Overlay Science research
  // outputs (via OVERLAY_RESEARCH_DIR), plus Draymond's HTTP endpoints.
  // Runs its own SQLite (app.sqlite) for fast public serving. Port 3090 is the
  // fleet dev port (Draymond owns 3000/3444).
  pm2App({
    name: "global-lens",
    script: P("Overlay-Global-Lens/dist/server.mjs"),
    cwd: P("Overlay-Global-Lens"),
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
      OMNIRESEARCH_URL: process.env.OMNI_RESEARCH_URL || "http://localhost:3010",
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
    script: P("Dev-Brain/dist/server.cjs"),
    args: "",
    cwd: P("Dev-Brain"),
    interpreter: NODE,
    memory: "256M",
    env: { PORT: "3450", HOST: "127.0.0.1", NODE_ENV: "production" },
  }),
  pm2App({
    name: "halofy",
    script: P("04_Integrations/github-awesome/halofy/kernel/node_modules/tsx/dist/cli.mjs"),
    args: "src/http/main.ts",
    cwd: P("04_Integrations/github-awesome/halofy/kernel"),
    interpreter: NODE,
    memory: "512M",
    env: { HALOMEM_PORT: "8787", NODE_ENV: "production" },
  }),
  pm2App({
    name: "eidos",
    script: "C:\\Users\\User\\.local\\bin\\eidos.exe",
    args: "serve C:\\Users\\User\\Downloads\\Uplift\\Draymond-Orchestrator\\data\\eidos\\fleet.eidos --port 8420",
    cwd: ORCH_DIR,
    memory: "256M",
    env: { PORT: "8420" },
  }),
  pm2App({
    name: "buzz-relay",
    script: P("04_Integrations/github-awesome/buzz/pm2-buzz-relay.cjs"),
    args: "",
    cwd: P("04_Integrations/github-awesome/buzz"),
    interpreter: NODE,
    memory: "512M",
  }),
  pm2App({
    name: "rome",
    script: P("04_Integrations/github-awesome/rome/pm2-rome.cjs"),
    args: "",
    cwd: P("04_Integrations/github-awesome/rome"),
    interpreter: NODE,
    memory: "512M",
  }),
];

// â”€â”€ Marketing / coding stack (ecosystem.marketing.config.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const REDIS_BIN =
  process.env.REDIS_BIN ||
  "C:\\Program Files\\Redis\\redis-server.exe";

const SMD_DIR = O("agents/Social-Media-Dashboard--main");

const SMD_ENV = {
  AI_BACKEND: "remote",
  AI_IMAGE_BACKEND: "local",
  AI_DEVICE: "cpu",
  SD_MODEL: "stabilityai/sd-turbo",
  REMOTE_LLM_MODEL: "opencode",
  REMOTE_LLM_URL: "http://localhost:4100/chat/completions",
  REMOTE_LLM_API_KEY: D.LITELLM_MASTER_KEY || D.DEEPSEEK_API_KEY || "",
  GEMINI_API_KEY: D.GEMINI_API_KEY || "",
  GEMINI_MODEL: "gemini-3.5-flash",
  REDIS_URL: "redis://127.0.0.1:6379/0",
  X_API_KEY: D.X_API_KEY || "",
  X_API_SECRET: D.X_API_SECRET || "",
  X_ACCESS_TOKEN: D.X_ACCESS_TOKEN || "",
  X_ACCESS_TOKEN_SECRET: D.X_ACCESS_TOKEN_SECRET || "",
  LINKEDIN_ACCESS_TOKEN: D.LINKEDIN_ACCESS_TOKEN || "",
  LINKEDIN_AUTHOR_URN: D.LINKEDIN_AUTHOR_URN || "",
  INSTAGRAM_ACCESS_TOKEN: D.INSTAGRAM_ACCESS_TOKEN || "",
  TIKTOK_ACCESS_TOKEN: D.TIKTOK_ACCESS_TOKEN || "",
  YOUTUBE_ACCESS_TOKEN: D.YOUTUBE_ACCESS_TOKEN || "",
  FACEBOOK_ACCESS_TOKEN: D.FACEBOOK_ACCESS_TOKEN || "",
  PINTEREST_ACCESS_TOKEN: D.PINTEREST_ACCESS_TOKEN || "",
  PUBLISH_DRY_RUN: D.PUBLISH_DRY_RUN || "1",
  BROWSER_SERVICE_URL: "http://127.0.0.1:8040",
  BROWSER_SERVICE_API_KEY: D.BROWSER_SERVICE_API_KEY || "",
};

const MARKETING_SERVICES = [
  // Redis â€” message broker and result backend for Celery.
  // The Windows service exists but is stopped by default; PM2 manages it here
  // so the whole SMD stack starts and stops together.
  pm2App({
    name: "smd-redis",
    script: REDIS_BIN,
    args: "--port 6379 --bind 127.0.0.1",
    memory: "256M",
    restart_delay: 2000,
    logPrefix: "smd-redis",
  }),

  pm2App({
    name: "smd",
    script: PYTHON,
    args: "-m uvicorn src.ai.api:app --host 127.0.0.1 --port 8030",
    cwd: SMD_DIR,
    memory: "1G",
    env: SMD_ENV,
  }),

  // Celery worker â€” executes video generation, campaign sends, and AI copy tasks.
  // Runs in the ai_tasks + default queues. Requires smd-redis to be healthy first.
  pm2App({
    name: "smd-celery",
    script: PYTHON,
    args: "-m celery -A celery_worker worker --loglevel=info --concurrency=2 -Q celery,ai_tasks",
    cwd: SMD_DIR,
    memory: "1G",
    restart_delay: 5000,
    logPrefix: "smd-celery",
    env: SMD_ENV,
  }),

  // Celery beat â€” triggers recurring tasks: campaign scheduler (every 5 min)
  // and analytics sync (every 60 min), as defined in celeryconfig.py.
  pm2App({
    name: "smd-beat",
    script: PYTHON,
    args: "-m celery -A celery_worker beat --loglevel=info --scheduler celery.beat:PersistentScheduler",
    cwd: SMD_DIR,
    memory: "256M",
    restart_delay: 5000,
    logPrefix: "smd-beat",
    env: SMD_ENV,
  }),

  // Browser automation micro-service â€” Playwright-powered posting for Instagram,
  // TikTok, YouTube, LinkedIn, and X. Port 8040. Sessions persisted to disk.
  // Requires: `playwright install chromium` run once in the SMD virtualenv.
  pm2App({
    name: "smd-browser",
    script: PYTHON,
    args: "-m uvicorn browser_service.main:app --host 127.0.0.1 --port 8040",
    cwd: SMD_DIR,
    memory: "1G",
    restart_delay: 5000,
    logPrefix: "smd-browser",
    env: {
      ...SMD_ENV,
      BROWSER_SERVICE_API_KEY: D.BROWSER_SERVICE_API_KEY || "",
      // Set PLAYWRIGHT_BROWSERS_PATH if chromium is installed to a custom location
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "",
    },
  }),

  pm2App({
    name: "grader",
    script: O("agents/Grader-main/node_modules/tsx/dist/cli.mjs"),
    args: "server.ts",
    cwd: O("agents/Grader-main"),
    interpreter: NODE,
    memory: "1G",
    env: { PORT: "3201", NODE_ENV: "development" },
  }),
  pm2App({
    name: "agent-browser",
    script: O("agents/AgentBrowser-main/node_modules/next/dist/bin/next"),
    args: "dev -p 3700",
    cwd: O("agents/AgentBrowser-main"),
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "3700",
      NODE_ENV: "development",
      AGENT_API_KEY: D.AGENTBROWSER_API_KEY || "local-dev-agent-key",
      DATABASE_URL: "file:./dev.db",
    },
  }),
  pm2App({
    name: "mutly",
    script: O("agents/Mutly-Daemon-Agent/node_modules/tsx/dist/cli.mjs"),
    args: "server.ts",
    cwd: O("agents/Mutly-Daemon-Agent"),
    interpreter: NODE,
    memory: "1G",
    env: {
      PORT: "4000",
      NODE_ENV: "development",
      MUTLY_WS_PORT: "24679",
      MUTLY_ALLOW_SIMULATION_STUBS: "true",
    },
  }),
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
      DATABASE_URL: "file:./reporank.db",
      REDIS_URL: "redis://127.0.0.1:6379",
      JWT_SECRET:
        D.JWT_SECRET || "local-reporank-dev-secret-0123456789abcdef0123456789abcdef",
      GEMINI_API_KEY: D.GEMINI_API_KEY || "",
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
const DSH_DIR = process.env.DSH_DIR || path.join(UPLIFT_ROOT, "Deepseek Harness", "deepseek-harness-master");
const DSH_SERVICES = [
  pm2App({
    name: "dsh-harness",
    script: NODE,
    // NOTE: --patch must come directly after `web`; once the parser sees an
    // unknown option (--port) everything after is passed to the web app.
    args: "--import tsx apps/cli/src/bin.ts web --patch \"C:/Users/User/Downloads/Uplift/Deepseek Harness/ecosystem.patch.yml\" --port 3080",
    cwd: DSH_DIR,
    memory: "1G",
    env: {
      ...D,
      NODE_ENV: "production",
      PORT: "3080",
      DSH_HOME: process.env.DSH_HOME || path.join(UPLIFT_ROOT, ".dsh-home"),
      UPLIFT_ROOT,
      DRAYMOND_REGISTRY_DIR: path.join(ORCH_DIR, ".draymond"),
      // LLM routing â€” Ox Alpha free primary, DeepSeek direct fallback
      OPENCODE_API_KEY: D.OPENCODE_API_KEY || "",
      DEEPSEEK_API_KEY: D.DEEPSEEK_API_KEY || "",
      DEEPSEEK_BASE_URL: D.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      OPENCODE_VIA_DSH: process.env.OPENCODE_VIA_DSH || "0",
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
      API_PORT: D.API_PORT || "8000",
      UVICORN_WORKERS: "1",
      SOUL_PATH: path.join(BRAIN_DIR, ".soul.yaml"),
      NODE_ENV: "production",
      ALLOW_LOCAL_AGENTS: "1",
    },
  }),
];

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
};


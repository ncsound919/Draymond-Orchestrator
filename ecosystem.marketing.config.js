// ============================================================================
// PM2 — Overlay365 Fleet Stack (SMD AI API + opencode codegen + grader + agent-browser)
// ============================================================================
// Dedicated supervisor for the services the fleet chains depend on. All are
// flaky when started by the Draymond service-manager on Windows, so they get
// their own PM2 entries here:
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

const fs = require("node:fs");
const path = require("node:path");

const ORCH_DIR = __dirname;
const ENV_LOCAL = path.join(ORCH_DIR, ".env.local");

function loadEnvLocal() {
  const env = {};
  try {
    const raw = fs.readFileSync(ENV_LOCAL, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // No .env.local — the process will fail-fast on missing keys.
  }
  return env;
}

const D = loadEnvLocal();
const PYTHON = process.env.PYTHON_PATH || "C:\\Program Files\\Python312\\python.exe";

module.exports = {
  apps: [
    {
      name: "smd",
      script: PYTHON,
      args: "-m uvicorn src.ai.api:app --host 127.0.0.1 --port 8030",
      cwd: path.join(ORCH_DIR, "agents", "Social-Media-Dashboard--main"),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "smd-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "smd-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        AI_BACKEND: "remote",
        AI_IMAGE_BACKEND: "remote",
        REMOTE_LLM_MODEL: "deepseek-chat",
        REMOTE_LLM_URL: "https://api.deepseek.com/v1/chat/completions",
        REMOTE_LLM_API_KEY: D.DEEPSEEK_API_KEY || "",
        GEMINI_API_KEY: D.GEMINI_API_KEY || "",
        GEMINI_MODEL: "gemini-3.5-flash",
        // Local Stable Diffusion must NOT be loaded on this box (multi-GB CPU
        // download). The remote fallback is the only path the chain uses.
        SD_MODEL: "remote-disabled",
        // Social publisher credentials (see src.ai.publisher). Empty = skip.
        X_API_KEY: D.X_API_KEY || "",
        X_API_SECRET: D.X_API_SECRET || "",
        X_ACCESS_TOKEN: D.X_ACCESS_TOKEN || "",
        X_ACCESS_TOKEN_SECRET: D.X_ACCESS_TOKEN_SECRET || "",
        LINKEDIN_ACCESS_TOKEN: D.LINKEDIN_ACCESS_TOKEN || "",
        LINKEDIN_AUTHOR_URN: D.LINKEDIN_AUTHOR_URN || "",
        PUBLISH_DRY_RUN: D.PUBLISH_DRY_RUN || "1",
      },
    },
    {
      name: "opencode",
      script: "C:\\Users\\User\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode",
      args: "serve --port 4096",
      cwd: ORCH_DIR,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "opencode-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "opencode-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        NODE_ENV: "production",
        OPENCODE_SERVER_PASSWORD: D.OPENCODE_SERVER_PASSWORD || "ocpass",
        OPENCODE_API_KEY: D.OPENCODE_API_KEY || "",
      },
    },
    {
      name: "grader",
      script: path.join(ORCH_DIR, "agents", "Grader-main", "node_modules", "tsx", "dist", "cli.mjs"),
      args: "server.ts",
      cwd: path.join(ORCH_DIR, "agents", "Grader-main"),
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "grader-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "grader-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        PORT: "3201",
        NODE_ENV: "development",
      },
    },
    {
      name: "agent-browser",
      script: path.join(ORCH_DIR, "agents", "AgentBrowser-main", "node_modules", "next", "dist", "bin", "next"),
      args: "dev -p 3700",
      cwd: path.join(ORCH_DIR, "agents", "AgentBrowser-main"),
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "agent-browser-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "agent-browser-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        PORT: "3700",
        NODE_ENV: "development",
        AGENT_API_KEY: D.AGENTBROWSER_API_KEY || "local-dev-agent-key",
        DATABASE_URL: "file:./dev.db",
      },
    },
    {
      name: "mutly",
      script: path.join(ORCH_DIR, "agents", "Mutly-Daemon-Agent", "node_modules", "tsx", "dist", "cli.mjs"),
      args: "server.ts",
      cwd: path.join(ORCH_DIR, "agents", "Mutly-Daemon-Agent"),
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "mutly-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "mutly-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        PORT: "4000",
        NODE_ENV: "development",
        MUTLY_WS_PORT: "24679",
        MUTLY_ALLOW_SIMULATION_STUBS: "true",
      },
    },
    {
      name: "reporank",
      script: path.join(ORCH_DIR, "agents", "reporank", "node_modules", ".pnpm", "tsx@4.23.12", "node_modules", "tsx", "dist", "cli.mjs"),
      args: "src/index.ts",
      cwd: path.join(ORCH_DIR, "agents", "reporank", "apps", "api"),
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "reporank-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "reporank-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        PORT: "3200",
        NODE_ENV: "development",
        DATABASE_URL: "file:./reporank.db",
        REDIS_URL: "redis://127.0.0.1:6379",
        JWT_SECRET: D.JWT_SECRET || "local-reporank-dev-secret-0123456789abcdef0123456789abcdef",
        GEMINI_API_KEY: D.GEMINI_API_KEY || "",
      },
    },
    {
      name: "claw-protect",
      script: path.join(ORCH_DIR, "agents", "Claw-Protect-main", "node_modules", "tsx", "dist", "cli.mjs"),
      args: "server.ts",
      cwd: path.join(ORCH_DIR, "agents", "Claw-Protect-main"),
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      exp_backoff_restart_delay: 100,
      time: true,
      merge_logs: true,
      out_file: path.join(ORCH_DIR, "data", "logs", "claw-protect-out.log"),
      error_file: path.join(ORCH_DIR, "data", "logs", "claw-protect-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      env: {
        CLAW_PORT: "3300",
        CLAW_SERVE_SAAS: "false",
        NODE_ENV: "development",
      },
    },
  ],
};

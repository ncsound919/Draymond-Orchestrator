// ============================================================================
// PM2 — Overlay365 Marketing Stack (SMD AI API + opencode codegen)
// ============================================================================
// Dedicated supervisor for the services the Daily Marketing Run chain depends
// on. Both are flaky when started by the Draymond service-manager on Windows,
// so they get their own PM2 entries here:
//
//   smd       — Social Media Dashboard AI API (text/image/schedule, remote backends)
//   opencode  — opencode headless server (codegen for the repair team)
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
  ],
};

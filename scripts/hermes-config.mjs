#!/usr/bin/env node
// Writes ~/.hermes/config.yaml from .env.local so the YAML stays in sync with
// the canonical ecosystem API keys and the mission brain wiring.
//
// Schema notes (verified against hermes-agent v0.20.0 source):
//   - providers live TOP-LEVEL (dict of name -> {api, key_env, default_model})
//   - fallback chain is TOP-LEVEL fallback_providers: list of {provider, model}
//   - MCP servers live TOP-LEVEL under mcp_servers: (NOT mcp.servers)
//   - api_server platform enabled via platforms.api_server
//   - model.provider selects the provider; model.default is the model id
//
// The single OPENCODE_API_KEY works for BOTH opencode-zen (free) and
// opencode-go (paid) tiers — the built-in opencode-zen / opencode-go
// providers are used and their env vars are mapped from OPENCODE_API_KEY.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname); // scripts/.. -> Draymond-Orchestrator
const envPath = join(ROOT, '.env.local');
const hermesDir = join(homedir(), '.hermes');
const configPath = join(hermesDir, 'config.yaml');

function loadEnv(path) {
  if (!existsSync(path)) throw new Error(`.env.local not found at ${path}`);
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (k) out[k] = v;
  }
  return out;
}

function yaml(v, indent = 0) {
  const pad = ' '.repeat(indent);
  if (v == null) return '~';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => `${pad}- ${yaml(x, indent + 2).trimStart()}`).join('\n');
  }
  if (typeof v === 'object') {
    return Object.entries(v)
      .map(([k, val]) => {
        if (val && typeof val === 'object') return `${pad}${k}:\n${yaml(val, indent + 2)}`;
        return `${pad}${k}: ${yaml(val, indent + 2)}`;
      })
      .join('\n');
  }
  return String(v);
}

const env = loadEnv(envPath);
const required = ['OPENCODE_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'API_SERVER_KEY'];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`[hermes-config] missing required keys in .env.local: ${missing.join(', ')}`);
  process.exit(1);
}

const vibeserveMain = join(ROOT, 'agents', 'VibeServe-main', 'vibeserve', '__main__.py');

// Local-first inference: a llama.cpp/OpenAI-compatible server (MiniCPM5-2B).
// Cloud providers below remain as the fallback chain when the local server is
// down or the model fails. Override via .env.local without touching this file.
const localBaseUrl = (env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
const localModel = env.LOCAL_LLM_MODEL || 'minicpm5-2b';

// Local inference for Hermes. MiniCPM5-2B is served at 64K context
// (start-minicpm.ps1), which clears Hermes' minimum 64K window
// (agent_init.py). Enable with HERMES_LOCAL_PRIMARY=1 in .env.local; the cloud
// providers below stay as the fallback chain. Expect slow turns — this CPU
// throttles under sustained load.
const localPrimary = env.HERMES_LOCAL_PRIMARY === '1';

const config = {
  model: localPrimary
    ? {
        provider: 'custom',
        base_url: localBaseUrl,
        default: localModel,
        // Local servers ignore the key; Hermes sends it as the bearer token.
        api_key: env.LOCAL_LLM_API_KEY || 'no-key-required',
        // Must be >= 64000 (Hermes floor) and match start-minicpm.ps1 -Context.
        context_length: Number(env.LOCAL_LLM_CONTEXT) || 65536,
      }
    : {
        provider: 'opencode-zen',
        default: 'deepseek-v4-flash-free',
      },
  fallback_providers: [
    { provider: 'opencode-go', model: 'deepseek-v4-flash' },
    { provider: 'deepseek', model: 'deepseek-v4-flash' },
    { provider: 'gemini', model: 'gemini-3.5-flash' },
  ],
  platforms: {
    api_server: {
      enabled: true,
      host: env.API_SERVER_HOST || '127.0.0.1',
      port: Number(env.API_SERVER_PORT) || 8642,
      key: env.API_SERVER_KEY,
    },
  },
  mcp_servers: {
    vibeserve: {
      command: 'python',
      args: [vibeserveMain],
      env: {
        VIBESERVE_API_SECRET: env.VIBESERVE_API_SECRET || 'benchmark-secret-2024',
        // Break the Hermes <-> VibeServe MCP recursion: VibeServe mounts a
        // "hermes mcp serve" proxy when hermes is on PATH, which re-runs Hermes
        // MCP discovery and spawns another VibeServe (process explosion).
        VIBESERVE_DISABLE_HERMES_PROXY: '1',
      },
    },
  },
};

// Backup the existing config (one deep copy) before overwriting.
if (existsSync(configPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(hermesDir, `config.yaml.bak-${stamp}`);
  writeFileSync(backupPath, readFileSync(configPath, 'utf8'));
  console.log(`[hermes-config] backed up existing config to ${backupPath}`);
}

mkdirSync(hermesDir, { recursive: true });
writeFileSync(configPath, `# Generated by scripts/hermes-config.mjs — do not edit by hand.\n${yaml(config)}\n`, 'utf8');
console.log(`[hermes-config] wrote ${configPath}`);

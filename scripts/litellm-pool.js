// LiteLLM gateway wrapper for pm2.
//
// KEYWIRE-FIRST secret resolution: at startup this wrapper pulls the LLM pool
// keys + Cloudflare credentials from the Keywire vault (local trust pointer:
// data/keywire-keys.json → short-lived SVID → /api/v1/workload/fetch-secrets)
// and applies them to the child env. `data/litellm.env` / `.env.local` are the
// FALLBACK for anything the vault does not hold (e.g. LITELLM_MASTER_KEY, the
// legacy OLLAMA_KEY_JOHNREDD888 / OLLAMA_KEY_NCSOUND_ALT entries) and for
// non-secret config. Vault values win where both exist.
//
//   - KEYWIRE_URL / KEYWIRE_PROJECT_ID / KEYWIRE_ENV_SLUG select the bundle
//     (defaults: http://localhost:3000 / prj-mt7jrul1 / production).
//   - LITELLM_POOL_DRYRUN=1 resolves secrets and exits WITHOUT spawning litellm
//     (used to verify wiring without starting the service).
//   - Any Keywire failure is fail-soft: warn and start on the file values.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

// Secrets litellm actually consumes (model groups in litellm.yaml + pool probes
// + the MCP ecosystem_control token). Kept as an explicit allowlist so the
// gateway never inherits unrelated vault secrets.
const KEYWIRE_SECRET_KEYS = [
  'OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY',
  'OPENCODE_KEY_JOHNREDD', 'OPENCODE_KEY_NCSOUND919', 'OPENCODE_KEY_TAP4500', 'OPENCODE_KEY_TAP919BEATS',
  'OLLAMA_KEY_PRIMARY', 'OLLAMA_KEY_TAP919BEATS', 'OLLAMA_KEY_TAP4500', 'OLLAMA_KEY_NCSOUND919',
  'OLLAMA_KEY_JOHNREDD888', 'OLLAMA_KEY_NCSOUND_ALT',
  'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_EDIT_TOKEN',
  'ECOSYSTEM_CONTROL_TOKEN', 'LITELLM_MASTER_KEY',
  'PHONE_NODE_KEY',
];

// ── 1. File fallback (non-secret config + anything the vault lacks) ──────────
for (const f of ['.env.local', path.join('data', 'litellm.env')]) {
  const p = path.isAbsolute(f) ? f : path.join(repoRoot, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const idx = t.indexOf('=');
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (k && v && process.env[k] === undefined) process.env[k] = v;
  }
}

// ── 2. Keywire-first override ────────────────────────────────────────────────
async function applyKeywireSecrets() {
  const url = (process.env.KEYWIRE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const projectId = process.env.KEYWIRE_PROJECT_ID || 'prj-mt7jrul1';
  const envSlug = process.env.KEYWIRE_ENV_SLUG || 'production';
  const upliftRoot = path.resolve(repoRoot, '..');
  const keysFile =
    process.env.KEYWIRE_KEYS_FILE ||
    path.join(upliftRoot, '06_Resources', 'Keywire', 'data', 'keywire-keys.json');
  if (!fs.existsSync(keysFile)) {
    console.warn(`[litellm-pool] key material not found at ${keysFile} — using file values (Keywire-first skipped)`);
    return 0;
  }
  let jwtSecret;
  try {
    jwtSecret = JSON.parse(fs.readFileSync(keysFile, 'utf8')).jwtSecret;
  } catch (e) {
    console.warn(`[litellm-pool] key material unreadable (${e.message}) — using file values`);
    return 0;
  }
  if (!jwtSecret) {
    console.warn('[litellm-pool] key material has no jwtSecret — using file values');
    return 0;
  }

  // Sign the SVID exactly the way server.ts verifies it (HMAC-SHA256 JWT).
  const b64u = (x) => Buffer.from(x).toString('base64url');
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({
    sub: 'spiffe://ecosystem/litellm-pool',
    iss: 'keywire-local-consumer',
    aud: 'keywire-vault-api',
    projectId,
    iat: now,
    exp: now + 120,
  }));
  const sig = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest();
  const svid = `${header}.${payload}.${b64u(sig)}`;

  // Retry: after a reboot, litellm can start before Keywire is listening, and a
  // single failed fetch would leave CLOUDFLARE_* unset (workers-ai then has no
  // credentials). Retry a few times before falling back to file values.
  let lastErr = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(`${url}/api/v1/workload/fetch-secrets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${svid}` },
        body: JSON.stringify({ svid, projectId, envSlug }),
        signal: ac.signal,
      });
      if (res.ok) {
        const secrets = (await res.json()).secrets || {};
        let applied = 0;
        for (const k of KEYWIRE_SECRET_KEYS) {
          if (typeof secrets[k] === 'string' && secrets[k]) { process.env[k] = secrets[k]; applied++; }
        }
        console.log(`[litellm-pool] Keywire-first: applied ${applied}/${KEYWIRE_SECRET_KEYS.length} keys from vault (${projectId}/${envSlug})`);
        return applied;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 5000));
  }
  console.warn(`[litellm-pool] Keywire unavailable after retries (${lastErr}) — using file values`);
  return 0;
}

// ── 2b. Cloudflare token selection ───────────────────────────────────────────
// The vault has held a stale CLOUDFLARE_API_TOKEN (401 "Invalid API Token")
// while CLOUDFLARE_EDIT_TOKEN is the active credential. The Workers AI lanes all
// read os.environ/CLOUDFLARE_API_TOKEN, so a dead value silently makes every
// fallback chain skip Workers AI and run the LOCAL model instead — exactly the
// CPU load the cloud offload exists to remove. Verify the candidates and expose
// the first working one as CLOUDFLARE_API_TOKEN (self-heals future rotations).
async function cfTokenValid(token) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { authorization: `Bearer ${token}` }, signal: ac.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function pickCloudflareToken() {
  const candidates = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_EDIT_TOKEN', 'CLOUDFLARE_ACCOUNT_API_TOKEN', 'CLOUDFLARE_USER_API_TOKEN'];
  for (const name of candidates) {
    const v = process.env[name];
    if (v && (await cfTokenValid(v))) {
      if (process.env.CLOUDFLARE_API_TOKEN !== v) {
        console.log(`[litellm-pool] CLOUDFLARE_API_TOKEN <- ${name} (vault CLOUDFLARE_API_TOKEN is stale; ${name} is the active token)`);
      }
      process.env.CLOUDFLARE_API_TOKEN = v;
      return name;
    }
  }
  if (process.env.CLOUDFLARE_API_TOKEN) {
    console.warn('[litellm-pool] no valid Cloudflare token among vault candidates — workers-ai will 401 and fall back to local');
  }
  return null;
}

// ── 3. Spawn litellm ─────────────────────────────────────────────────────────
// pm2 freezes env at start time — a host PORT=3444 (Draymond) must not steal
// the gateway. LITELLM_PORT wins, else default 4100; only an explicit
// LITELLM_POOL_PORT can override.
function resolvePort() {
  if (process.env.LITELLM_PORT) process.env.PORT = String(process.env.LITELLM_PORT);
  else if (!process.env.LITELLM_POOL_PORT && process.env.PORT !== '4100') process.env.PORT = '4100';
  else if (process.env.LITELLM_POOL_PORT) process.env.PORT = String(process.env.LITELLM_POOL_PORT);
}

// Resolve the litellm proxy entrypoint. The console script (litellm.exe) is not
// always installed even when the Python package is; in that case run the proxy
// through the package's own `run_server` entrypoint instead of failing ENOENT.
function resolveLitellm() {
  const port = String(process.env.PORT);
  const args = ['--config', 'litellm.yaml', '--port', port];
  const explicit = process.env.LITELLM_BIN;
  if (explicit && fs.existsSync(explicit)) return { cmd: explicit, args };

  const python = process.env.PYTHON_PATH || 'python';
  const scriptDirs = [
    path.dirname(process.env.PYTHON_PATH || ''),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts'),
    path.join(process.env.APPDATA || '', 'Python', 'Python312', 'Scripts'),
    'C:\\Program Files\\Python312\\Scripts',
  ].filter(Boolean);
  for (const dir of scriptDirs) {
    const exe = path.join(dir, 'litellm.exe');
    if (fs.existsSync(exe)) return { cmd: exe, args };
  }

  return {
    cmd: python,
    args: ['-c', 'from litellm.proxy.proxy_cli import run_server; run_server()', ...args],
  };
}

async function main() {
  await applyKeywireSecrets();
  await pickCloudflareToken();
  process.env.PYTHONIOENCODING = 'utf-8';
  resolvePort();

  console.log(`[litellm-pool] spawning litellm on :${process.env.PORT} ` +
    `(pool keys: ${['OPENCODE_API_KEY',
      'OPENCODE_KEY_TAP919BEATS', 'OPENCODE_KEY_JOHNREDD', 'OPENCODE_KEY_NCSOUND919', 'OPENCODE_KEY_TAP4500',
      'OLLAMA_KEY_PRIMARY', 'OLLAMA_KEY_TAP919BEATS', 'OLLAMA_KEY_TAP4500', 'OLLAMA_KEY_NCSOUND919',
      'OLLAMA_KEY_JOHNREDD888', 'OLLAMA_KEY_NCSOUND_ALT', 'OPENROUTER_API_KEY'].filter((k) => process.env[k]).length}/12)`);

  const entry = resolveLitellm();
  console.log(`[litellm-pool] entrypoint: ${entry.cmd}`);

  if (process.env.LITELLM_POOL_DRYRUN === '1') {
    console.log('[litellm-pool] LITELLM_POOL_DRYRUN=1 — resolved secrets, not spawning');
    return;
  }

  const child = spawn(entry.cmd, entry.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('error', (err) => {
    console.error(`[litellm-pool] failed to spawn ${entry.cmd}: ${err.message}`);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

main();

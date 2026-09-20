// LiteLLM gateway wrapper for pm2.
// Loads .env.local + data/litellm.env (KeyWire-vault-synced free-account pool
// keys) into the process environment, then spawns litellm. This keeps the pool
// keys attached across `pm2 restart litellm` without any shell involvement.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

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

process.env.PYTHONIOENCODING = 'utf-8';
if (!process.env.PORT) process.env.PORT = '4100';

console.log(`[litellm-pool] spawning litellm on :${process.env.PORT} ` +
  `(pool keys: ${['OPENCODE_API_KEY',
    'OPENCODE_KEY_TAP919BEATS', 'OPENCODE_KEY_JOHNREDD', 'OPENCODE_KEY_NCSOUND919', 'OPENCODE_KEY_TAP4500',
    'OLLAMA_KEY_PRIMARY', 'OLLAMA_KEY_TAP919BEATS', 'OLLAMA_KEY_TAP4500', 'OLLAMA_KEY_NCSOUND919',
    'OLLAMA_KEY_JOHNREDD888', 'OLLAMA_KEY_NCSOUND_ALT', 'OPENROUTER_API_KEY'].filter((k) => process.env[k]).length}/12)`);

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

const entry = resolveLitellm();
console.log(`[litellm-pool] entrypoint: ${entry.cmd}`);
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

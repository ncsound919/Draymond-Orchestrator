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

const child = spawn('litellm', ['--config', 'litellm.yaml', '--port', String(process.env.PORT)], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code) => process.exit(code ?? 1));

// ============================================================================
// DRAYMOND POOL HEALTH — daily LLM free-account entitlement check
// ============================================================================
// Probes every pooled LLM credential (opencode/Ox Alpha, OpenRouter, Ollama
// Cloud, DeepSeek), classifies what each account may use TODAY, persists the
// result to data/pool-health.json + .draymond/pool-health.json, and
// regenerates litellm.yaml so routing always matches live entitlements:
//
//   - opencode key that answers ox-alpha-free  -> routed in the ox-alpha-free
//     pool (the ecosystem primary model)
//   - opencode key rejected there but valid on zen free models -> routed to
//     the zen-free pool (hy3-free / muse-spark-1.2-contributor-free)
//   - dead upstream keys -> dropped from pools entirely
//
// Zero-cost probes where possible (GET endpoints); tiny max_tokens=1 calls
// only where a chat probe is the only truth.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

// Anchored on DRAYMOND_REGISTRY_DIR when set (Next standalone chdir()s away).
function repoRoot(): string {
  const reg = process.env.DRAYMOND_REGISTRY_DIR;
  if (reg) return path.resolve(reg, '..');
  return process.cwd();
}

export interface PoolProbeResult {
  provider: string;
  credential: string;
  status: 'ok' | 'rate_limited' | 'unauthorized' | 'payment_required' | 'error';
  models?: string[];
  detail?: string;
}

export interface PoolState {
  checkedAt: string;
  oxAlphaActiveKeys: string[]; // env var names entitled to ox-alpha-free
  zenFreeOnlyKeys: string[]; // env var names limited to zen free promo models
  openrouter: PoolProbeResult | null;
  deepseek: PoolProbeResult | null;
  ollamaCloud: { credential: string; ok: boolean }[];
  probes: PoolProbeResult[];
}

const ZEN_FREE_MODELS = ['hy3-free', 'muse-spark-1.2-contributor-free'];
// Current Ox Alpha Free model id on OpenCode Zen (docs/zen list it as
// x-preview-f-free; the legacy alias ox-alpha-free returns 401 upstream).
const OX_ALPHA_MODEL_ID = 'x-preview-f-free';
const PROBE_TIMEOUT_MS = 25_000;

// ── env loading (data/litellm.env first = freshest vault sync, then .env.local)

function loadEnvMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const root = repoRoot();
  for (const rel of ['data/litellm.env', '.env.local']) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
      if (k && v && out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

async function postChat(url: string, apiKey: string, model: string): Promise<{ http: number | null; ok: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return { http: res.status, ok: res.ok };
  } catch {
    clearTimeout(timer);
    return { http: null, ok: false };
  }
}

async function getJson(url: string, apiKey?: string): Promise<{ http: number | null; body?: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    let body: unknown;
    try { body = await res.json(); } catch { /* empty */ }
    return { http: res.status, body };
  } catch {
    clearTimeout(timer);
    return { http: null };
  }
}

const OPENCODE_KEYS = [
  'OPENCODE_KEY_JOHNREDD', 'OPENCODE_KEY_TAP919BEATS', 'OPENCODE_KEY_NCSOUND919',
  'OPENCODE_KEY_TAP4500', 'OPENCODE_API_KEY',
];
const OLLAMA_KEYS = [
  'OLLAMA_KEY_PRIMARY', 'OLLAMA_KEY_TAP919BEATS', 'OLLAMA_KEY_TAP4500',
  'OLLAMA_KEY_NCSOUND919', 'OLLAMA_KEY_JOHNREDD888', 'OLLAMA_KEY_NCSOUND_ALT',
];

// ── probe matrix ─────────────────────────────────────────────────────────────

export async function runPoolHealth(opts: { restartLitellm?: boolean } = {}): Promise<PoolState> {
  const env = loadEnvMap();
  const probes: PoolProbeResult[] = [];
  const oxAlphaActiveKeys: string[] = [];
  const zenFreeOnlyKeys: string[] = [];

  // 1) opencode accounts: who may use ox-alpha today?
  for (const name of OPENCODE_KEYS) {
    const key = env[name];
    if (!key) continue;
    const primary = await postChat('https://opencode.ai/zen/v1/chat/completions', key, OX_ALPHA_MODEL_ID);
    if (primary.ok || primary.http === 429) {
      // 200 or 429 both prove entitlement (429 = valid key, quota window busy)
      oxAlphaActiveKeys.push(name);
      probes.push({ provider: 'opencode', credential: name, status: primary.ok ? 'ok' : 'rate_limited', models: ['ox-alpha-free'] });
      continue;
    }
    // Not entitled to ox-alpha: check zen free promo models.
    const freeOk: string[] = [];
    for (const m of ZEN_FREE_MODELS) {
      const r = await postChat('https://opencode.ai/zen/v1/chat/completions', key, m);
      if (r.ok || r.http === 429) freeOk.push(m);
    }
    if (freeOk.length > 0) {
      zenFreeOnlyKeys.push(name);
      probes.push({ provider: 'opencode', credential: name, status: 'ok', models: freeOk });
    } else {
      probes.push({ provider: 'opencode', credential: name, status: primary.http === 401 ? 'unauthorized' : 'error', detail: `http=${primary.http}` });
    }
  }

  // 2) OpenRouter: balance/key status without burning a request
  let openrouter: PoolProbeResult | null = null;
  if (env.OPENROUTER_API_KEY) {
    const r = await getJson('https://openrouter.ai/api/v1/key', env.OPENROUTER_API_KEY);
    const data = (r.body as any)?.data;
    if (r.http === 200 && data) {
      openrouter = {
        provider: 'openrouter', credential: 'OPENROUTER_API_KEY', status: 'ok',
        detail: `free_tier=${data.is_free_tier ? 'yes(50/day)' : 'no(1000/day)'}`,
      };
    } else {
      openrouter = { provider: 'openrouter', credential: 'OPENROUTER_API_KEY', status: r.http === 401 ? 'unauthorized' : 'error', detail: `http=${r.http}` };
    }
    probes.push(openrouter);
  }

  // 3) Ollama Cloud: model-list auth check (no tokens burned)
  const ollamaCloud: { credential: string; ok: boolean }[] = [];
  for (const name of OLLAMA_KEYS) {
    const key = env[name];
    if (!key) continue;
    const r = await getJson('https://ollama.com/v1/models', key);
    const ok = r.http === 200;
    ollamaCloud.push({ credential: name, ok });
    probes.push({ provider: 'ollama-cloud', credential: name, status: ok ? 'ok' : r.http === 401 ? 'unauthorized' : 'error', detail: `http=${r.http}` });
  }

  // 4) DeepSeek: documented balance endpoint (no inference cost)
  let deepseek: PoolProbeResult | null = null;
  if (env.DEEPSEEK_API_KEY) {
    const r = await getJson('https://api.deepseek.com/user/balance', env.DEEPSEEK_API_KEY);
    if (r.http === 200) {
      const bal = (r.body as any)?.balance_infos?.[0]?.total_balance;
      deepseek = { provider: 'deepseek', credential: 'DEEPSEEK_API_KEY', status: 'ok', detail: `balance=${bal ?? '?'}` };
    } else {
      deepseek = { provider: 'deepseek', credential: 'DEEPSEEK_API_KEY', status: r.http === 402 ? 'payment_required' : r.http === 401 ? 'unauthorized' : 'error', detail: `http=${r.http}` };
    }
    probes.push(deepseek);
  }

  const state: PoolState = {
    checkedAt: new Date().toISOString(),
    oxAlphaActiveKeys,
    zenFreeOnlyKeys,
    openrouter,
    deepseek,
    ollamaCloud,
    probes,
  };

  // Persist: machine state + brain-state mirror (.draymond is append-friendly
  // snapshot; this file is owned by the pool_health job itself).
  const root = repoRoot();
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'pool-health.json'), JSON.stringify(state, null, 2));
  try {
    const drayDir = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(root, '.draymond');
    fs.mkdirSync(drayDir, { recursive: true });
    fs.writeFileSync(
      path.join(drayDir, 'pool-health.json'),
      JSON.stringify({
        checkedAt: state.checkedAt,
        summary: {
          oxAlphaActive: oxAlphaActiveKeys.length,
          zenFreeOnly: zenFreeOnlyKeys.length,
          openrouter: openrouter?.status ?? 'absent',
          deepseek: deepseek?.status ?? 'absent',
          ollamaAlive: ollamaCloud.filter((o) => o.ok).length + '/' + ollamaCloud.length,
        },
        probes,
      }, null, 2)
    );
  } catch { /* brain-state write is best-effort */ }

  // 5) Regenerate litellm.yaml to match live entitlements; restart on change.
  // Overflow model ids live in .env.local/litellm.env (not process env).
  if (!process.env.OPENROUTER_FREE_LITELLM_MODEL && env['OPENROUTER_FREE_LITELLM_MODEL']) {
    process.env.OPENROUTER_FREE_LITELLM_MODEL = env['OPENROUTER_FREE_LITELLM_MODEL'];
  }
  if (!process.env.OLLAMA_CLOUD_LITELLM_MODEL && env['OLLAMA_CLOUD_LITELLM_MODEL']) {
    process.env.OLLAMA_CLOUD_LITELLM_MODEL = env['OLLAMA_CLOUD_LITELLM_MODEL'];
  }
  const yamlPath = path.join(root, 'litellm.yaml');
  const next = buildLitellmConfig(state);
  let changed = false;
  if (fs.existsSync(yamlPath)) {
    changed = fs.readFileSync(yamlPath, 'utf8') !== next;
  } else {
    changed = true;
  }
  if (changed) {
    const tmp = `${yamlPath}.tmp`;
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, yamlPath);
    if (opts.restartLitellm !== false) {
      await new Promise<void>((resolve) => {
        exec('pm2 restart litellm --update-env', { windowsHide: true, timeout: 30_000 }, () => resolve());
      });
    }
  }

  return state;
}

// ── deterministic config builder (pure — unit tested) ───────────────────────

export function buildLitellmConfig(state: Pick<PoolState, 'oxAlphaActiveKeys' | 'zenFreeOnlyKeys'>): string {
  // NOTE: model ids verified against https://opencode.ai/docs/zen/
  // (Ox Alpha Free, Hy3 Free, Muse Spark 1.2 Contributor Free).
  const lines: string[] = [];
  lines.push('# LiteLLM proxy config — GENERATED by src/lib/draymond/pool-health.ts');
  lines.push(`# Generated: ${new Date().toISOString()} from the latest KeyWire-vault pool health run.`);
  lines.push('# Edit scripts/template instead of this file — it is overwritten each morning.');
  lines.push('model_list:');

  // Primary: ox-alpha-free ONLY on entitled (active Go) accounts.
  // Wire name stays `ox-alpha-free` for fleet compatibility; upstream model
  // id is the current Zen id (x-preview-f-free).
  for (const k of state.oxAlphaActiveKeys) {
    lines.push(`  - model_name: ox-alpha-free`);
    lines.push(`    litellm_params:`);
    lines.push(`      model: openai/${OX_ALPHA_MODEL_ID}`);
    lines.push(`      api_key: os.environ/${k}`);
    lines.push(`      api_base: https://opencode.ai/zen/v1`);
  }
  // Zen free promo pool: every non-active-but-valid account, two models.
  for (const k of [...state.zenFreeOnlyKeys, ...state.oxAlphaActiveKeys]) {
    for (const m of ['hy3-free', 'muse-spark-1.2-contributor-free']) {
      lines.push(`  - model_name: zen-free`);
      lines.push(`    litellm_params:`);
      lines.push(`      model: openai/${m}`);
      lines.push(`      api_key: os.environ/${k}`);
      lines.push(`      api_base: https://opencode.ai/zen/v1`);
    }
  }
  // Alias kept wire-compatible for older callers.
  for (const k of state.oxAlphaActiveKeys.slice(0, 1)) {
    lines.push(`  - model_name: opencode-free`);
    lines.push(`    litellm_params:`);
    lines.push(`      model: openai/${OX_ALPHA_MODEL_ID}`);
    lines.push(`      api_key: os.environ/${k}`);
    lines.push(`      api_base: https://opencode.ai/zen/v1`);
  }
  // Overflow pools: OpenRouter free variants + Ollama Cloud. Model ids come
  // from env so they can be updated without code changes:
  //   OPENROUTER_FREE_LITELLM_MODEL=openrouter/<model>:free
  //   OLLAMA_CLOUD_LITELLM_MODEL=openai/<cloud-model>
  if (process.env.OPENROUTER_FREE_LITELLM_MODEL) {
    lines.push(`  - model_name: openrouter-free`);
    lines.push(`    litellm_params:`);
    lines.push(`      model: ${JSON.stringify(process.env.OPENROUTER_FREE_LITELLM_MODEL)}`);
    lines.push(`      api_key: os.environ/OPENROUTER_API_KEY`);
  }
  if (process.env.OLLAMA_CLOUD_LITELLM_MODEL) {
    for (const k of [
      'OLLAMA_KEY_PRIMARY', 'OLLAMA_KEY_TAP919BEATS', 'OLLAMA_KEY_TAP4500',
      'OLLAMA_KEY_NCSOUND919', 'OLLAMA_KEY_JOHNREDD888', 'OLLAMA_KEY_NCSOUND_ALT',
    ]) {
      lines.push(`  - model_name: ollama-cloud`);
      lines.push(`    litellm_params:`);
      lines.push(`      model: ${JSON.stringify(process.env.OLLAMA_CLOUD_LITELLM_MODEL)}`);
      lines.push(`      api_key: os.environ/${k}`);
      lines.push(`      api_base: https://ollama.com/v1`);
    }
  }
  // Paid chain (unchanged): deepseek direct -> opencode Go tier insurance.
  lines.push(`  - model_name: deepseek`);
  lines.push(`    litellm_params:`);
  lines.push(`      model: deepseek/deepseek-chat`);
  lines.push(`      api_key: os.environ/DEEPSEEK_API_KEY`);
  lines.push(`  - model_name: opencode`);
  lines.push(`    litellm_params:`);
  lines.push(`      model: openai/deepseek-v4-flash`);
  lines.push(`      api_key: os.environ/OPENCODE_API_KEY`);
  lines.push(`      api_base: https://opencode.ai/zen/go/v1`);
  lines.push(`  - model_name: dsh-ox-alpha-free`);
  lines.push(`    litellm_params:`);
  lines.push(`      model: openai/ox-alpha-free`);
  lines.push(`      api_key: os.environ/OPENCODE_API_KEY`);
  lines.push(`      api_base: http://localhost:3080/v1`);
  lines.push('');
  lines.push('router_settings:');
  lines.push('  cooldown_time: 600');
  lines.push('  allowed_fails: 2');
  lines.push('  num_retries: 2');
  lines.push('  fallbacks:');
  lines.push('    - ox-alpha-free: ["opencode-free", "deepseek"]');
  lines.push('    - opencode-free: ["zen-free", "deepseek"]');
  lines.push('    - zen-free: ["deepseek"]');
  lines.push('');
  lines.push('general_settings:');
  lines.push('  master_key: os.environ/LITELLM_MASTER_KEY');
  lines.push('  database_url: null');
  lines.push('  drop_params: true');
  lines.push('');
  lines.push('litellm_settings:');
  lines.push('  drop_params: true');
  lines.push('  set_verbose: false');
  return lines.join('\n') + '\n';
}

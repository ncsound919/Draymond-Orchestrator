// ============================================================================
// DRAYMOND POOL HEALTH — daily LLM free-account entitlement check
// ============================================================================
// Probes every pooled LLM credential (opencode Zen accounts, OpenRouter, Ollama
// Cloud, DeepSeek), classifies which accounts may serve which FREE models TODAY,
// persists the result to data/pool-health.json + .draymond/pool-health.json, and
// regenerates litellm.yaml so routing always matches live entitlements:
//
//   - opencode key that answers muse-spark-1.2-contributor-free -> routed into
//     the `opencode-free` pool (the ecosystem primary free model)
//   - opencode key valid on any zen free model -> routed to the `zen-free` pool
//   - dead upstream keys -> dropped from pools entirely
//
// Free model ids rotate upstream — the probe list below is the current set and
// should track the opencode Zen catalog (https://opencode.ai/zen/v1/models).
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
  museFreeActiveKeys: string[];          // env var names entitled to the primary free model
  freeActiveKeys: string[];              // env var names valid on ≥1 zen free model
  freeModelAvailability: Record<string, string[]>; // model id -> env var names that serve it
  openrouter: PoolProbeResult | null;
  deepseek: PoolProbeResult | null;
  ollamaCloud: { credential: string; ok: boolean }[];
  probes: PoolProbeResult[];
}

// Current Zen free models (opencode.ai/zen/v1/models). Ordered — primary first.
// muse is the current assignee; upstream rotates these, keep in sync.
const FREE_MODELS = [
  'muse-spark-1.2-contributor-free',
  'hy3-free',
  'mimo-v2.5-free',
  'big-pickle',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free',
];
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
  'OPENCODE_KEY_TAP919BEATS', 'OPENCODE_KEY_NCSOUND919', 'OPENCODE_KEY_TAP4500',
  'OPENCODE_API_KEY', 'OPENCODE_KEY_JOHNREDD', // johnredd last — operator's personal account
];
const OLLAMA_KEYS = [
  'OLLAMA_KEY_PRIMARY', 'OLLAMA_KEY_TAP919BEATS', 'OLLAMA_KEY_TAP4500',
  'OLLAMA_KEY_NCSOUND919', 'OLLAMA_KEY_JOHNREDD888', 'OLLAMA_KEY_NCSOUND_ALT',
];

// ── probe matrix ─────────────────────────────────────────────────────────────

export async function runPoolHealth(opts: { restartLitellm?: boolean } = {}): Promise<PoolState> {
  const env = loadEnvMap();
  const probes: PoolProbeResult[] = [];
  const museFreeActiveKeys: string[] = [];
  const freeActiveKeys: string[] = [];
  const freeModelAvailability: Record<string, string[]> = {};
  for (const m of FREE_MODELS) freeModelAvailability[m] = [];

  // 1) opencode accounts: which free models may each account serve today?
  for (const name of OPENCODE_KEYS) {
    const key = env[name];
    if (!key) continue;
    const serving: string[] = [];
    let anyOk = false;
    for (const m of FREE_MODELS) {
      const r = await postChat('https://opencode.ai/zen/v1/chat/completions', key, m);
      // 200 or 429 both prove entitlement (429 = valid key, quota window busy)
      if (r.ok || r.http === 429) {
        serving.push(m);
        freeModelAvailability[m].push(name);
        anyOk = true;
      }
    }
    if (serving.length > 0) {
      freeActiveKeys.push(name);
      probes.push({ provider: 'opencode', credential: name, status: 'ok', models: serving });
    } else {
      probes.push({ provider: 'opencode', credential: name, status: 'error', detail: 'no free model entitled' });
    }
    if (serving.includes(FREE_MODELS[0])) museFreeActiveKeys.push(name);
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
    museFreeActiveKeys,
    freeActiveKeys,
    freeModelAvailability,
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
          museFreeActive: museFreeActiveKeys.length,
          freeActive: freeActiveKeys.length,
          freeModelAvailability,
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

export function buildLitellmConfig(state: Pick<PoolState, 'museFreeActiveKeys' | 'freeActiveKeys'>): string {
  // NOTE: model ids verified against https://opencode.ai/docs/zen/
  // (Muse Spark 1.2 Contributor Free, Hy3 Free, MiMo-V2.5 Free, Big Pickle,
  //  Nemotron 3 Ultra Free, Nemotron 3.5 Lightning Free). Free ids rotate —
  // keep in sync with the Zen catalog probe list above.
  const lines: string[] = [];
  lines.push('# LiteLLM proxy config — GENERATED by src/lib/draymond/pool-health.ts');
  lines.push(`# Generated: ${new Date().toISOString()} from the latest KeyWire-vault pool health run.`);
  lines.push('# Edit scripts/template instead of this file — it is overwritten each morning.');
  lines.push('model_list:');

  // Primary free pool: muse (current assignee) on accounts entitled to it.
  for (const k of state.museFreeActiveKeys) {
    lines.push(`  - model_name: opencode-free`);
    lines.push(`    litellm_params:`);
    lines.push(`      model: openai/${FREE_MODELS[0]}`);
    lines.push(`      api_key: os.environ/${k}`);
    lines.push(`      api_base: https://opencode.ai/zen/v1`);
  }
  // Zen free pool: every valid account × every current free model.
  for (const k of state.freeActiveKeys) {
    for (const m of FREE_MODELS) {
      lines.push(`  - model_name: zen-free`);
      lines.push(`    litellm_params:`);
      lines.push(`      model: openai/${m}`);
      lines.push(`      api_key: os.environ/${k}`);
      lines.push(`      api_base: https://opencode.ai/zen/v1`);
    }
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
  lines.push('');
  lines.push('router_settings:');
  lines.push('  cooldown_time: 600');
  lines.push('  allowed_fails: 2');
  lines.push('  num_retries: 2');
  lines.push('  fallbacks:');
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

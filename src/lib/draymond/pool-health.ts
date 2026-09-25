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

// Uplift workspace root — resolved independently of cwd so generated paths
// (e.g. the MCP OpenAPI spec) never point outside the repo.
function upliftRoot(): string {
  const env = process.env.UPLIFT_ROOT;
  if (env && fs.existsSync(path.join(env, 'ecosystem'))) return env;
  let dir = repoRoot();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'ecosystem'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(repoRoot(), '..');
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
  assignedFreeModel: string;             // daily catalog winner (.draymond/model-routing.json)
  museFreeActiveKeys: string[];          // env var names entitled to the ASSIGNED free model
  freeActiveKeys: string[];              // env var names valid on ≥1 zen free model
  freeModelAvailability: Record<string, string[]>; // model id -> env var names that serve it
  /** Overflow lane ids promoted from env (absent = group omitted from yaml). */
  openrouterFreeModel?: string;
  ollamaCloudModel?: string;
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

/** Strip a UTF-8 BOM — PowerShell writers emit one and JSON.parse chokes. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Read the daily-assigned free model (fail-soft → bootstrap list head). */
function readAssignedFreeModel(): string {
  try {
    const drayDir = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(repoRoot(), '.draymond');
    const raw = JSON.parse(stripBom(fs.readFileSync(path.join(drayDir, 'model-routing.json'), 'utf8')));
    if (typeof raw.assignedFreeModel === 'string' && raw.assignedFreeModel) return raw.assignedFreeModel;
  } catch { /* absent — fall through */ }
  return FREE_MODELS[0];
}

// -- env loading (data/litellm.env first = freshest vault sync, then .env.local)

function loadEnvMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const root = repoRoot();
  // PRECEDENCE: .env.local first (operator-managed truth, matches runtime
  // injection); litellm.env (vault projection) fills in keys absent there.
  for (const rel of ['.env.local', 'data/litellm.env']) {
    const p = /*turbopackIgnore: true*/ path.join(root, rel);
    if (!/*turbopackIgnore: true*/ fs.existsSync(p)) continue;
    for (const line of /*turbopackIgnore: true*/ fs.readFileSync(p, 'utf8').split('\n')) {
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

// -- probe matrix -------------------------------------------------------------

export async function runPoolHealth(opts: { restartLitellm?: boolean } = {}): Promise<PoolState> {
  const env = loadEnvMap();
  const probes: PoolProbeResult[] = [];
  const museFreeActiveKeys: string[] = [];
  const freeActiveKeys: string[] = [];
  const freeModelAvailability: Record<string, string[]> = {};
  // Probe the daily-assigned model FIRST (it leads the generated pools); the
  // hardcoded list trails so stale ids rot out of litellm.yaml automatically.
  const assigned = readAssignedFreeModel();
  const probeModels = [assigned, ...FREE_MODELS.filter((m) => m !== assigned)];
  for (const m of probeModels) freeModelAvailability[m] = [];

  // 1) opencode accounts: which free models may each account serve today?
  for (const name of OPENCODE_KEYS) {
    const key = env[name];
    if (!key) continue;
    const serving: string[] = [];
    for (const m of probeModels) {
      const r = await postChat('https://opencode.ai/zen/v1/chat/completions', key, m);
      // 200 or 429 both prove entitlement (429 = valid key, quota window busy)
      if (r.ok || r.http === 429) {
        serving.push(m);
        freeModelAvailability[m].push(name);
      }
    }
    if (serving.length > 0) {
      freeActiveKeys.push(name);
      probes.push({ provider: 'opencode', credential: name, status: 'ok', models: serving });
    } else {
      probes.push({ provider: 'opencode', credential: name, status: 'error', detail: 'no free model entitled' });
    }
    if (serving.includes(assigned)) museFreeActiveKeys.push(name);
  }

  // 2) OpenRouter: balance/key status without burning a request
  let openrouter: PoolProbeResult | null = null;
  if (env.OPENROUTER_API_KEY) {
    const r = await getJson('https://openrouter.ai/api/v1/key', env.OPENROUTER_API_KEY);
    const data = (r.body as { data?: { is_free_tier?: boolean } } | undefined)?.data;
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

  // 3) Ollama Cloud: real chat ping — /models is a public catalog and 200s
  // even for revoked keys, which masked dead accounts for weeks.
  const ollamaModel = (process.env.OLLAMA_CLOUD_LITELLM_MODEL || 'openai/gpt-oss:20b').replace(/^openai\//, '');
  const ollamaCloud: { credential: string; ok: boolean }[] = [];
  for (const name of OLLAMA_KEYS) {
    const key = env[name];
    if (!key) continue;
    const r = await postChat('https://ollama.com/v1/chat/completions', key, ollamaModel);
    const ok = r.ok;
    ollamaCloud.push({ credential: name, ok });
    probes.push({ provider: 'ollama-cloud', credential: name, status: ok ? 'ok' : r.http === 401 ? 'unauthorized' : 'error', detail: `http=${r.http}` });
  }

  // 4) DeepSeek: documented balance endpoint (no inference cost)
  let deepseek: PoolProbeResult | null = null;
  if (env.DEEPSEEK_API_KEY) {
    const r = await getJson('https://api.deepseek.com/user/balance', env.DEEPSEEK_API_KEY);
    if (r.http === 200) {
      const bal = (r.body as { balance_infos?: Array<{ total_balance?: string | number }> } | undefined)?.balance_infos?.[0]?.total_balance;
      deepseek = { provider: 'deepseek', credential: 'DEEPSEEK_API_KEY', status: 'ok', detail: `balance=${bal ?? '?'}` };
    } else {
      deepseek = { provider: 'deepseek', credential: 'DEEPSEEK_API_KEY', status: r.http === 402 ? 'payment_required' : r.http === 401 ? 'unauthorized' : 'error', detail: `http=${r.http}` };
    }
    probes.push(deepseek);
  }

  const state: PoolState = {
    checkedAt: new Date().toISOString(),
    assignedFreeModel: assigned,
    museFreeActiveKeys,
    freeActiveKeys,
    freeModelAvailability,
    openrouterFreeModel: process.env.OPENROUTER_FREE_LITELLM_MODEL,
    ollamaCloudModel: process.env.OLLAMA_CLOUD_LITELLM_MODEL,
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

// -- deterministic config builder (pure — unit tested) -----------------------

export function buildLitellmConfig(
  state: Pick<
    PoolState,
    | 'assignedFreeModel'
    | 'museFreeActiveKeys'
    | 'freeActiveKeys'
    | 'freeModelAvailability'
    | 'openrouterFreeModel'
    | 'ollamaCloudModel'
    | 'ollamaCloud'
  >
): string {
  // NOTE: model ids verified against https://opencode.ai/docs/zen/
  // (Muse Spark 1.2 Contributor Free, Hy3 Free, MiMo-V2.5 Free, Big Pickle,
  //  Nemotron 3 Ultra Free, Nemotron 3.5 Lightning Free). Free ids rotate —
  // keep in sync with the Zen catalog probe list above.
  const assigned = state.assignedFreeModel || FREE_MODELS[0];
  const lines: string[] = [];
  lines.push('# LiteLLM proxy config — GENERATED by src/lib/draymond/pool-health.ts');
  lines.push(`# Generated: ${new Date().toISOString()} from the latest KeyWire-vault pool health run.`);
  lines.push('# Edit scripts/template instead of this file — it is overwritten each morning.');
  lines.push('model_list:');

  // STABLE EDGE GROUP: `fleet-free` is the one name downstream consumers (DSH
  // harness adapter, hooks) point at. It always maps to the current daily-
  // assigned free model across every entitled account — rotation happens HERE,
  // never in DSH/patch files again.
  for (const k of state.museFreeActiveKeys.length > 0 ? state.museFreeActiveKeys : state.freeActiveKeys) {
    lines.push(`  - model_name: fleet-free`);
    lines.push(`    litellm_params:`);
    lines.push(`      model: openai/${assigned}`);
    lines.push(`      api_key: os.environ/${k}`);
    lines.push(`      api_base: https://opencode.ai/zen/v1`);
  }
  // Legacy alias kept for backwards compatibility (llm.ts chain / old calls).
  for (const k of state.museFreeActiveKeys) {
    lines.push(`  - model_name: opencode-free`);
    lines.push(`    litellm_params:`);
    lines.push(`      model: openai/${assigned}`);
    lines.push(`      api_key: os.environ/${k}`);
    lines.push(`      api_base: https://opencode.ai/zen/v1`);
  }
  // Zen free pool: every valid account × every model with ≥1 live entitlement
  // (assigned always leads). Availability-gated so rotated-away ids (e.g. a
  // dead muse-spark) never enter the pool and burn router retries.
  const poolModels = [
    assigned,
    ...Object.keys(state.freeModelAvailability ?? {}).filter(
      (m) => m !== assigned && (state.freeModelAvailability[m]?.length ?? 0) > 0
    ),
  ];
  for (const k of state.freeActiveKeys) {
    for (const m of poolModels) {
      lines.push(`  - model_name: zen-free`);
      lines.push(`    litellm_params:`);
      lines.push(`      model: openai/${m}`);
      lines.push(`      api_key: os.environ/${k}`);
      lines.push(`      api_base: https://opencode.ai/zen/v1`);
    }
  }
  // Overflow pools: OpenRouter free variants + Ollama Cloud. Model ids come
  // from state (promoted from env during the run) with an env fallback so a
  // bare buildLitellmConfig call still emits the groups.
  const orModel = state.openrouterFreeModel ?? process.env.OPENROUTER_FREE_LITELLM_MODEL;
  const ocModel = state.ollamaCloudModel ?? process.env.OLLAMA_CLOUD_LITELLM_MODEL;
  if (orModel) {
    lines.push(`  - model_name: openrouter-free`);
    lines.push(`    litellm_params:`);
    lines.push(`      model: ${JSON.stringify(orModel)}`);
    lines.push(`      api_key: os.environ/OPENROUTER_API_KEY`);
  }
  if (ocModel) {
    // Only keys that probed OK enter the pool — dead/rotated keys otherwise burn
    // router retries (operator: only 4 of the 6 Ollama keys actually work).
    const liveOllamaKeys = (state.ollamaCloud ?? []).filter((o) => o.ok).map((o) => o.credential);
    const ollamaKeys = liveOllamaKeys.length ? liveOllamaKeys : [
      'OLLAMA_KEY_PRIMARY', 'OLLAMA_KEY_TAP919BEATS', 'OLLAMA_KEY_TAP4500',
      'OLLAMA_KEY_NCSOUND919', 'OLLAMA_KEY_JOHNREDD888', 'OLLAMA_KEY_NCSOUND_ALT',
    ];
    for (const k of ollamaKeys) {
      lines.push(`  - model_name: ollama-cloud`);
      lines.push(`    litellm_params:`);
      lines.push(`      model: ${JSON.stringify(ocModel)}`);
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
  // Vision: DeepSeek's `deepseek-flash` (DeepSeek-V4.1-Flash) is the supported
  // vision model — the legacy deepseek-v4-flash-vision-exp is retired and served
  // by V4.1-Flash. DeepSeek direct (funded); OpenRouter is NOT required.
  lines.push(`  - model_name: deepseek-vision`);
  lines.push(`    litellm_params:`);
  lines.push(`      model: deepseek/deepseek-flash`);
  lines.push(`      api_key: os.environ/DEEPSEEK_API_KEY`);
  // Terminal fallback: the small LOCAL model (llama.cpp lane, no key). Free →
  // paid → local, per operator decision 2026-09-25.
  lines.push(`  - model_name: local`);
  lines.push(`    litellm_params:`);
  lines.push(`      model: openai/${process.env.LOCAL_LLM_MODEL || 'minicpm5-fable'}`);
  lines.push(`      api_base: ${process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434'}/v1`);
  lines.push(`      api_key: "not-needed"`);
  lines.push('');
  lines.push('router_settings:');
  lines.push('  cooldown_time: 600');
  lines.push('  allowed_fails: 2');
  lines.push('  num_retries: 2');
  lines.push('  fallbacks:');
  // Wanted order (locked plan 2026-09-22): opencode (Go tier) → deepseek
  // (direct) → ollama-cloud (Keywire) → openrouter-free. Deepseek must precede
  // ollama-cloud in every chain so free pools fall to the paid direct lane
  // before the Keywire lane.
  lines.push('    - fleet-free: ["deepseek", "ollama-cloud", "openrouter-free", "local"]');
  lines.push('    - opencode-free: ["fleet-free", "zen-free", "deepseek", "ollama-cloud", "local"]');
  lines.push('    - zen-free: ["deepseek", "ollama-cloud", "openrouter-free", "local"]');
  lines.push('    - deepseek: ["opencode", "ollama-cloud", "local"]');
  lines.push('    - opencode: ["deepseek", "ollama-cloud", "local"]');
  lines.push('    - ollama-cloud: ["local"]');
  lines.push('    - openrouter-free: ["deepseek", "ollama-cloud", "local"]');
  lines.push('    - local: []');
  lines.push('');
  lines.push('general_settings:');
  lines.push('  master_key: os.environ/LITELLM_MASTER_KEY');
  // NOTE: no `database_url` key at all — setting it to null still makes newer
  // LiteLLM builds initialise the budget/spend client and 400 with
  // "No connected db" on proxied calls. Omit ⇒ in-memory only.
  lines.push('  drop_params: true');
  lines.push('');
  lines.push('litellm_settings:');
  lines.push('  drop_params: true');
  lines.push('  set_verbose: false');
  // MCP Gateway: expose the Ecosystem Control Center's READ-ONLY control API as
  // MCP tools (OpenAPI→tools). spec_path is a local file (no SSRF round-trip);
  // the service token must be present in the Keywire vault / env.
  lines.push('');
  lines.push('mcp_servers:');
  lines.push('  ecosystem_control:');
  lines.push('    url: "http://127.0.0.1:3080"');
  {
    const specPath = path.join(upliftRoot(), 'ecosystem', 'control-api.openapi.json');
    if (!fs.existsSync(specPath)) {
      console.warn(`[pool-health] WARNING: MCP OpenAPI spec not found at ${specPath}; mcp_servers.ecosystem_control will expose no tools until it exists.`);
    }
    lines.push(`    spec_path: ${JSON.stringify(specPath)}`);
  }
  lines.push('    auth_type: "api_key"');
  lines.push('    auth_value: os.environ/ECOSYSTEM_CONTROL_TOKEN');
  lines.push('    description: "Overlay365/Uplift ecosystem control (read-only): fleet status, health, history, models."');
  lines.push('    allowed_tools:');
  lines.push('      - get_fleet_status');
  lines.push('      - get_monitor');
  lines.push('      - get_history');
  lines.push('      - get_models');
  return lines.join('\n') + '\n';
}

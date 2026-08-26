// ============================================================================
// DRAYMOND — Free Catalog Sync
// ============================================================================
// Daily batch job that probes openrouter + opencode free-tier endpoints,
// validates each candidate (cheap chat/completions with max_tokens=5), and
// persists the winner to .draymond/model-routing.json as `assignedFreeModel`.
//
// Anti-patterns avoided:
//   - Never polls in the hot call path (batch-only, called by daily cron).
//   - Handles the thinking-model empty-content trap (marks ineligible).
//   - Feature-flagged: FREE_CATALOG_SYNC=0 returns last cached mapping.
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CatalogCandidate {
  id: string;
  source: 'openrouter' | 'opencode';
  latencyMs: number;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface FreeCatalogResult {
  assignedModel: string;
  latencyMs: number;
  probed: number;
  eligible: number;
  candidates: CatalogCandidate[];
  syncedAt: string;
  dryRun?: boolean;
}

const PROBE_TIMEOUT_MS = 10_000;
const MAX_CANDIDATES = 8;

function registryDir(): string {
  return (
    process.env.DRAYMOND_REGISTRY_DIR ??
    join(process.cwd(), '.draymond')
  );
}

/** Read .draymond/model-routing.json (fail-soft: empty object when absent). */
function readRouting(): Record<string, unknown> {
  try {
    const p = join(registryDir(), 'model-routing.json');
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Persist assignedFreeModel + freeModelList + syncedAt to model-routing.json (read→merge→write). */
function persistAssignment(
  model: string,
  freeModels: string[],
  syncedAt: string,
  dryRun: boolean
): void {
  if (dryRun) return;
  const p = join(registryDir(), 'model-routing.json');
  const current = readRouting();
  const updated = {
    ...current,
    assignedFreeModel: model,
    freeModelList: freeModels,
    lastFreeSyncAt: syncedAt,
    // Keywire vault pool — kept in the catalog so runtimes read accounts + models
    // from one place. Preserve anything the operator already declared.
    opencodeKeyPool:
      Array.isArray(current.opencodeKeyPool) && (current.opencodeKeyPool as unknown[]).length
        ? current.opencodeKeyPool
        : [
            'OPENCODE_KEY_TAP919BEATS',
            'OPENCODE_KEY_NCSOUND919',
            'OPENCODE_KEY_TAP4500',
            'OPENCODE_API_KEY',
            'OPENCODE_KEY_JOHNREDD',
          ],
  };
  writeFileSync(p, JSON.stringify(updated, null, 2), 'utf8');
}

/** Probe a single candidate with a cheap completion call. Returns latencyMs and eligibility. */
async function probeCandidate(
  id: string,
  baseURL: string,
  apiKey: string
): Promise<{ latencyMs: number; eligible: boolean; reason?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: id,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { latencyMs, eligible: false, reason: `HTTP ${res.status}: ${txt.slice(0, 80)}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content ?? '';
    // Thinking-model empty-content trap: content is empty but reasoning_content is present
    if (!content) {
      const hasReasoning = !!(data as Record<string, unknown>).reasoning_content ||
        !!(choices?.[0] as Record<string, unknown> | undefined)?.reasoning_content;
      const reason = hasReasoning
        ? 'thinking-model trap: empty content with reasoning_content (max_tokens too small)'
        : 'empty content response';
      return { latencyMs, eligible: false, reason };
    }
    return { latencyMs, eligible: true };
  } catch (err) {
    clearTimeout(timer);
    return {
      latencyMs: Date.now() - t0,
      eligible: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Fetch free model IDs from openrouter catalog. */
async function fetchOpenRouterFree(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string; pricing?: { prompt?: string } }> };
    return (data.data ?? [])
      .filter(
        (m) =>
          (typeof m.id === 'string' && m.id.endsWith('-free')) ||
          m.pricing?.prompt === '0' ||
          m.pricing?.prompt === '0.0'
      )
      .map((m) => m.id as string)
      .filter(Boolean)
      .slice(0, MAX_CANDIDATES);
  } catch {
    return [];
  }
}

/** Fetch free model IDs from opencode zen/v1 catalog. */
async function fetchOpenCodeFree(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://opencode.ai/zen/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? [])
      .filter((m) => {
        const id = typeof m.id === 'string' ? m.id : '';
        // Free ids end in `-free` (big-pickle is the one exception). Never
        // anchor to a specific retired model like ox-alpha-free.
        return id.endsWith('-free') || id === 'big-pickle';
      })
      .map((m) => m.id as string)
      .filter(Boolean)
      .slice(0, MAX_CANDIDATES);
  } catch {
    return [];
  }
}

/**
 * Run the free catalog sync.
 * @param dryRun When true, probes and scores but does NOT write to disk.
 */
export async function runFreeCatalogSync(
  opts: { dryRun?: boolean } = {}
): Promise<FreeCatalogResult> {
  const dryRun = opts.dryRun ?? false;
  const syncedAt = new Date().toISOString();

  // Feature flag
  if (process.env.FREE_CATALOG_SYNC === '0') {
    const cached = (readRouting().assignedFreeModel as string | undefined) ?? 'muse-spark-1.2-contributor-free';
    return {
      assignedModel: cached,
      latencyMs: 0,
      probed: 0,
      eligible: 0,
      candidates: [],
      syncedAt,
      dryRun,
    };
  }

  const opencodeKey = process.env.OPENCODE_API_KEY ?? '';
  const openrouterKey = process.env.OPENROUTER_API_KEY ?? '';

  // Collect candidates from both sources
  const [openrouterIds, opencodeIds] = await Promise.all([
    openrouterKey ? fetchOpenRouterFree(openrouterKey) : Promise.resolve([]),
    opencodeKey ? fetchOpenCodeFree(opencodeKey) : Promise.resolve([]),
  ]);

  // Deduplicate; opencode (current primary) candidates first
  const seen = new Set<string>();
  const allIds: Array<{ id: string; source: 'openrouter' | 'opencode' }> = [];
  for (const id of opencodeIds) {
    if (!seen.has(id)) { seen.add(id); allIds.push({ id, source: 'opencode' }); }
  }
  for (const id of openrouterIds) {
    if (!seen.has(id)) { seen.add(id); allIds.push({ id, source: 'openrouter' }); }
  }

  // Probe each candidate
  const probed: CatalogCandidate[] = await Promise.all(
    allIds.slice(0, MAX_CANDIDATES).map(async ({ id, source }) => {
      const baseURL = source === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : 'https://opencode.ai/zen/v1';
      const apiKey = source === 'openrouter' ? openrouterKey : opencodeKey;
      const { latencyMs, eligible, reason } = await probeCandidate(id, baseURL, apiKey);
      const candidate: CatalogCandidate = { id, source, latencyMs, eligible };
      if (reason) candidate.ineligibleReason = reason;
      return candidate;
    })
  );

  const eligible = probed.filter((c) => c.eligible);
  eligible.sort((a, b) => a.latencyMs - b.latencyMs);

  // Ordered free-model list for the catalog: eligible models, assigned (first
  // eligible) prioritized, opencode candidates before openrouter.
  const orderedList = [
    ...eligible
      .filter((c) => c.source === 'opencode')
      .map((c) => c.id),
    ...eligible
      .filter((c) => c.source === 'openrouter')
      .map((c) => c.id),
  ];

  // Pick winner: lowest latency eligible candidate, else last known assignment
  const fallbackDefault = 'muse-spark-1.2-contributor-free';
  const winner = eligible[0]?.id ?? (readRouting().assignedFreeModel as string | undefined) ?? fallbackDefault;

  if (!dryRun) {
    persistAssignment(winner, orderedList, syncedAt, false);
  }

  console.info(`[freeCatalogSync] assigned=${winner} eligible=${eligible.length}/${probed.length} list=[${orderedList.join(', ')}] dryRun=${dryRun}`);

  return {
    assignedModel: winner,
    latencyMs: eligible[0]?.latencyMs ?? 0,
    probed: probed.length,
    eligible: eligible.length,
    candidates: probed,
    syncedAt,
    dryRun,
  };
}

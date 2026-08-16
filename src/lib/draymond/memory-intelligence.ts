// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Memory Intelligence
// ============================================================================
// Enhances the existing tiered memory system (index.ts §3) with:
//
// 1. Semantic search — find memories by meaning, not just key
// 2. Auto-decay sweeper — periodically reduce importance and expire stale memories
// 3. Cross-agent memory sharing — share memories between agents with permissions
// 4. Memory insights — analytics about memory usage per agent
//
// This module works alongside the existing storeMemory/retrieveMemories/boostMemory
// functions in index.ts — it does NOT replace them.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createDraymondClient } from './client';
import { logEvent } from './index';
import { readLearningStore } from './learning-store';
import type {
  DraymondMemory,
  MemorySearchResult,
  MemoryShareGrant,
  MemoryShareGrantInsert,
  MemoryDecayResult,
  MemoryInsight,
  MemoryTier,
} from './types';

// ── Semantic Memory Search ───────────────────────────────────────────────────

/**
 * Search memories using multiple strategies:
 * 1. Exact key match
 * 2. Summary substring match (simple semantic)
 * 3. Tag/value keyword match
 *
 * Results are ranked by relevance score.
 */
export async function searchMemories(
  agentId: string,
  userId: string,
  query: string,
  options: {
    limit?: number;
    include_expired?: boolean;
    min_importance?: number;
    tiers?: MemoryTier[];
  } = {}
): Promise<MemorySearchResult[]> {
  const supabase = await createDraymondClient();
  const limit = Math.min(options.limit ?? 20, 100);
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);
  // If all tokens are short, fall back to using the full query as a single term
  const effectiveTerms = queryTerms.length > 0 ? queryTerms : [queryLower];

  // Fetch candidate memories
  let dbQuery = supabase
    .from('draymond_memory')
    .select('*')
    .eq('agent_id', agentId)
    .eq('user_id', userId)
    .order('importance_score', { ascending: false })
    .limit(200); // Fetch more than needed for client-side ranking

  if (!options.include_expired) {
    dbQuery = dbQuery.eq('is_active', true);
  }

  if (options.min_importance !== undefined) {
    dbQuery = dbQuery.gte('importance_score', options.min_importance);
  }

  if (options.tiers && options.tiers.length > 0) {
    dbQuery = dbQuery.in('tier', options.tiers);
  }

  const { data, error } = await dbQuery;
  if (error) throw new Error(`Failed to search memories: ${error.message}`);

  const memories = (data || []) as DraymondMemory[];

  // Score and rank results
  const results: MemorySearchResult[] = [];

  for (const memory of memories) {
    const { score, matchType } = scoreMemory(memory, queryLower, effectiveTerms);

    if (score > 0) {
      results.push({
        memory,
        relevance_score: score,
        match_type: matchType,
      });
    }
  }

  // Sort by relevance score descending
  results.sort((a, b) => b.relevance_score - a.relevance_score);

  // Bump access timestamps for returned results
  const topResults = results.slice(0, limit);
  if (topResults.length > 0) {
    const ids = topResults.map((r) => r.memory.id);
    await supabase
      .from('draymond_memory')
      .update({ last_accessed_at: new Date().toISOString() })
      .in('id', ids)
      .then(() => {}); // Fire and forget
  }

  return topResults;
}

/**
 * Score a memory against a search query. Returns relevance score and match type.
 */
function scoreMemory(
  memory: DraymondMemory,
  queryLower: string,
  queryTerms: string[]
): { score: number; matchType: MemorySearchResult['match_type'] } {
  let bestScore = 0;
  let matchType: MemorySearchResult['match_type'] = 'summary';

  // 1. Exact key match (highest priority)
  if (memory.key.toLowerCase() === queryLower) {
    bestScore = 1.0;
    matchType = 'exact_key';
  } else if (memory.key.toLowerCase().includes(queryLower)) {
    bestScore = Math.max(bestScore, 0.8);
    matchType = 'exact_key';
  }

  // 2. Summary match
  if (memory.summary) {
    const summaryLower = memory.summary.toLowerCase();

    if (summaryLower.includes(queryLower)) {
      bestScore = Math.max(bestScore, 0.7);
      matchType = bestScore === 0.7 ? 'summary' : matchType;
    } else {
      // Term-by-term matching
      const matchingTerms = queryTerms.filter((t) => summaryLower.includes(t));
      if (matchingTerms.length > 0) {
        const termScore = 0.3 + (matchingTerms.length / queryTerms.length) * 0.4;
        if (termScore > bestScore) {
          bestScore = termScore;
          matchType = 'semantic';
        }
      }
    }
  }

  // 3. Value content match (search stringified value)
  const valueStr = JSON.stringify(memory.value).toLowerCase();
  if (valueStr.includes(queryLower)) {
    bestScore = Math.max(bestScore, 0.5);
    matchType = bestScore === 0.5 ? 'tag' : matchType;
  } else {
    const matchingTerms = queryTerms.filter((t) => valueStr.includes(t));
    if (matchingTerms.length > 0) {
      const termScore = 0.2 + (matchingTerms.length / queryTerms.length) * 0.3;
      if (termScore > bestScore) {
        bestScore = termScore;
        matchType = 'tag';
      }
    }
  }

  // 4. Key partial match
  const keyLower = memory.key.toLowerCase();
  const keyMatchTerms = queryTerms.filter((t) => keyLower.includes(t));
  if (keyMatchTerms.length > 0) {
    const keyScore = 0.4 + (keyMatchTerms.length / queryTerms.length) * 0.3;
    if (keyScore > bestScore) {
      bestScore = keyScore;
      matchType = 'exact_key';
    }
  }

  // Apply importance boost — higher importance memories rank slightly higher
  bestScore *= 0.7 + memory.importance_score * 0.3;

  return { score: Math.min(1, bestScore), matchType };
}

// ── Auto-Decay Sweeper ───────────────────────────────────────────────────────

/**
 * Run the memory decay sweep. Should be called periodically (e.g., every hour via scheduler).
 *
 * For each active memory:
 * - Reduce importance_score by its decay_rate
 * - If importance drops below threshold, mark as expired
 * - Core tier memories (decay_rate 0) are never decayed
 */
export async function runDecaySweep(): Promise<MemoryDecayResult> {
  const startMs = Date.now();
  const supabase = await createDraymondClient();

  // Fetch all active memories with non-zero decay rates
  const { data, error } = await supabase
    .from('draymond_memory')
    .select('id, importance_score, decay_rate, tier, last_accessed_at')
    .eq('is_active', true)
    .gt('decay_rate', 0);

  if (error) throw new Error(`Failed to fetch memories for decay: ${error.message}`);

  const memories = (data || []) as Array<{
    id: string;
    importance_score: number;
    decay_rate: number;
    tier: MemoryTier;
    last_accessed_at: string;
  }>;

  let decayed = 0;
  let expired = 0;
  let boosted = 0;

  const EXPIRY_THRESHOLD = 0.05;
  const RECENCY_BOOST_HOURS = 24;

  // Batch updates to avoid N+1 queries
  const boostUpdates: { id: string; importance_score: number }[] = [];
  const decayUpdates: { id: string; importance_score: number }[] = [];
  const expiryIds: string[] = [];

  for (const mem of memories) {
    // Check if memory was recently accessed — if so, boost instead of decay
    const hoursSinceAccess =
      (Date.now() - new Date(mem.last_accessed_at).getTime()) / (1000 * 60 * 60);

    if (hoursSinceAccess < RECENCY_BOOST_HOURS) {
      // Recently accessed — apply a small boost instead of decay
      const boostAmount = Math.min(0.05, mem.decay_rate * 0.5);
      const newImportance = Math.min(1.0, mem.importance_score + boostAmount);

      if (newImportance !== mem.importance_score) {
        boostUpdates.push({ id: mem.id, importance_score: newImportance });
        boosted++;
      }
      continue;
    }

    // Apply decay
    const newImportance = Math.max(0, mem.importance_score - mem.decay_rate);

    if (newImportance <= EXPIRY_THRESHOLD) {
      // Memory has decayed below threshold — expire it
      expiryIds.push(mem.id);
      expired++;
    } else {
      // Apply the decay
      decayUpdates.push({ id: mem.id, importance_score: Number(newImportance.toFixed(4)) });
      decayed++;
    }
  }

  // Execute batched updates
  // Boost updates (individual scores differ, must update per-row)
  for (const update of boostUpdates) {
    await supabase
      .from('draymond_memory')
      .update({ importance_score: update.importance_score })
      .eq('id', update.id);
  }

  // Expire in bulk
  if (expiryIds.length > 0) {
    await supabase
      .from('draymond_memory')
      .update({
        importance_score: 0,
        is_active: false,
        expired_at: new Date().toISOString(),
      })
      .in('id', expiryIds);
  }

  // Decay updates (individual scores differ, must update per-row)
  for (const update of decayUpdates) {
    await supabase
      .from('draymond_memory')
      .update({ importance_score: update.importance_score })
      .eq('id', update.id);
  }

  const result: MemoryDecayResult = {
    total_scanned: memories.length,
    decayed,
    expired,
    boosted,
    sweep_duration_ms: Date.now() - startMs,
    swept_at: new Date().toISOString(),
  };

  await logEvent({
    agent_id: 'draymond-memory',
    category: 'memory',
    severity: 'info',
    event_type: 'decay_sweep_completed',
    message: `Memory decay sweep: ${decayed} decayed, ${expired} expired, ${boosted} boosted (${memories.length} scanned in ${result.sweep_duration_ms}ms)`,
    metadata: result,
  }).catch(() => {});

  return result;
}

// ── Cross-Agent Memory Sharing ───────────────────────────────────────────────

/**
 * Grant another agent permission to access a specific memory.
 */
export async function grantMemoryAccess(
  input: MemoryShareGrantInsert
): Promise<MemoryShareGrant> {
  const supabase = await createDraymondClient();

  // Verify the memory exists and belongs to the owner
  const { data: memory } = await supabase
    .from('draymond_memory')
    .select('id, agent_id')
    .eq('id', input.memory_id)
    .eq('agent_id', input.owner_agent_id)
    .single();

  if (!memory) {
    throw new Error(
      `Memory ${input.memory_id} not found or not owned by agent ${input.owner_agent_id}`
    );
  }

  // Upsert the grant (update if already exists)
  const { data, error } = await supabase
    .from('draymond_memory_shares')
    .upsert(
      {
        memory_id: input.memory_id,
        owner_agent_id: input.owner_agent_id,
        granted_agent_id: input.granted_agent_id,
        permission: input.permission,
        granted_at: new Date().toISOString(),
        expires_at: input.expires_at ?? null,
        is_active: true,
      },
      {
        onConflict: 'memory_id,granted_agent_id',
        ignoreDuplicates: false,
      }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to grant memory access: ${error.message}`);

  await logEvent({
    agent_id: input.owner_agent_id,
    category: 'memory',
    severity: 'info',
    event_type: 'memory_shared',
    message: `Shared memory "${input.memory_id}" with agent ${input.granted_agent_id} (${input.permission})`,
    metadata: {
      memory_id: input.memory_id,
      granted_agent_id: input.granted_agent_id,
      permission: input.permission,
    },
  }).catch(() => {});

  return data as MemoryShareGrant;
}

/**
 * Retrieve shared memories from another agent.
 * Only returns memories where the requesting agent has an active grant.
 */
export async function getSharedMemories(
  requestingAgentId: string,
  userId: string,
  ownerAgentId?: string,
  limit: number = 20
): Promise<DraymondMemory[]> {
  const supabase = await createDraymondClient();

  // Get active grants for this agent
  let grantsQuery = supabase
    .from('draymond_memory_shares')
    .select('memory_id, permission')
    .eq('granted_agent_id', requestingAgentId)
    .eq('is_active', true);

  if (ownerAgentId) {
    grantsQuery = grantsQuery.eq('owner_agent_id', ownerAgentId);
  }

  const { data: grants, error: grantsError } = await grantsQuery;
  if (grantsError) throw new Error(`Failed to fetch memory grants: ${grantsError.message}`);
  if (!grants || grants.length === 0) return [];

  const memoryIds = (grants as Array<{ memory_id: string }>).map((g) => g.memory_id);

  // Fetch the actual memories — still filtered by userId for isolation
  const { data: memories, error: memError } = await supabase
    .from('draymond_memory')
    .select('*')
    .in('id', memoryIds)
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('importance_score', { ascending: false })
    .limit(limit);

  if (memError) throw new Error(`Failed to fetch shared memories: ${memError.message}`);
  return (memories || []) as DraymondMemory[];
}

/**
 * Revoke a memory share grant.
 */
export async function revokeMemoryAccess(
  memoryId: string,
  ownerAgentId: string,
  grantedAgentId: string
): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase
    .from('draymond_memory_shares')
    .update({ is_active: false })
    .eq('memory_id', memoryId)
    .eq('owner_agent_id', ownerAgentId)
    .eq('granted_agent_id', grantedAgentId);

  if (error) throw new Error(`Failed to revoke memory access: ${error.message}`);
}

// ── Memory Insights ──────────────────────────────────────────────────────────

/**
 * Get memory analytics for a specific agent.
 */
export async function getMemoryInsights(agentId: string): Promise<MemoryInsight> {
  const supabase = await createDraymondClient();

  // Fetch all memories for this agent
  const { data, error } = await supabase
    .from('draymond_memory')
    .select('id, tier, importance_score, is_active, access_count, key, created_at')
    .eq('agent_id', agentId);

  if (error) throw new Error(`Failed to fetch memory insights: ${error.message}`);

  const memories = (data || []) as Array<{
    id: string;
    tier: MemoryTier;
    importance_score: number;
    is_active: boolean;
    access_count: number;
    key: string;
    created_at: string;
  }>;

  const active = memories.filter((m) => m.is_active);
  const expired = memories.filter((m) => !m.is_active);

  // Count by tier
  const byTier: Record<MemoryTier, number> = {
    core: 0,
    important: 0,
    contextual: 0,
    ephemeral: 0,
  };
  for (const m of active) {
    byTier[m.tier] = (byTier[m.tier] || 0) + 1;
  }

  // Average importance
  const avgImportance =
    active.length > 0
      ? active.reduce((sum, m) => sum + m.importance_score, 0) / active.length
      : 0;

  // Date range
  const createdDates = memories.map((m) => m.created_at).sort();

  // Most accessed keys
  const mostAccessed = active
    .sort((a, b) => b.access_count - a.access_count)
    .slice(0, 10)
    .map((m) => ({ key: m.key, access_count: m.access_count }));

  return {
    agent_id: agentId,
    total_memories: memories.length,
    active_memories: active.length,
    expired_memories: expired.length,
    by_tier: byTier,
    avg_importance: Number(avgImportance.toFixed(4)),
    oldest_memory_at: createdDates[0] ?? null,
    newest_memory_at: createdDates[createdDates.length - 1] ?? null,
    most_accessed_keys: mostAccessed,
  };
}

// ============================================================================
// CANONICAL BRAIN-STATE → SEARCH PROJECTIONS
// ============================================================================
// `.draymond/*.json` is the canonical WRITABLE store (MEMORY.md). Every other
// memory backend (mem0, LanceDB, Engram, Memory Core, MemAgent) is a READ-ONLY
// search projection over it. This function re-indexes the canonical files into
// the `draymond_memory` search table with `source_event` provenance, so any
// projection can be dropped and rebuilt losslessly from `.draymond/`.
//
// Tier = access method, not importance flag (Letta context hierarchy):
//   core (system-goals, treasury)  → always in context, never decays
//   important (lessons, hypotheses) → searchable archival
//   contextual (kairos, recaps)    → on-demand
// ============================================================================

const BRAIN_STATE_TIER: Record<string, { tier: MemoryTier; importance: number; decay: number }> = {
  'system-goals.json': { tier: 'core', importance: 0.9, decay: 0 },
  'treasury.json': { tier: 'core', importance: 0.9, decay: 0 },
  'learning-store.json': { tier: 'important', importance: 0.7, decay: 0.01 },
  'hypotheses.json': { tier: 'important', importance: 0.7, decay: 0.01 },
  'kairos.json': { tier: 'contextual', importance: 0.5, decay: 0.01 },
  'recaps.json': { tier: 'contextual', importance: 0.5, decay: 0.01 },
};

function extractBrainStateRows(
  file: string,
  parsed: Record<string, unknown>
): Array<{ key: string; summary: string; value: Record<string, unknown> }> {
  const rows: Array<{ key: string; summary: string; value: Record<string, unknown> }> = [];
  const asArray = (arr: unknown): Array<Record<string, unknown>> =>
    Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
  switch (file) {
    case 'system-goals.json':
      for (const g of asArray(parsed.goals)) rows.push({ key: `system-goals:${String(g.id ?? g.title)}`, summary: String(g.title ?? 'goal'), value: g });
      break;
    case 'learning-store.json':
      for (const l of asArray(parsed.lessons)) rows.push({ key: `learning-store:lessons:${String(l.id ?? l.pattern)}`, summary: String(l.pattern ?? l.lesson ?? 'lesson'), value: l });
      break;
    case 'hypotheses.json':
      for (const h of asArray(parsed.hypotheses)) rows.push({ key: `hypotheses:${String(h.id ?? h.claim)}`, summary: String(h.claim ?? 'hypothesis'), value: h });
      break;
    case 'kairos.json':
      for (const m of asArray(parsed.moments)) rows.push({ key: `kairos:${String(m.id ?? m.title)}`, summary: String(m.title ?? 'moment'), value: m });
      break;
    case 'treasury.json':
      rows.push({ key: 'treasury:state', summary: 'Treasury revenue pulse', value: parsed });
      break;
    case 'recaps.json':
      for (const r of asArray(parsed.recaps)) rows.push({ key: `recaps:${String(r.id ?? r.session_id)}`, summary: String(r.summary ?? 'recap'), value: r });
      break;
    default:
      break;
  }
  return rows;
}

/**
 * Rebuild the `draymond_memory` search projections from the canonical
 * `.draymond/*.json` brain state. Idempotent (upsert on agent/user/key).
 * Returns how many rows were indexed and how many files were skipped.
 */
export async function rebuildProjectionsFromBrainState(
  opts: { agentId?: string; userId?: string; brainStateDir?: string } = {}
): Promise<{ indexed: number; skipped: number }> {
  const agentId = opts.agentId ?? 'draymond';
  const userId = opts.userId ?? 'fleet';
  const dir = opts.brainStateDir ?? (process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond'));
  const supabase = await createDraymondClient();

  let indexed = 0;
  let skipped = 0;

  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return { indexed: 0, skipped: 0 }; // no canonical store → nothing to index
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const spec = BRAIN_STATE_TIER[file];
    if (!spec) continue; // only files with a declared access tier are indexed

    let parsed: unknown;
    if (file === 'learning-store.json') {
      // The unified store merges legacy files and fail-softs; read it through
      // the shared loader (threaded with the brainStateDir override) so the
      // projection always sees the same brain the store writes.
      parsed = await readLearningStore(dir);
    } else {
      try {
        parsed = JSON.parse(await fs.promises.readFile(path.join(dir, file), 'utf-8'));
      } catch {
        skipped++;
        continue;
      }
    }

    const rows = extractBrainStateRows(file, (parsed ?? {}) as Record<string, unknown>);
    for (const row of rows) {
      const { error } = await supabase.from('draymond_memory').upsert(
        {
          agent_id: agentId,
          user_id: userId,
          key: row.key,
          value: row.value,
          summary: row.summary,
          tier: spec.tier,
          importance_score: spec.importance,
          decay_rate: spec.decay,
          last_accessed_at: new Date().toISOString(),
          source_session_id: null,
          source_event: `brain_state:${file}`,
          is_active: true,
        },
        { onConflict: 'agent_id,user_id,key', ignoreDuplicates: false }
      );
      if (error) {
        skipped++;
        continue;
      }
      indexed++;
    }
  }

  if (indexed > 0) {
    await logEvent({
      agent_id: agentId,
      category: 'memory',
      severity: 'info',
      event_type: 'projections_rebuilt',
      message: `Rebuilt memory search projections from ${dir}: ${indexed} rows indexed, ${skipped} skipped`,
      metadata: { indexed, skipped, dir },
    }).catch(() => {});
  }

  return { indexed, skipped };
}

// ============================================================================
// BRAIN-STATE SIZE BUDGETS (rethink trigger)
// ============================================================================
// Each canonical .draymond file has a size cap. When a file exceeds its cap,
// kairos raises a `memory_pressure` moment so an agent/operator runs a
// consolidation ("rethink") pass — condense duplicate lessons, drop superseded
// entries. Caps are advisory; files over budget still work, they just signal
// that consolidation is due.
// ============================================================================

export interface BrainStateBudgetFile {
  file: string;
  sizeBytes: number;
  capBytes: number;
  overBudget: boolean;
}

/** Default caps (KB) per canonical brain-state file. Override via DRAYMOND_BRAIN_BUDGET_KB JSON. */
const BRAIN_STATE_BUDGET_KB: Record<string, number> = {
  'learning-store.json': 4000,
  'kairos.json': 750,
  'recaps.json': 1000,
  'hypotheses.json': 250,
  'registry.json': 2000,
  'repair-log.json': 2000,
  'repair-team-log.json': 4000,
  'system-goals.json': 250,
  'treasury.json': 250,
};

function budgetCapsKb(): Record<string, number> {
  const raw = process.env.DRAYMOND_BRAIN_BUDGET_KB;
  if (!raw) return BRAIN_STATE_BUDGET_KB;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return { ...BRAIN_STATE_BUDGET_KB, ...parsed };
  } catch {
    return BRAIN_STATE_BUDGET_KB;
  }
}

/**
 * Report the on-disk size of each canonical .draymond file vs its cap.
 * Returns an empty array when the brain-state dir is absent/unreadable.
 */
export async function checkBrainStateBudget(
  brainStateDirOverride?: string
): Promise<BrainStateBudgetFile[]> {
  const dir = brainStateDirOverride ?? (process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond'));
  const caps = budgetCapsKb();
  const files: BrainStateBudgetFile[] = [];

  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const capKb = caps[name];
    if (!capKb) continue;
    try {
      const stat = await fs.promises.stat(path.join(dir, name));
      const capBytes = capKb * 1024;
      files.push({ file: name, sizeBytes: stat.size, capBytes, overBudget: stat.size > capBytes });
    } catch {
      // unreadable file — ignore, it will fail the projection rebuild instead
    }
  }
  return files;
}

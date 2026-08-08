// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Intelligent Task Router
// ============================================================================
// LLM-powered intent classification and entity resolution from natural language.
// Replaces the dumb dispatcher that required explicit entity/chain slugs.
//
// The router:
// 1. Takes a natural language task description
// 2. Classifies intent (invoke entity, run chain, query status, etc.)
// 3. Resolves the best entity/chain from the registry
// 4. Returns a RouteResult with confidence and alternatives
// ============================================================================

import { createDraymondAdminClient } from './client';
import { logEvent } from './index';
import { callLLM } from './llm';
import type {
  RouterIntent,
  RouteResult,
  RouterConfig,
} from './types';

// ── Default configuration ────────────────────────────────────────────────────

const DEFAULT_CONFIG: RouterConfig = {
  model: 'deepseek-v4-flash-free',
  provider: 'opencode-free',
  temperature: 0.1,
  auto_route_threshold: 0.85,
  fallback_threshold: 0.4,
  max_tokens: 512,
  timeout_ms: 15_000,
};

let _config: RouterConfig = { ...DEFAULT_CONFIG };

export function configureRouter(overrides: Partial<RouterConfig>): void {
  _config = { ...DEFAULT_CONFIG, ...overrides };
}

export function getRouterConfig(): RouterConfig {
  return { ..._config };
}

// ── Registry snapshot (cached for routing) ───────────────────────────────────

type RegistrySnapshot = {
  entities: Array<{
    slug: string;
    name: string;
    kind: string;
    description: string | null;
    capabilities: string[];
    category: string | null;
    tags: string[];
    is_active: boolean;
  }>;
  chains: Array<{
    slug: string;
    name: string;
    description: string | null;
    trigger_type: string;
  }>;
};

let _snapshotCache: { data: RegistrySnapshot; prompt: string; expires: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

async function getRegistrySnapshot(): Promise<RegistrySnapshot> {
  if (_snapshotCache && Date.now() < _snapshotCache.expires) {
    return _snapshotCache.data;
  }

  const supabase = createDraymondAdminClient();

  const [entitiesResult, chainsResult] = await Promise.all([
    supabase
      .from('draymond_entities')
      .select('slug, name, kind, description, capabilities, category, tags, is_active')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('draymond_chains')
      .select('slug, name, description, trigger_type')
      .eq('is_template', true)
      .eq('status', 'active')
      .order('name'),
  ]);

  if (entitiesResult.error) {
    throw new Error(`Failed to fetch entities for routing: ${entitiesResult.error.message}`);
  }
  if (chainsResult.error) {
    throw new Error(`Failed to fetch chains for routing: ${chainsResult.error.message}`);
  }

  const snapshot: RegistrySnapshot = {
    entities: (entitiesResult.data || []) as RegistrySnapshot['entities'],
    chains: (chainsResult.data || []) as RegistrySnapshot['chains'],
  };

  // Build the system prompt once per snapshot so cached routing calls don't
  // re-serialize the whole registry on every task.
  _snapshotCache = {
    data: snapshot,
    prompt: buildSystemPrompt(snapshot),
    expires: Date.now() + CACHE_TTL_MS,
  };
  return snapshot;
}

/** Return the cached system prompt (empty if the snapshot hasn't loaded yet). */
function getCachedPrompt(): string {
  return _snapshotCache?.prompt ?? '';
}

/** Force-clear the snapshot cache (e.g., after entity registration). */
export function invalidateRouterCache(): void {
  _snapshotCache = null;
}

// ── LLM call ─────────────────────────────────────────────────────────────────

function buildSystemPrompt(snapshot: RegistrySnapshot): string {
  const entityList = snapshot.entities
    .map(
      (e) =>
        `  - slug: "${e.slug}", name: "${e.name}", kind: ${e.kind}, ` +
        `capabilities: [${e.capabilities.join(', ')}], ` +
        `category: ${e.category ?? 'none'}, ` +
        `description: ${(e.description ?? 'none').slice(0, 120)}`
    )
    .join('\n');

  const chainList = snapshot.chains
    .map(
      (c) =>
        `  - slug: "${c.slug}", name: "${c.name}", ` +
        `trigger: ${c.trigger_type}, ` +
        `description: ${(c.description ?? 'none').slice(0, 120)}`
    )
    .join('\n');

  return [
    'You are Draymond\'s intelligent task router. Your job is to classify user intent and resolve the best entity or chain to handle it.',
    '',
    'Available entities:',
    entityList || '  (none registered)',
    '',
    'Available chain templates:',
    chainList || '  (none registered)',
    '',
    'Classify the intent as one of:',
    '  - invoke_entity: the task should be handled by a specific entity',
    '  - execute_chain: the task requires a multi-step chain',
    '  - query_status: the user wants system status, health, analytics, crons/schedules, workflows/chains, the agenda/goals, repairs/recovery, or any question about how the Draymond system is doing',
    '  - manage_memory: the user wants to store, retrieve, or manage memory',
    '  - decompose_goal: the task is complex and needs to be broken into subtasks',
    '  - web_search: the user wants current/online information that requires a live web search',
    '  - unknown: you cannot determine the intent',
    '',
    'Respond ONLY with valid JSON (no markdown fences):',
    '{',
    '  "intent": "invoke_entity|execute_chain|query_status|manage_memory|decompose_goal|web_search|unknown",',
    '  "confidence": 0.0-1.0,',
    '  "entity_slug": "slug or null",',
    '  "chain_slug": "slug or null",',
    '  "action": "the action to invoke or null",',
    '  "input": { "extracted input parameters" },',
    '  "reasoning": "brief explanation of your routing decision",',
    '  "alternatives": [{ "intent": "...", "entity_slug": "...", "chain_slug": "...", "confidence": 0.0-1.0 }]',
    '}',
  ].join('\n');
}

// ── Response parsing ─────────────────────────────────────────────────────────

const VALID_INTENTS: Set<RouterIntent> = new Set([
  'invoke_entity',
  'execute_chain',
  'query_status',
  'manage_memory',
  'decompose_goal',
  'web_search',
  'unknown',
]);

function parseRouterResponse(raw: string, snapshot: RegistrySnapshot, latencyMs: number): RouteResult {
  // Strip markdown code fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return {
      intent: 'unknown',
      confidence: 0,
      reasoning: `Failed to parse LLM response as JSON: ${stripped.slice(0, 100)}`,
      alternatives: [],
      resolved_at: new Date().toISOString(),
      latency_ms: latencyMs,
    };
  }

  const rawIntent = typeof obj.intent === 'string' ? obj.intent : 'unknown';
  const intent: RouterIntent = VALID_INTENTS.has(rawIntent as RouterIntent)
    ? (rawIntent as RouterIntent)
    : 'unknown';

  const confidence = typeof obj.confidence === 'number'
    ? Math.max(0, Math.min(1, obj.confidence))
    : 0;

  // Validate entity_slug actually exists
  let entitySlug = typeof obj.entity_slug === 'string' ? obj.entity_slug : undefined;
  if (entitySlug && !snapshot.entities.some((e) => e.slug === entitySlug)) {
    entitySlug = undefined; // LLM hallucinated a slug — drop it
  }

  // Validate chain_slug actually exists
  let chainSlug = typeof obj.chain_slug === 'string' ? obj.chain_slug : undefined;
  if (chainSlug && !snapshot.chains.some((c) => c.slug === chainSlug)) {
    chainSlug = undefined;
  }

  const action = typeof obj.action === 'string' ? obj.action : undefined;
  const input =
    obj.input && typeof obj.input === 'object' && !Array.isArray(obj.input)
      ? (obj.input as Record<string, unknown>)
      : undefined;

  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';

  const alternatives = Array.isArray(obj.alternatives)
    ? (obj.alternatives as Array<Record<string, unknown>>)
        .slice(0, 3)
        .map((alt) => ({
          intent: (VALID_INTENTS.has(alt.intent as RouterIntent)
            ? alt.intent
            : 'unknown') as RouterIntent,
          entity_slug: typeof alt.entity_slug === 'string' ? alt.entity_slug : undefined,
          chain_slug: typeof alt.chain_slug === 'string' ? alt.chain_slug : undefined,
          confidence: typeof alt.confidence === 'number'
            ? Math.max(0, Math.min(1, alt.confidence))
            : 0,
        }))
    : [];

  return {
    intent,
    confidence,
    entity_slug: entitySlug,
    chain_slug: chainSlug,
    action,
    input,
    reasoning,
    alternatives,
    resolved_at: new Date().toISOString(),
    latency_ms: latencyMs,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Route a natural language task to the best entity or chain.
 *
 * Returns a RouteResult with intent classification, resolved entity/chain,
 * confidence score, and alternatives.
 */
export async function routeTask(
  task: string,
  context?: Record<string, unknown>
): Promise<RouteResult> {
  const startMs = Date.now();

  // Quick-match: if the task looks like a direct slug reference, skip LLM
  const snapshot = await getRegistrySnapshot();
  const directMatch = tryDirectMatch(task, snapshot);
  if (directMatch) {
    return directMatch;
  }

  const systemPrompt = getCachedPrompt() || buildSystemPrompt(snapshot);

  const userMessage = context
    ? `<user_task>${task}</user_task>\n<context>${JSON.stringify(context)}</context>`
    : `<user_task>${task}</user_task>`;

  try {
    const raw = await callLLM({
      provider: _config.provider,
      model: _config.model,
      system: systemPrompt,
      userMessage,
      maxTokens: _config.max_tokens,
      temperature: _config.temperature,
      timeoutMs: _config.timeout_ms,
      responseFormat: { type: 'json_object' },
    });
    const latencyMs = Date.now() - startMs;
    const result = parseRouterResponse(raw, snapshot, latencyMs);

    // Log routing decision for observability
    await logEvent({
      agent_id: 'draymond-router',
      category: 'decision',
      severity: 'info',
      event_type: 'task_routed',
      message: `Routed "${task.slice(0, 100)}" → ${result.intent} (${result.entity_slug ?? result.chain_slug ?? 'none'})`,
      metadata: {
        intent: result.intent,
        confidence: result.confidence,
        entity_slug: result.entity_slug,
        chain_slug: result.chain_slug,
        latency_ms: result.latency_ms,
        alternatives_count: result.alternatives.length,
      },
      reasoning: result.reasoning,
    }).catch(() => {});

    return result;
  } catch (err) {
    const latencyMs = Date.now() - startMs;

    await logEvent({
      agent_id: 'draymond-router',
      category: 'decision',
      severity: 'error',
      event_type: 'routing_failed',
      message: `Router failed for "${task.slice(0, 100)}": ${err instanceof Error ? err.message : String(err)}`,
      metadata: { latency_ms: latencyMs },
    }).catch(() => {});

    return {
      intent: 'unknown',
      confidence: 0,
      reasoning: `Router error: ${err instanceof Error ? err.message : String(err)}`,
      alternatives: [],
      resolved_at: new Date().toISOString(),
      latency_ms: latencyMs,
    };
  }
}

/**
 * Route and execute in one call — auto-routes if confidence is high enough,
 * otherwise returns the route result for the caller to decide.
 */
export async function routeAndClassify(
  task: string,
  context?: Record<string, unknown>
): Promise<{
  route: RouteResult;
  should_auto_execute: boolean;
  needs_confirmation: boolean;
  needs_decomposition: boolean;
}> {
  const route = await routeTask(task, context);

  return {
    route,
    should_auto_execute: route.confidence >= _config.auto_route_threshold,
    needs_confirmation:
      route.confidence >= _config.fallback_threshold &&
      route.confidence < _config.auto_route_threshold,
    needs_decomposition: route.intent === 'decompose_goal',
  };
}

// ── Direct matching (skip LLM for obvious patterns) ──────────────────────────

const ENTITY_PREFIX_RE = /^(?:run|invoke|execute|use|call)\s+(?:entity\s+)?['""]?([a-z0-9_-]+)['""]?/i;
const CHAIN_PREFIX_RE = /^(?:run|execute|start)\s+(?:chain\s+)?['""]?([a-z0-9_-]+)['""]?\s*chain/i;
const STATUS_RE = /^(?:show|get|what(?:'s| is))\s+(?:the\s+)?(?:status|health|dashboard)/i;
const SYSTEM_QUERY_RE =
  /^(?:how|what|why|any|are|is|show|get|check|list)\b.*\b(crons?|scheduled jobs?|workflows?|chains?|repairs?|recovery|upgrade queue|agenda|goals?|monitors?|benchmarks?|system|jobs?|brain)\b|(?:\b)(crons?|scheduled jobs?|workflows?|chains?|repairs?|monitors?|agents?|goals?|system|jobs?|brain)\b.*\b(doing|status|health|running|failing|progress|up|down|needs|find)\b/i;
const WEB_SEARCH_RE = /^(?:search(?: the web| online| google)?|google|look up|lookup|find(?: information)?(?: about)?|research online)\s+(?:for\s+)?(.+)$/i;
const BRAIN_RUN_RE = /^(?:run|invoke|trigger|fire)\s+(?:the\s+)?brain(?:\s+sweep)?\s*$/i;

function tryDirectMatch(task: string, snapshot: RegistrySnapshot): RouteResult | null {
  const trimmed = task.trim();

  // Reserved system commands are evaluated BEFORE generic entity parsing so
  // command filler words ("the") can never be mistaken for an entity slug.
  if (BRAIN_RUN_RE.test(trimmed)) {
    return {
      intent: 'invoke_entity',
      confidence: 0.9,
      entity_slug: 'deterministic-brain',
      action: 'sweep',
      reasoning: 'Direct deterministic-brain sweep request — skipped LLM routing',
      alternatives: [],
      resolved_at: new Date().toISOString(),
      latency_ms: 0,
    };
  }

  // Check for entity invocation pattern
  const entityMatch = ENTITY_PREFIX_RE.exec(trimmed);
  if (entityMatch) {
    const slug = entityMatch[1].toLowerCase();
    // Only match when the entity actually exists in the registry.
    if (snapshot.entities.some((e) => e.slug === slug)) {
      return {
        intent: 'invoke_entity',
        confidence: 0.95,
        entity_slug: slug,
        reasoning: 'Direct entity slug pattern detected and validated against registry — skipped LLM routing',
        alternatives: [],
        resolved_at: new Date().toISOString(),
        latency_ms: 0,
      };
    }
    // Unmatched candidate — fall through to the more specific matchers below
    // (chain, web search, brain, status) instead of returning early.
  }

  // Check for chain execution pattern
  const chainMatch = CHAIN_PREFIX_RE.exec(trimmed);
  if (chainMatch) {
    const slug = chainMatch[1].toLowerCase();
    // Validate that the chain actually exists in the registry
    if (!snapshot.chains.some((c) => c.slug === slug)) {
      return null; // Slug not in registry — fall through to LLM routing
    }
    return {
      intent: 'execute_chain',
      confidence: 0.95,
      chain_slug: slug,
      reasoning: 'Direct chain slug pattern detected and validated against registry — skipped LLM routing',
      alternatives: [],
      resolved_at: new Date().toISOString(),
      latency_ms: 0,
    };
  }

  // Check for web search pattern
  const webMatch = WEB_SEARCH_RE.exec(trimmed);
  if (webMatch && webMatch[1]) {
    return {
      intent: 'web_search',
      confidence: 0.92,
      input: { query: webMatch[1].trim() },
      reasoning: 'Direct web search pattern detected — skipped LLM routing',
      alternatives: [],
      resolved_at: new Date().toISOString(),
      latency_ms: 0,
    };
  }

  // Check for status query
  if (STATUS_RE.test(trimmed) || SYSTEM_QUERY_RE.test(trimmed)) {
    return {
      intent: 'query_status',
      confidence: 0.9,
      reasoning: 'Status / system query pattern detected — skipped LLM routing',
      alternatives: [],
      resolved_at: new Date().toISOString(),
      latency_ms: 0,
    };
  }

  return null;
}

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
import { callLLM, callLocalModel } from './llm';
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
  use_brain_pre_route: true,
  brain_pre_route_confidence: 0.6,
  // Opt-in local pre-routing via env. Off by default: 0.6B models misclassify,
  // so local routing stays a paid-failure fallback unless explicitly enabled.
  // Set ROUTER_USE_LOCAL_MODEL=1 to try the local Ollama tier before paid.
  use_local_model: process.env.ROUTER_USE_LOCAL_MODEL === '1',
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
      // Templates are seeded as 'draft'; they are the routable definitions,
      // so include them regardless of status (a 'paused' template is still a
      // valid target — instantiateChain handles it).
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
    '  - casual_chat: a greeting, thank-you, small talk, or any friendly message that needs a conversational reply, not a system action',
    '  - manage_memory: the user wants to store, retrieve, or manage memory',
    '  - decompose_goal: the task is complex and needs to be broken into subtasks',
    '  - web_search: the user wants current/online information that requires a live web search',
    '  - unknown: you cannot determine the intent',
    '',
    'Respond ONLY with valid JSON (no markdown fences):',
    '{',
    '  "intent": "invoke_entity|execute_chain|query_status|manage_memory|decompose_goal|web_search|casual_chat|unknown",',
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

/**
 * Compact routing prompt for the cheap local-model tier. Lists only slugs +
 * names (no long descriptions) so a 1B model can classify quickly. Entity and
 * chain resolution is validated against the snapshot afterwards.
 */
function buildCompactPrompt(snapshot: RegistrySnapshot): string {
  const entityList = snapshot.entities
    .map((e) => `  - "${e.slug}" (${e.name}, ${e.kind})`)
    .join('\n');
  const chainList = snapshot.chains
    .map((c) => `  - "${c.slug}" (${c.name})`)
    .join('\n');

  return [
    'You are Draymond\'s task router. Classify the intent and pick ONE entity or chain slug from the lists.',
    'Intents: invoke_entity | execute_chain | query_status | manage_memory | decompose_goal | web_search | casual_chat | unknown',
    'Rules:',
    '  - "run <x>", "trigger <x>", "execute <x>" where <x> is a workflow/chain -> execute_chain with chain_slug.',
    '  - "check if <service> is up/online", "is <service> down", "status of <service>" -> query_status (no entity_slug).',
    '  - asking about system status/health/crons/schedules/chains/repairs/agenda -> query_status.',
    '  - a greeting, thank-you, or friendly small talk -> casual_chat (no entity_slug, no chain_slug).',
    '  - asking an entity to DO a one-off action (post, analyze, generate, send) -> invoke_entity with entity_slug.',
    'Available entity slugs:',
    entityList || '  (none)',
    'Available chain slugs:',
    chainList || '  (none)',
    'Reply with ONLY JSON:',
    '{',
    '  "intent": "...", "confidence": 0.0-1.0, "entity_slug": "slug or null", "chain_slug": "slug or null",',
    '  "action": "action or null", "input": {}, "reasoning": "brief"',
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
  'casual_chat',
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

  // Pre-LLM deterministic gate: ask the deterministic brain's /reason to
  // classify intent. When the brain is confident (>= brain_pre_route_confidence)
  // and resolves to a known entity/chain, skip the paid LLM entirely — this is
  // the biggest token saver in the ecosystem (routing fires on every task).
  if (_config.use_brain_pre_route !== false) {
    const brainRoute = await tryBrainPreRoute(task, startMs, snapshot);
    if (brainRoute) {
      return brainRoute;
    }
  }

  const systemPrompt = getCachedPrompt() || buildSystemPrompt(snapshot);

  const userMessage = context
    ? `<user_task>${task}</user_task>\n<context>${JSON.stringify(context)}</context>`
    : `<user_task>${task}</user_task>`;

  // Preferred: paid provider (reliable routing). Try local first only when
  // configured (use_local_model), since 1B models misclassify. If the paid
  // provider chain fails entirely (e.g. all keys out of balance), fall back to
  // the local model so routing still works.
  const usedLocal = false;
  if (_config.use_local_model) {
    const localResult = await tryLocalRoute(task, startMs, snapshot, userMessage);
    if (localResult) return localResult;
  }

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
      toonify: true,
      fallbackKey: 'router.routeTask',
      fallbackContext: { userMessage: task },
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
        model_tier: usedLocal ? 'paid-fallback' : 'paid',
      },
      reasoning: result.reasoning,
    }).catch(() => {});

    return result;
  } catch (err) {
    const latencyMs = Date.now() - startMs;

    // Paid provider chain failed (e.g. all keys out of balance / auth) — try
    // the local model as a last resort so routing still functions.
    const localResult = await tryLocalRoute(task, startMs, snapshot, userMessage);
    if (localResult) return localResult;

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

/** Attempt routing via the local Ollama model; null when rejected/unavailable. */
async function tryLocalRoute(
  task: string,
  startMs: number,
  snapshot: RegistrySnapshot,
  userMessage: string,
): Promise<RouteResult | null> {
  try {
    const raw = await callLocalModel({
      system: buildCompactPrompt(snapshot),
      userMessage,
      maxTokens: 512,
      responseFormat: { type: 'json_object' },
      fallbackKey: 'router.tryLocalRoute',
      fallbackContext: { userMessage: task },
    });
    const latencyMs = Date.now() - startMs;
    const result = parseRouterResponse(raw, snapshot, latencyMs);

    const acceptable =
      result.intent !== 'unknown' &&
      result.confidence >= _config.fallback_threshold &&
      (result.entity_slug !== undefined ||
        result.chain_slug !== undefined ||
        result.intent === 'query_status');

    if (acceptable) {
      await logEvent({
        agent_id: 'draymond-router',
        category: 'decision',
        severity: 'info',
        event_type: 'task_routed',
        message: `Routed "${task.slice(0, 100)}" → ${result.intent} (local model)`,
        metadata: {
          intent: result.intent,
          confidence: result.confidence,
          entity_slug: result.entity_slug,
          chain_slug: result.chain_slug,
          latency_ms: result.latency_ms,
          alternatives_count: result.alternatives.length,
          model_tier: 'local',
        },
        reasoning: result.reasoning,
      }).catch(() => {});
      return result;
    }
    console.warn(
      `[router] local model route rejected (intent=${result.intent} conf=${result.confidence}).`
    );
  } catch (err) {
    console.warn(`[router] local model failed (${err instanceof Error ? err.message : String(err)}).`);
  }
  return null;
}

/**
 * Pre-LLM deterministic routing gate. POSTs the task to the deterministic
 * brain's `/reason` (zero-LLM reasoning pipeline). When the brain classifies
 * with confidence >= brain_pre_route_confidence and resolves to a known
 * entity/chain, return that route WITHOUT spending any LLM tokens.
 *
 * Gated on BRAIN_URL (same as brain-task.ts): when unset this is a strict
 * no-op. Fail-soft — a slow/unreachable brain returns null and routing falls
 * through to the paid LLM as before.
 */
async function tryBrainPreRoute(
  task: string,
  startMs: number,
  snapshot: RegistrySnapshot,
): Promise<RouteResult | null> {
  const base = process.env.BRAIN_URL?.replace(/\/+$/, '');
  if (!base) return null;

  const confThreshold = _config.brain_pre_route_confidence ?? 0.6;
  const timeoutMs = Number(process.env.BRAIN_PRE_ROUTE_TIMEOUT_MS ?? 4000);

  try {
    const res = await fetch(`${base}/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: task }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const decision = (data?.decision ?? {}) as Record<string, unknown>;
    const confidence = Number(decision.confidence ?? 0);
    const chosenSkill = typeof decision.chosen_skill === 'string' ? decision.chosen_skill : '';

    if (confidence < confThreshold || !chosenSkill) return null;

    // Map the brain's chosen skill to a real registry route. Priority:
    //   1. Exact entity slug (brain classified which entity to invoke).
    //   2. Exact chain slug / name.
    //   3. The deterministic-brain entity itself (skill = brain's own skill).
    const entityBySlug = snapshot.entities.find((e) => e.slug === chosenSkill);
    const chain = snapshot.chains.find((c) => c.slug === chosenSkill || c.name === chosenSkill);
    const brainEntity = snapshot.entities.find((e) => e.slug === 'deterministic-brain');
    const latencyMs = Date.now() - startMs;

    let result: RouteResult;
    if (entityBySlug) {
      result = {
        intent: 'invoke_entity',
        confidence,
        entity_slug: entityBySlug.slug,
        action: chosenSkill,
        reasoning: `Deterministic brain classified "${task}" → entity ${entityBySlug.slug} (conf ${confidence.toFixed(2)}) — skipped LLM routing`,
        alternatives: [],
        resolved_at: new Date().toISOString(),
        latency_ms: latencyMs,
      };
    } else if (chain) {
      result = {
        intent: 'execute_chain',
        confidence,
        chain_slug: chain.slug,
        reasoning: `Deterministic brain classified "${task}" → chain ${chain.slug} (conf ${confidence.toFixed(2)}) — skipped LLM routing`,
        alternatives: [],
        resolved_at: new Date().toISOString(),
        latency_ms: latencyMs,
      };
    } else if (brainEntity) {
      result = {
        intent: 'invoke_entity',
        confidence,
        entity_slug: brainEntity.slug,
        action: chosenSkill,
        reasoning: `Deterministic brain classified "${task}" → ${chosenSkill} (conf ${confidence.toFixed(2)}) — skipped LLM routing`,
        alternatives: [],
        resolved_at: new Date().toISOString(),
        latency_ms: latencyMs,
      };
    } else {
      return null; // brain confident but no routable target — fall through to LLM
    }

    // Token savings: the LLM routing call (system prompt + ~512 output tokens)
    // was avoided. Emit to the savings metric if present.
    try {
      const { recordBrainRouteSavings } = await import('./brain-savings');
      recordBrainRouteSavings(Number(_config.max_tokens ?? 512));
    } catch {
      /* metrics module unavailable — routing still succeeds */
    }

    await logEvent({
      agent_id: 'draymond-router',
      category: 'decision',
      severity: 'info',
      event_type: 'task_routed',
      message: `Routed "${task.slice(0, 100)}" → ${result.intent} (deterministic brain)`,
      metadata: {
        intent: result.intent,
        confidence,
        entity_slug: result.entity_slug,
        chain_slug: result.chain_slug,
        latency_ms: latencyMs,
        alternatives_count: 0,
        model_tier: 'brain-deterministic',
      },
      reasoning: result.reasoning,
    }).catch(() => {});

    return result;
  } catch (err) {
    // Brain unreachable / timed out — fall through to the paid LLM.
    console.warn(
      `[router] brain pre-route skipped (${err instanceof Error ? err.message : String(err)}).`
    );
    return null;
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
const CASUAL_RE = /^(?:(?:hi|hey|hello|yo|sup|good\s*(?:morning|afternoon|evening)|how(?:'s| is) it going|how are you|what'?s up|thanks|thank you|thx|ok(?:ay)?|cool|great|awesome|nice|perfect|love it|noted)\b[\s!.,]*)+$/i;
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

  // Greetings / small talk → conversational reply, never a JSON status dump.
  if (CASUAL_RE.test(trimmed) || trimmed.length <= 2) {
    return {
      intent: 'casual_chat',
      confidence: 0.95,
      reasoning: 'Greeting or casual message — route to the conversational assistant',
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

  // Natural-language chain-name match: "run the morning briefing" should hit
  // the "morning-briefing" chain without the LLM. Matches on a run/start/do
  // verb followed by words that normalize to a known chain name or slug.
  const CHAIN_TRIGGER_RE = /^(?:run|start|trigger|do|execute|fire|kick\s+off)\b/i;
  if (CHAIN_TRIGGER_RE.test(trimmed)) {
    const norm = trimmed
      .toLowerCase()
      .replace(/^(?:please\s+)?(?:run|start|trigger|do|execute|fire|kick\s+off)\s+(?:the\s+|a\s+)?/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    for (const c of snapshot.chains) {
      const chainKey = c.slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const nameKey = (c.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (norm === chainKey || norm === nameKey || norm.startsWith(chainKey + '-') || norm.endsWith('-' + chainKey)) {
        return {
          intent: 'execute_chain',
          confidence: 0.9,
          chain_slug: c.slug,
          reasoning: `Chain name "${trimmed.slice(0, 60)}" matched "${c.name}" — skipped LLM routing`,
          alternatives: [],
          resolved_at: new Date().toISOString(),
          latency_ms: 0,
        };
      }
    }
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

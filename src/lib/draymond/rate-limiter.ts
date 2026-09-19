// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Rate Limiting & Cost Tracking
// ============================================================================
// Provides:
// 1. Token-bucket rate limiter (in-memory, per-entity)
// 2. Cost tracking ledger with budget guards (persisted via draymond_events)
// 3. Middleware wrapper for the invoker with rate limit + budget enforcement
// ============================================================================

import { invokeEntity } from './invoker';
import type { EntityForInvocation, InvocationResult, InvocationOptions } from './invoker';
import { logEvent } from './index';
import { createDraymondClient } from './client';

// ============================================================================
// 1. TOKEN-BUCKET RATE LIMITER
// ============================================================================

/**
 * Result of a rate limit check.
 */
export type RateLimitResult = {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of remaining requests in the current window. */
  remaining: number;
  /** When the current window resets. */
  resetAt: Date;
};

/**
 * Internal bucket state for a single entity.
 */
type TokenBucket = {
  /** Timestamps of requests within the current window. */
  timestamps: number[];
};

/**
 * In-memory store of token buckets keyed by entity ID.
 * Resets on server restart — this is acceptable for rate limiting.
 */
const buckets = new Map<string, TokenBucket>();

/** Maximum number of distinct entity buckets to prevent unbounded memory growth. */
const MAX_BUCKETS = 10_000;

/** Interval for evicting stale buckets (5 minutes). */
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;

/** Buckets with no requests newer than this are considered stale (10 minutes). */
const STALE_BUCKET_AGE_MS = 10 * 60 * 1000;

/** Periodic eviction sweep — removes empty or stale buckets. */
let _evictionTimer: ReturnType<typeof setInterval> | null = null;

function ensureEvictionTimer(): void {
  if (_evictionTimer) return;
  _evictionTimer = setInterval(() => {
    const now = Date.now();
    for (const [entityId, bucket] of buckets) {
      // Remove buckets with no recent timestamps
      if (bucket.timestamps.length === 0) {
        buckets.delete(entityId);
        continue;
      }
      const newest = bucket.timestamps[bucket.timestamps.length - 1];
      if (now - newest > STALE_BUCKET_AGE_MS) {
        buckets.delete(entityId);
      }
    }
    // If the map is empty, stop the timer to allow GC in tests
    if (buckets.size === 0 && _evictionTimer) {
      clearInterval(_evictionTimer);
      _evictionTimer = null;
    }
  }, EVICTION_INTERVAL_MS);
  // Allow the Node.js process to exit even if the timer is running
  if (_evictionTimer && typeof _evictionTimer === 'object' && 'unref' in _evictionTimer) {
    _evictionTimer.unref();
  }
}

/**
 * Check whether an entity is within its rate limit using a sliding-window
 * token bucket. Each call records a request timestamp if allowed.
 *
 * This implementation uses a sliding window: it keeps track of request
 * timestamps and evicts any that fall outside the window before counting.
 *
 * Thread-safe for a single Node.js process (single-threaded event loop).
 *
 * @param entityId   - Unique identifier for the entity being rate-limited.
 * @param maxRequests - Maximum number of requests allowed within the window. Must be > 0.
 * @param windowMs   - Duration of the sliding window in milliseconds. Must be > 0.
 * @returns Rate limit check result with remaining count and reset time.
 *
 * @example
 * ```ts
 * const result = checkRateLimit('entity-abc', 100, 60_000);
 * if (!result.allowed) {
 *   console.log(`Rate limited. Resets at ${result.resetAt}`);
 * }
 * ```
 */
export function checkRateLimit(
  entityId: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  // Input validation (item 2)
  if (!entityId || typeof entityId !== 'string') {
    return { allowed: false, remaining: 0, resetAt: new Date() };
  }
  if (typeof maxRequests !== 'number' || maxRequests <= 0 || !Number.isFinite(maxRequests)) {
    return { allowed: false, remaining: 0, resetAt: new Date() };
  }
  if (typeof windowMs !== 'number' || windowMs <= 0 || !Number.isFinite(windowMs)) {
    return { allowed: false, remaining: 0, resetAt: new Date() };
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  // Get or create the bucket for this entity
  let bucket = buckets.get(entityId);
  if (!bucket) {
    // Guard against unbounded growth (item 1)
    if (buckets.size >= MAX_BUCKETS) {
      // Evict the oldest bucket (least recently used)
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, b] of buckets) {
        const newest = b.timestamps.length > 0 ? b.timestamps[b.timestamps.length - 1] : 0;
        if (newest < oldestTime) {
          oldestTime = newest;
          oldestKey = key;
        }
      }
      if (oldestKey) buckets.delete(oldestKey);
    }
    bucket = { timestamps: [] };
    buckets.set(entityId, bucket);
  }

  // Start the periodic eviction timer (item 1)
  ensureEvictionTimer();

  // Evict expired timestamps outside the sliding window
  bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);

  // Determine the reset time: when the oldest request in the window expires
  const resetAt =
    bucket.timestamps.length > 0
      ? new Date(bucket.timestamps[0] + windowMs)
      : new Date(now + windowMs);

  // Check if we're at capacity
  if (bucket.timestamps.length >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }

  // Allow the request and record the timestamp
  bucket.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxRequests - bucket.timestamps.length,
    resetAt,
  };
}

// ============================================================================
// 2. COST TRACKING LEDGER
// ============================================================================

/**
 * Summary of costs recorded for an entity or agent.
 */
export type CostSummary = {
  /** Total cost in cents across all matching records. */
  totalCents: number;
  /** Number of cost records found. */
  count: number;
  /** Average cost per record in cents. */
  avgCents: number;
};

/**
 * Result of a budget check.
 */
export type BudgetCheckResult = {
  /** Whether spending is within the budget. */
  allowed: boolean;
  /** Total cents spent in the current window. */
  spentCents: number;
  /** Remaining budget in cents. */
  remainingCents: number;
};

/**
 * Record a cost event to the `draymond_events` table via `logEvent`.
 *
 * Costs are stored as events with `event_type: 'cost_recorded'` and the
 * cost details in the metadata field. This allows budget queries to filter
 * by entity, agent, and time window.
 *
 * @param entityId - The entity that incurred the cost.
 * @param agentId  - The agent associated with the cost (used as the event's agent_id).
 *                   If undefined, entityId is used as the agent_id field.
 * @param costCents - The cost in cents to record.
 * @param metadata  - Optional additional metadata to attach to the event.
 *
 * @example
 * ```ts
 * await recordCost('entity-abc', 'agent-xyz', 5, { model: 'gpt-4' });
 * ```
 */
export async function recordCost(
  entityId: string,
  agentId: string | undefined,
  costCents: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // Input validation (item 3): reject non-positive / non-finite cost values
  if (typeof costCents !== 'number' || !Number.isFinite(costCents) || costCents < 0) {
    throw new Error(`Invalid costCents: expected a non-negative finite number, got ${costCents}`);
  }

  await logEvent({
    // agent_id is required by DraymondEventInsert; fall back to entityId
    agent_id: agentId ?? entityId,
    category: 'action',
    severity: 'info',
    event_type: 'cost_recorded',
    message: `Cost recorded: ${costCents} cents for entity ${entityId}`,
    metadata: {
      entity_id: entityId,
      cost_cents: costCents,
      ...metadata,
    },
  });
}

/**
 * Query aggregated cost data from `draymond_events` where
 * `event_type = 'cost_recorded'`.
 *
 * Filters can be applied by entity ID (in metadata), agent ID, and time window.
 * All filters are optional — omitting all returns a global summary.
 *
 * @param entityId   - Filter by entity_id stored in event metadata.
 * @param agentId    - Filter by the event's agent_id field.
 * @param sinceHours - Only include events from the last N hours (default: all time).
 * @returns Aggregated cost summary with total, count, and average.
 *
 * @example
 * ```ts
 * const summary = await getCostSummary('entity-abc', undefined, 24);
 * console.log(`Spent ${summary.totalCents} cents in the last 24 hours`);
 * ```
 */
export async function getCostSummary(
  entityId?: string,
  agentId?: string,
  sinceHours?: number,
): Promise<CostSummary> {
  const supabase = await createDraymondClient();

  let query = supabase
    .from('draymond_events')
    .select('metadata')
    .eq('event_type', 'cost_recorded');

  if (agentId) {
    query = query.eq('agent_id', agentId);
  }

  if (sinceHours !== undefined && sinceHours > 0) {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  }

  // Apply a reasonable limit to prevent fetching unbounded rows (item 4)
  query = query.limit(10_000);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query cost events: ${error.message}`);
  }

  // Filter by entity_id in metadata (Supabase JSON filtering with contains)
  // and accumulate costs
  const events = (data || []) as Array<{ metadata: Record<string, unknown> | null }>;

  let totalCents = 0;
  let count = 0;

  for (const event of events) {
    const meta = event.metadata;
    // Guard against null metadata (item 8)
    if (!meta || typeof meta !== 'object') continue;

    // If entityId filter is specified, only include matching records
    if (entityId && meta.entity_id !== entityId) {
      continue;
    }

    // Only count valid numeric cost values (item 8)
    const cost = typeof meta.cost_cents === 'number' && Number.isFinite(meta.cost_cents as number)
      ? (meta.cost_cents as number)
      : 0;
    if (cost === 0) continue; // skip records with no valid cost
    totalCents += cost;
    count += 1;
  }

  return {
    totalCents,
    count,
    avgCents: count > 0 ? totalCents / count : 0,
  };
}

/**
 * Check whether an entity's spending is within its allotted budget for a
 * given time window.
 *
 * @param entityId    - The entity whose budget to check.
 * @param budgetCents - Maximum allowed spend in cents for the window.
 * @param windowHours - The rolling window in hours to consider.
 * @returns Budget check result indicating if further spending is allowed.
 *
 * @example
 * ```ts
 * const budget = await checkBudget('entity-abc', 1000, 24);
 * if (!budget.allowed) {
 *   console.log(`Over budget! Spent ${budget.spentCents} of ${1000} cents`);
 * }
 * ```
 */
export async function checkBudget(
  entityId: string,
  budgetCents: number,
  windowHours: number,
): Promise<BudgetCheckResult> {
  const summary = await getCostSummary(entityId, undefined, windowHours);

  const remainingCents = Math.max(0, budgetCents - summary.totalCents);

  return {
    // Use <= to block when spending exactly equals budget (item 7)
    allowed: summary.totalCents < budgetCents,
    spentCents: summary.totalCents,
    remainingCents,
  };
}

// ============================================================================
// 3. MIDDLEWARE WRAPPER FOR THE INVOKER
// ============================================================================

/**
 * Configuration for rate limiting, extracted from `entity.invocation_config`.
 */
type RateLimitConfig = {
  max_requests: number;
  window_ms: number;
};

/**
 * Configuration for budget guards, extracted from `entity.invocation_config`.
 */
type BudgetConfig = {
  max_cents: number;
  window_hours: number;
};

/**
 * Wrap `invokeEntity` with rate limit and budget enforcement.
 *
 * This middleware performs the following sequence:
 * 1. **Rate limit check** — if the entity's `invocation_config` includes a
 *    `rate_limit` object, the request is checked against the in-memory
 *    sliding-window rate limiter. If denied, returns a failed result immediately.
 * 2. **Budget check** — if the entity's `invocation_config` includes a `budget`
 *    object, the entity's recent spending is queried. If over budget, returns a
 *    failed result immediately.
 * 3. **Invocation** — delegates to `invokeEntity` for actual execution.
 * 4. **Cost recording** — after a successful invocation, records the cost
 *    (from `invocation_config.cost_per_call_cents`, default 0) to the event log.
 *
 * @param entity  - The entity to invoke (must include invocation_config).
 * @param action  - The action name to pass to the invoker.
 * @param input   - The input data for the invocation.
 * @param options - Optional invocation overrides.
 * @returns The invocation result, or a failed result if rate-limited or over budget.
 *
 * @example
 * ```ts
 * const entity = {
 *   id: 'ent-123',
 *   name: 'My Agent',
 *   slug: 'my-agent',
 *   kind: 'agent',
 *   invocation_method: 'http_api',
 *   invocation_config: {
 *     url: 'https://api.example.com/invoke',
 *     rate_limit: { max_requests: 10, window_ms: 60000 },
 *     budget: { max_cents: 500, window_hours: 24 },
 *     cost_per_call_cents: 5,
 *   },
 *   timeout_seconds: 30,
 * };
 *
 * const result = await withRateLimitAndCost(entity, 'summarize', { text: '...' });
 * ```
 */
export async function withRateLimitAndCost(
  entity: EntityForInvocation,
  action: string,
  input: Record<string, unknown>,
  options?: InvocationOptions,
): Promise<InvocationResult> {
  const config = entity.invocation_config;

  // -- Step 1: Rate Limit Check ------------------------------------------
  // Validate rate_limit config shape at runtime (item 5)
  const rawRateLimit = config.rate_limit;
  const rateLimitConfig: RateLimitConfig | undefined =
    rawRateLimit &&
    typeof rawRateLimit === 'object' &&
    typeof (rawRateLimit as Record<string, unknown>).max_requests === 'number' &&
    typeof (rawRateLimit as Record<string, unknown>).window_ms === 'number'
      ? (rawRateLimit as RateLimitConfig)
      : undefined;

  if (rateLimitConfig) {
    const rlResult = checkRateLimit(
      entity.id,
      rateLimitConfig.max_requests,
      rateLimitConfig.window_ms,
    );

    if (!rlResult.allowed) {
      return {
        success: false,
        output: {
          rate_limit: {
            remaining: rlResult.remaining,
            reset_at: rlResult.resetAt.toISOString(),
          },
        },
        error: `Rate limited: entity "${entity.name}" (${entity.id}) has exhausted its ${rateLimitConfig.max_requests} requests per ${rateLimitConfig.window_ms}ms window. Resets at ${rlResult.resetAt.toISOString()}.`,
        duration_ms: 0,
      };
    }
  }

  // -- Step 2: Budget Check ----------------------------------------------
  // Validate budget config shape at runtime (item 5)
  const rawBudget = config.budget;
  const budgetConfig: BudgetConfig | undefined =
    rawBudget &&
    typeof rawBudget === 'object' &&
    typeof (rawBudget as Record<string, unknown>).max_cents === 'number' &&
    typeof (rawBudget as Record<string, unknown>).window_hours === 'number'
      ? (rawBudget as BudgetConfig)
      : undefined;

  if (budgetConfig) {
    const budgetResult = await checkBudget(
      entity.id,
      budgetConfig.max_cents,
      budgetConfig.window_hours,
    );

    if (!budgetResult.allowed) {
      return {
        success: false,
        output: {
          budget: {
            spent_cents: budgetResult.spentCents,
            budget_cents: budgetConfig.max_cents,
            remaining_cents: budgetResult.remainingCents,
            window_hours: budgetConfig.window_hours,
          },
        },
        error: `Budget exceeded: entity "${entity.name}" (${entity.id}) has spent ${budgetResult.spentCents} of ${budgetConfig.max_cents} cents in the last ${budgetConfig.window_hours} hours.`,
        duration_ms: 0,
      };
    }
  }

  // -- Step 3: Invoke ----------------------------------------------------
  const result = await invokeEntity(entity, action, input, options);

  // -- Step 4: Record Cost (after successful invocation) -----------------
  if (result.success) {
    const costPerCall =
      typeof config.cost_per_call_cents === 'number'
        ? config.cost_per_call_cents
        : 0;

    if (costPerCall > 0) {
      // Record cost without blocking the response — fire and forget,
      // but we await to ensure the event is written before returning.
      // Validate agent_id at runtime (item 5)
      const agentIdRaw = config.agent_id;
      const agentIdStr: string | undefined =
        typeof agentIdRaw === 'string' ? agentIdRaw : undefined;

      await recordCost(entity.id, agentIdStr, costPerCall, {
        action,
        invocation_method: entity.invocation_method,
        duration_ms: result.duration_ms,
      });
    }
  }

  return result;
}

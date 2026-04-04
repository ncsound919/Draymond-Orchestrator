// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Subscribable Hooks / Webhooks
// ============================================================================
// In-memory webhook subscription registry with HMAC-signed, fire-and-forget
// event dispatch. Other modules call `notifyHooks()` to fan out lifecycle
// events to all matching subscribers without blocking the caller.
//
// Features:
//   - Wildcard (`*`) and exact-match event routing
//   - Optional agent_id / entity_id scoping per subscription
//   - HMAC-SHA256 payload signing via `X-Draymond-Signature` header
//   - Automatic disable after N consecutive delivery failures
//   - Concurrent delivery via `Promise.allSettled`
// ============================================================================

import { createHmac, randomUUID } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Lifecycle event types that hooks can subscribe to.
 * Use `'*'` as a wildcard to receive every event.
 */
export type HookEventType =
  | 'chain.started'
  | 'chain.completed'
  | 'chain.failed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'action.submitted'
  | 'action.approved'
  | 'action.rejected'
  | 'agent.health_changed'
  | 'agent.recovered'
  | 'agent.failover'
  | 'handoff.initiated'
  | 'handoff.completed'
  | '*';

/**
 * A registered webhook subscription.
 *
 * Each subscription targets a single event type (or `'*'` for all) and
 * optionally narrows delivery to a specific agent and/or entity.
 */
export type HookSubscription = {
  /** Unique subscription identifier (UUID v4). */
  id: string;
  /** The event type this subscription listens for. */
  event_type: HookEventType;
  /** The URL that will receive POST requests with the event payload. */
  callback_url: string;
  /** Optional HMAC-SHA256 signing secret. When set, the request includes an `X-Draymond-Signature` header. */
  secret?: string;
  /** Optional entity ID filter — only events matching this entity are delivered. */
  entity_filter?: string;
  /** Optional agent ID filter — only events matching this agent are delivered. */
  agent_filter?: string;
  /** Whether this subscription is currently active. Inactive subscriptions are skipped during dispatch. */
  is_active: boolean;
  /** ISO 8601 timestamp of when this subscription was created. */
  created_at: string;
  /** Number of consecutive delivery failures. Reset to 0 on success. */
  failure_count: number;
  /** Maximum consecutive failures before the subscription is automatically deactivated. */
  max_failures: number;
};

/**
 * The JSON body POSTed to each webhook callback URL.
 */
export type HookPayload = {
  /** The lifecycle event type that triggered this delivery. */
  event_type: HookEventType;
  /** ISO 8601 timestamp of when the event was dispatched. */
  timestamp: string;
  /** The subscription ID this delivery is targeting. */
  subscription_id: string;
  /** Arbitrary event data. Shape varies by event type. */
  data: Record<string, unknown>;
};

// ============================================================================
// IN-MEMORY HOOK REGISTRY
// ============================================================================

/** Internal store for all registered hook subscriptions. */
const _hooks: Map<string, HookSubscription> = new Map();

/** Maximum number of registered hook subscriptions to prevent DoS (item 25). */
const MAX_HOOKS = 500;

/**
 * Validate that a callback URL is well-formed and not pointing to private/internal IPs (items 24, 29).
 * Blocks: private IPs, localhost, non-http(s) schemes, empty strings, file://, javascript: etc.
 */
function validateCallbackUrl(urlStr: string): { valid: boolean; error?: string } {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: 'callback_url is required and must be a non-empty string' };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: `Invalid callback URL: "${urlStr}"` };
  }

  // Only allow http(s) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Blocked URL scheme: "${parsed.protocol}". Only http/https allowed.` };
  }

  // In development, skip private IP checks (agents run locally)
  const allowLocal =
    process.env.NODE_ENV !== 'production' ||
    process.env.ALLOW_LOCAL_AGENTS === '1' ||
    process.env.ALLOW_LOCAL_AGENTS === 'true';

  if (allowLocal) {
    return { valid: true };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
    return { valid: false, error: `Blocked private/localhost URL: "${hostname}"` };
  }
  if (hostname === '0.0.0.0') {
    return { valid: false, error: 'Blocked 0.0.0.0 URL' };
  }

  // Block private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return { valid: false, error: 'Blocked private IP range 10.x.x.x' };
    if (a === 172 && b >= 16 && b <= 31) return { valid: false, error: 'Blocked private IP range 172.16-31.x.x' };
    if (a === 192 && b === 168) return { valid: false, error: 'Blocked private IP range 192.168.x.x' };
    if (a === 169 && b === 254) return { valid: false, error: 'Blocked link-local IP range 169.254.x.x' };
    if (a === 127) return { valid: false, error: 'Blocked loopback IP range 127.x.x.x' };
  }

  // Block cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return { valid: false, error: 'Blocked cloud metadata endpoint' };
  }

  return { valid: true };
}

/**
 * Register a new webhook subscription.
 *
 * Generates a UUID, sets `failure_count` to 0, and records the current
 * timestamp as `created_at`.
 *
 * @param subscription - Subscription details (omit `id`, `created_at`, and `failure_count`).
 * @returns The fully-populated {@link HookSubscription} with generated fields.
 *
 * @example
 * ```ts
 * const sub = registerHook({
 *   event_type: 'chain.completed',
 *   callback_url: 'https://example.com/webhook',
 *   secret: 'my-signing-secret',
 *   is_active: true,
 *   max_failures: 5,
 * });
 * console.log(sub.id); // e.g. "a1b2c3d4-..."
 * ```
 */
export function registerHook(
  subscription: Omit<HookSubscription, 'id' | 'created_at' | 'failure_count'>
): HookSubscription {
  // Validate registration limit (item 25)
  if (_hooks.size >= MAX_HOOKS) {
    throw new Error(`Hook registration limit reached (max ${MAX_HOOKS}). Remove unused subscriptions first.`);
  }

  // Validate callback URL against SSRF and well-formedness (items 24, 29)
  const urlCheck = validateCallbackUrl(subscription.callback_url);
  if (!urlCheck.valid) {
    throw new Error(`Invalid callback URL: ${urlCheck.error}`);
  }

  // Validate max_failures (item 28): must be a positive integer
  if (
    typeof subscription.max_failures !== 'number' ||
    !Number.isFinite(subscription.max_failures) ||
    subscription.max_failures < 1
  ) {
    throw new Error(`max_failures must be a positive integer, got ${subscription.max_failures}`);
  }

  // Validate secret (item 27): if provided, must be a non-empty string
  if (subscription.secret !== undefined && (!subscription.secret || typeof subscription.secret !== 'string')) {
    throw new Error('secret must be a non-empty string if provided');
  }

  const hook: HookSubscription = {
    ...subscription,
    id: randomUUID(),
    created_at: new Date().toISOString(),
    failure_count: 0,
  };

  _hooks.set(hook.id, hook);
  // Return a defensive copy to prevent external mutation (item 30)
  return { ...hook };
}

/**
 * Remove a webhook subscription by its ID.
 *
 * @param subscriptionId - The UUID of the subscription to remove.
 * @returns `true` if the subscription existed and was removed, `false` otherwise.
 */
export function unregisterHook(subscriptionId: string): boolean {
  return _hooks.delete(subscriptionId);
}

/**
 * List all registered webhook subscriptions, optionally filtered by event type.
 *
 * @param eventType - If provided, only return subscriptions that match this
 *   event type exactly (wildcard subscriptions are *not* included unless you
 *   pass `'*'`).
 * @returns An array of {@link HookSubscription} objects.
 */
export function listHooks(eventType?: HookEventType): HookSubscription[] {
  const all = Array.from(_hooks.values());
  const filtered = eventType ? all.filter((h) => h.event_type === eventType) : all;
  // Return defensive copies to prevent external mutation (item 30)
  return filtered.map((h) => ({ ...h }));
}

/**
 * Retrieve a single hook subscription by its ID.
 *
 * @param subscriptionId - The UUID to look up.
 * @returns A copy of the {@link HookSubscription} if found, otherwise `undefined`.
 */
export function getHook(subscriptionId: string): HookSubscription | undefined {
  const hook = _hooks.get(subscriptionId);
  // Return a defensive copy to prevent external mutation (item 30)
  return hook ? { ...hook } : undefined;
}

// ============================================================================
// HMAC SIGNING
// ============================================================================

/**
 * Compute an HMAC-SHA256 hex digest of the given body using the provided secret.
 *
 * The resulting signature is sent in the `X-Draymond-Signature` header so
 * receivers can verify payload authenticity.
 *
 * @param body   - The raw JSON string to sign.
 * @param secret - The shared secret for this subscription.
 * @returns A lowercase hex-encoded HMAC-SHA256 digest.
 */
function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// ============================================================================
// EVENT DISPATCH
// ============================================================================

/** Delivery timeout for each webhook POST (milliseconds). */
const DELIVERY_TIMEOUT_MS = 5_000;

/**
 * Dispatch a lifecycle event to all matching webhook subscriptions.
 *
 * Matching logic:
 * 1. The subscription must be active (`is_active === true`).
 * 2. The subscription's `event_type` must match exactly **or** be `'*'`.
 * 3. If the subscription has an `agent_filter`, the caller-supplied `agentId`
 *    must match.
 * 4. If the subscription has an `entity_filter`, the caller-supplied `entityId`
 *    must match.
 *
 * Delivery is concurrent (`Promise.allSettled`). On success the subscription's
 * `failure_count` is reset to 0. On failure it is incremented, and if it
 * reaches `max_failures` the subscription is deactivated.
 *
 * @param eventType - The event type being dispatched.
 * @param data      - Arbitrary event data to include in the payload.
 * @param agentId   - Optional agent ID for agent-scoped filtering.
 * @param entityId  - Optional entity ID for entity-scoped filtering.
 * @returns Counts of successfully dispatched and failed deliveries.
 *
 * @example
 * ```ts
 * const result = await dispatchEvent('chain.completed', {
 *   chain_id: 'abc-123',
 *   duration_ms: 4200,
 * });
 * console.log(`Dispatched: ${result.dispatched}, Failed: ${result.failed}`);
 * ```
 */
export async function dispatchEvent(
  eventType: HookEventType,
  data: Record<string, unknown>,
  agentId?: string,
  entityId?: string
): Promise<{ dispatched: number; failed: number }> {
  // 1. Find matching subscriptions
  const matching = Array.from(_hooks.values()).filter((hook) => {
    if (!hook.is_active) return false;
    if (hook.event_type !== eventType && hook.event_type !== '*') return false;
    if (hook.agent_filter && hook.agent_filter !== agentId) return false;
    if (hook.entity_filter && hook.entity_filter !== entityId) return false;
    return true;
  });

  if (matching.length === 0) {
    return { dispatched: 0, failed: 0 };
  }

  const timestamp = new Date().toISOString();

  // 2. Deliver concurrently
  const results = await Promise.allSettled(
    matching.map((hook) => deliverToHook(hook, eventType, data, timestamp))
  );

  // 3. Tally results
  let dispatched = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      dispatched++;
    } else {
      failed++;
    }
  }

  return { dispatched, failed };
}

/**
 * Deliver a single event payload to one webhook subscription.
 *
 * @returns `true` on successful delivery (HTTP 2xx), `false` on failure.
 */
async function deliverToHook(
  hook: HookSubscription,
  eventType: HookEventType,
  data: Record<string, unknown>,
  timestamp: string
): Promise<boolean> {
  const payload: HookPayload = {
    event_type: eventType,
    timestamp,
    subscription_id: hook.id,
    data,
  };

  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // HMAC signing
  if (hook.secret) {
    headers['X-Draymond-Signature'] = signPayload(body, hook.secret);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(hook.callback_url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      // Success — reset failure count on the authoritative map entry (item 26)
      const current = _hooks.get(hook.id);
      if (current) current.failure_count = 0;
      return true;
    }

    // Non-2xx response — treat as failure
    handleDeliveryFailure(
      hook,
      `HTTP ${response.status} ${response.statusText}`
    );
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    handleDeliveryFailure(hook, message);
    return false;
  }
}

/**
 * Increment a subscription's failure count and auto-disable if the threshold
 * is reached. Uses atomic read-modify-write on the internal map entry to
 * prevent race condition on concurrent dispatches (item 26).
 */
function handleDeliveryFailure(hook: HookSubscription, reason: string): void {
  // Re-read the hook from the map to get the current state
  const current = _hooks.get(hook.id);
  if (!current) return; // hook was removed during dispatch

  current.failure_count++;

  if (current.failure_count >= current.max_failures) {
    current.is_active = false;
    console.warn(
      `[Draymond Hooks] Subscription ${current.id} disabled after ${current.failure_count} consecutive failures (last: ${reason})`
    );
  } else {
    console.warn(
      `[Draymond Hooks] Delivery failed for subscription ${current.id} (${current.failure_count}/${current.max_failures}): ${reason}`
    );
  }
}

// ============================================================================
// INTEGRATION HELPER
// ============================================================================

/**
 * Fire-and-forget hook notification.
 *
 * This is the primary integration point for other Draymond modules. It calls
 * {@link dispatchEvent} without awaiting the result and swallows any errors,
 * logging them to the console instead. The caller is never blocked or
 * interrupted by webhook delivery.
 *
 * @param eventType - The lifecycle event type.
 * @param data      - Arbitrary event data.
 * @param agentId   - Optional agent ID for scoped delivery.
 * @param entityId  - Optional entity ID for scoped delivery.
 *
 * @example
 * ```ts
 * // In a chain executor:
 * notifyHooks('chain.started', { chain_id: chain.id, name: chain.name }, chain.agent_id);
 *
 * // In a health monitor:
 * notifyHooks('agent.health_changed', { status: 'degraded', reason }, agentId);
 * ```
 */
export function notifyHooks(
  eventType: HookEventType,
  data: Record<string, unknown>,
  agentId?: string,
  entityId?: string
): void {
  dispatchEvent(eventType, data, agentId, entityId).catch((err) => {
    console.error(
      '[Draymond Hooks] notifyHooks dispatch error:',
      err instanceof Error ? err.message : String(err)
    );
  });
}

// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Reactive Event System
// ============================================================================
// Event subscriptions, cross-chain triggers, and conditional chain spawning.
//
// This module adds a pub/sub layer on top of the existing event-bridge:
// 1. Subscriptions — define patterns that match events and trigger actions
// 2. Event processing — when events fire, match them against subscriptions
// 3. Action execution — invoke entities, execute chains, or emit new events
//
// Example: "When chain.completed fires for the daily-report chain,
//           automatically invoke the email-sender entity."
// ============================================================================

import { createDraymondClient } from './client';
import { logEvent } from './index';
import { invokeEntity } from './invoker';
import { getEntity } from './registry';
import { instantiateChain, executeChain } from './chains';
import { hostIsLocalServiceAllowed } from './ssrf';
import type {
  EventPattern,
  EventSubscription,
  EventSubscriptionInsert,
} from './types';

// -- In-memory subscription cache ---------------------------------------------
// Subscriptions are cached to avoid DB hits on every event.
// Cache is invalidated on create/update/delete.

let _subscriptionCache: EventSubscription[] | null = null;
let _cacheExpires = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function getActiveSubscriptions(): Promise<EventSubscription[]> {
  if (_subscriptionCache && Date.now() < _cacheExpires) {
    return _subscriptionCache;
  }

  const supabase = await createDraymondClient();
  const { data, error } = await supabase
    .from('draymond_event_subscriptions')
    .select('*')
    .eq('is_active', true)
    .order('created_at');

  if (error) {
    console.error(`[Draymond/Reactive] Failed to load subscriptions: ${error.message}`);
    return _subscriptionCache || [];
  }

  _subscriptionCache = (data || []) as EventSubscription[];
  _cacheExpires = Date.now() + CACHE_TTL_MS;
  return _subscriptionCache;
}

export function invalidateSubscriptionCache(): void {
  _subscriptionCache = null;
  _cacheExpires = 0;
}

// -- Debounce tracking --------------------------------------------------------

const _lastTriggered = new Map<string, number>();
const _DEBOUNCE_MAP_MAX_SIZE = 10_000;

function pruneDebounceMap(): void {
  if (_lastTriggered.size <= _DEBOUNCE_MAP_MAX_SIZE) return;
  const now = Date.now();
  // Remove entries older than 1 hour
  for (const [key, ts] of _lastTriggered) {
    if (now - ts > 3_600_000) _lastTriggered.delete(key);
  }
  // If still too large, remove oldest half
  if (_lastTriggered.size > _DEBOUNCE_MAP_MAX_SIZE) {
    const entries = [..._lastTriggered.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, Math.floor(entries.length / 2));
    for (const [key] of toRemove) _lastTriggered.delete(key);
  }
}

function shouldDebounce(subscriptionId: string, debounceMs: number | undefined): boolean {
  if (!debounceMs || debounceMs <= 0) return false;

  const lastTime = _lastTriggered.get(subscriptionId);
  if (lastTime && Date.now() - lastTime < debounceMs) {
    return true;
  }
  return false;
}

function recordTrigger(subscriptionId: string): void {
  _lastTriggered.set(subscriptionId, Date.now());
  pruneDebounceMap();
}

// -- Subscription CRUD --------------------------------------------------------

/**
 * Create a new event subscription.
 */
export async function createSubscription(
  input: EventSubscriptionInsert
): Promise<EventSubscription> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_event_subscriptions')
    .insert({
      name: input.name,
      description: input.description,
      pattern: input.pattern,
      action_type: input.action_type,
      action_config: input.action_config,
      is_active: input.is_active ?? true,
      created_by: input.created_by,
      trigger_count: 0,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create subscription: ${error.message}`);

  invalidateSubscriptionCache();

  await logEvent({
    agent_id: 'draymond-reactive',
    category: 'action',
    severity: 'info',
    event_type: 'subscription_created',
    message: `Created event subscription "${input.name}" for ${input.pattern.event_type}`,
    metadata: { subscription_id: (data as EventSubscription).id, pattern: input.pattern },
  }).catch(() => {});

  return data as EventSubscription;
}

/**
 * List all subscriptions (active and inactive).
 */
export async function listSubscriptions(
  activeOnly: boolean = false
): Promise<EventSubscription[]> {
  const supabase = await createDraymondClient();

  let query = supabase
    .from('draymond_event_subscriptions')
    .select('*')
    .order('created_at', { ascending: false });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list subscriptions: ${error.message}`);
  return (data || []) as EventSubscription[];
}

/**
 * Update a subscription's active state.
 */
export async function toggleSubscription(
  subscriptionId: string,
  isActive: boolean
): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase
    .from('draymond_event_subscriptions')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', subscriptionId);

  if (error) throw new Error(`Failed to toggle subscription: ${error.message}`);
  invalidateSubscriptionCache();
}

/**
 * Delete a subscription.
 */
export async function deleteSubscription(subscriptionId: string): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase
    .from('draymond_event_subscriptions')
    .delete()
    .eq('id', subscriptionId);

  if (error) throw new Error(`Failed to delete subscription: ${error.message}`);
  invalidateSubscriptionCache();
}

// -- Pattern matching ---------------------------------------------------------

/**
 * Check if an event matches a subscription pattern.
 *
 * Supports:
 * - Exact event_type match
 * - Wildcard patterns: "chain.*" matches "chain.completed", "chain.failed", etc.
 * - Condition matching: shallow key-value checks on event data
 */
function matchesPattern(
  eventType: string,
  eventData: Record<string, unknown>,
  pattern: EventPattern
): boolean {
  // Event type matching (supports wildcards)
  const patternType = pattern.event_type;

  if (patternType.includes('*')) {
    // Wildcard pattern: "chain.*" → /^chain\..+$/. Escape every regex
    // metacharacter first (except the wildcard) so a pattern can never widen
    // the match or cause catastrophic backtracking.
    const escaped = patternType.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.+' : `\\${m}`));
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `escaped` is fully regex-escaped above and the pattern is developer-defined config.
    const regex = new RegExp('^' + escaped + '$');
    if (!regex.test(eventType)) return false;
  } else {
    if (eventType !== patternType) return false;
  }

  // Condition matching (shallow key-value checks)
  if (pattern.conditions) {
    for (const [key, expectedValue] of Object.entries(pattern.conditions)) {
      const actualValue = getNestedValue(eventData, key);
      if (actualValue !== expectedValue) return false;
    }
  }

  return true;
}

/**
 * Get a nested value from an object using dot notation.
 * e.g., getNestedValue({ a: { b: 1 } }, "a.b") → 1
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    if (current == null || typeof current !== 'object') return undefined;
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- dangerous keys are rejected above; read-only traversal.
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// -- Event processing ---------------------------------------------------------

/**
 * Process an event through the reactive system.
 *
 * This is the main entry point. Call this whenever an event occurs
 * (from the event bridge, chain engine, scheduler, etc.).
 *
 * It matches the event against all active subscriptions and triggers
 * the appropriate actions.
 */
export async function processEvent(
  eventType: string,
  source: string,
  data: Record<string, unknown>
): Promise<{
  matched: number;
  triggered: number;
  errors: string[];
}> {
  const subscriptions = await getActiveSubscriptions();
  const matched: EventSubscription[] = [];
  const errors: string[] = [];
  let triggered = 0;

  // Find matching subscriptions
  for (const sub of subscriptions) {
    if (matchesPattern(eventType, data, sub.pattern)) {
      matched.push(sub);
    }
  }

  if (matched.length === 0) {
    return { matched: 0, triggered: 0, errors: [] };
  }

  // Record the event
  const supabase = await createDraymondClient();
  const { data: eventRecord } = await supabase
    .from('draymond_reactive_events')
    .insert({
      event_type: eventType,
      source,
      data,
      matched_subscriptions: matched.map((s) => s.id),
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  // Execute actions for matched subscriptions (in parallel)
  await Promise.allSettled(
    matched.map(async (sub) => {
      // Check debounce
      if (shouldDebounce(sub.id, sub.pattern.debounce_ms)) {
        return; // Skip — too soon since last trigger
      }

      try {
        await executeSubscriptionAction(sub, eventType, data);
        recordTrigger(sub.id);
        triggered++;

        // Update trigger count and last_triggered_at
        await supabase
          .from('draymond_event_subscriptions')
          .update({
            trigger_count: (sub.trigger_count || 0) + 1,
            last_triggered_at: new Date().toISOString(),
          })
          .eq('id', sub.id);
      } catch (err) {
        const errMsg = `Subscription "${sub.name}" action failed: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errMsg);

        await logEvent({
          agent_id: 'draymond-reactive',
          category: 'action',
          severity: 'error',
          event_type: 'subscription_action_failed',
          message: errMsg,
          metadata: {
            subscription_id: sub.id,
            trigger_event: eventType,
            action_type: sub.action_type,
          },
        }).catch(() => {});
      }
    })
  );

  // Update event as processed
  if (eventRecord) {
    await supabase
      .from('draymond_reactive_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', (eventRecord as { id: string }).id);
  }

  // Log the processing result
  if (triggered > 0) {
    await logEvent({
      agent_id: 'draymond-reactive',
      category: 'action',
      severity: 'info',
      event_type: 'events_processed',
      message: `Event "${eventType}" matched ${matched.length} subscription(s), triggered ${triggered} action(s)`,
      metadata: {
        event_type: eventType,
        source,
        matched_count: matched.length,
        triggered_count: triggered,
        error_count: errors.length,
      },
    }).catch(() => {});
  }

  return { matched: matched.length, triggered, errors };
}

// -- Action execution ---------------------------------------------------------

/**
 * Execute the action defined by a subscription.
 */
async function executeSubscriptionAction(
  sub: EventSubscription,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  const config = sub.action_config;

  // Resolve input mapping — map event data fields to action inputs
  const input = resolveInputMapping(config.input_mapping, eventData, eventType);

  switch (sub.action_type) {
    case 'invoke_entity': {
      if (!config.entity_slug) {
        throw new Error(`Subscription "${sub.name}" missing entity_slug`);
      }

      const entity = await getEntity(config.entity_slug);
      if (!entity) {
        throw new Error(`Entity "${config.entity_slug}" not found`);
      }

      await invokeEntity(
        {
          id: entity.id,
          slug: entity.slug,
          name: entity.name,
          kind: entity.kind,
          invocation_method: entity.invocation_method,
          invocation_config: (entity.invocation_config as Record<string, unknown>) ?? {},
          timeout_seconds: entity.timeout_seconds ?? 30,
        },
        'default',
        input
      );
      break;
    }

    case 'execute_chain': {
      if (!config.chain_slug) {
        throw new Error(`Subscription "${sub.name}" missing chain_slug`);
      }

      const instance = await instantiateChain(config.chain_slug, input);
      await executeChain(instance.id);
      break;
    }

    case 'emit_event': {
      if (!config.event_type) {
        throw new Error(`Subscription "${sub.name}" missing event_type for emit_event action`);
      }

      // Guard against infinite loops — both direct self-loops AND indirect cycles.
      // Build the ancestry chain from _event_chain (or start from current event).
      const eventChain: string[] = Array.isArray(eventData._event_chain)
        ? (eventData._event_chain as string[])
        : [];
      const fullChain = [...eventChain, eventType];

      if (fullChain.includes(config.event_type)) {
        throw new Error(
          `Refusing to emit "${config.event_type}" — cycle detected in event chain: ${fullChain.join(' → ')} → ${config.event_type}`
        );
      }

      // Cap chain depth to prevent runaway chains even without cycles
      const MAX_EVENT_CHAIN_DEPTH = 10;
      if (fullChain.length >= MAX_EVENT_CHAIN_DEPTH) {
        throw new Error(
          `Event chain depth limit (${MAX_EVENT_CHAIN_DEPTH}) exceeded: ${fullChain.join(' → ')}`
        );
      }

      await processEvent(config.event_type, `reactive:${sub.name}`, {
        ...input,
        _triggered_by: eventType,
        _subscription: sub.name,
        _event_chain: fullChain,
      });
      break;
    }

    case 'webhook': {
      if (!config.webhook_url) {
        throw new Error(`Subscription "${sub.name}" missing webhook_url`);
      }

      // SSRF guard — only allow HTTPS and block private/internal IPs. Fleet
      // services on the LOCAL_SERVICE_ALLOWLIST are trusted and may use http.
      const url = new URL(config.webhook_url);
      const hostname = url.hostname.toLowerCase();
      const isLocalService = hostIsLocalServiceAllowed(hostname);
      if (url.protocol !== 'https:' && !isLocalService) {
        throw new Error('Webhook URL must use HTTPS');
      }
      // Block known internal/metadata hostnames and private IP patterns
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', 'metadata.google.internal', '[::1]'];
      if (!isLocalService && (blockedHosts.includes(hostname) || hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.'))) {
        throw new Error('Webhook URL must not target private or internal addresses');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch(config.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: eventType,
            subscription: sub.name,
            data: input,
            timestamp: new Date().toISOString(),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Webhook returned ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
      break;
    }

    default:
      throw new Error(`Unknown action type: ${sub.action_type}`);
  }
}

/**
 * Resolve input mapping from event data.
 * Maps keys like "chain_name" → "$.data.chain_name" using simple JSONPath.
 */
function resolveInputMapping(
  mapping: Record<string, string> | undefined,
  eventData: Record<string, unknown>,
  eventType: string
): Record<string, unknown> {
  if (!mapping || Object.keys(mapping).length === 0) {
    return { ...eventData, _event_type: eventType };
  }

  const resolved: Record<string, unknown> = {};

  for (const [outputKey, sourcePath] of Object.entries(mapping)) {
    if (sourcePath.startsWith('$.')) {
      // JSONPath-like: $.data.chain_name
      const path = sourcePath.slice(2); // Remove "$."
      resolved[outputKey] = getNestedValue(eventData, path);
    } else if (sourcePath.startsWith('$event.')) {
      // Event metadata
      const field = sourcePath.slice(7);
      if (field === 'type') resolved[outputKey] = eventType;
      else if (field === 'timestamp') resolved[outputKey] = new Date().toISOString();
      else resolved[outputKey] = undefined;
    } else {
      // Literal value
      resolved[outputKey] = sourcePath;
    }
  }

  return resolved;
}

// -- Convenience: hook into event-bridge --------------------------------------

/**
 * Adapter to connect the reactive system to the existing event-bridge.
 * Call this from the event-bridge's emit function to process events reactively.
 */
export async function onBridgeEvent(
  type: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await processEvent(type, 'event-bridge', data);
  } catch (err) {
    console.error(
      '[Draymond/Reactive] Failed to process bridge event "%s":',
      type,
      err instanceof Error ? err.message : err
    );
  }
}

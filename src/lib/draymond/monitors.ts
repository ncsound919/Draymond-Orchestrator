// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Site Monitoring Service
// ============================================================================
// Uptime monitoring for Uplift Ecosystem websites and services.
// Checks sites against expected status codes, tracks consecutive failures,
// triggers notifications on outages and recoveries.
//
// Table: draymond_site_monitors (see migration 004)
// ============================================================================

import { createDraymondAdminClient } from './client';
import { sendNotification } from './notifications';
import { emitSiteDown, emitSiteRecovered, emitHealthCheckComplete } from '@/lib/draymond/event-bridge';

// ============================================================================
// TYPES
// ============================================================================

export type MonitorStatus = 'up' | 'down' | 'degraded' | 'unknown';

export interface SiteMonitor {
  id: string;
  name: string;
  url: string;
  check_interval_seconds: number;
  expected_status_code: number;
  timeout_ms: number;
  is_enabled: boolean;
  current_status: MonitorStatus;
  last_check_at: string | null;
  last_status_code: number | null;
  last_response_time_ms: number | null;
  consecutive_failures: number;
  max_failures_before_alert: number;
  notify_on_down: boolean;
  notify_on_recovery: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateMonitorInput {
  name: string;
  url: string;
  check_interval_seconds?: number;
  expected_status_code?: number;
  timeout_ms?: number;
  max_failures_before_alert?: number;
  notify_on_down?: boolean;
  notify_on_recovery?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateMonitorInput {
  name?: string;
  url?: string;
  check_interval_seconds?: number;
  expected_status_code?: number;
  timeout_ms?: number;
  is_enabled?: boolean;
  max_failures_before_alert?: number;
  notify_on_down?: boolean;
  notify_on_recovery?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MonitorListFilters {
  is_enabled?: boolean;
  current_status?: MonitorStatus;
  limit?: number;
}

export interface SiteCheckResult {
  monitor_id: string;
  monitor_name: string;
  url: string;
  status_code: number | null;
  response_time_ms: number | null;
  is_up: boolean;
  previous_status: MonitorStatus;
  new_status: MonitorStatus;
  consecutive_failures: number;
  error?: string;
}

export interface CheckAllSitesResult {
  checked_at: string;
  total: number;
  up: number;
  down: number;
  errors: number;
  results: SiteCheckResult[];
}

export interface MonitorStats {
  id: string;
  name: string;
  url: string;
  current_status: MonitorStatus;
  last_check_at: string | null;
  last_status_code: number | null;
  last_response_time_ms: number | null;
  consecutive_failures: number;
  is_enabled: boolean;
}

// ============================================================================
// NOTIFICATION RECIPIENT
// ============================================================================

const NOTIFICATION_RECIPIENT =
  process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? '';

// ============================================================================
// CRUD: List / Get / Create / Update / Delete
// ============================================================================

/**
 * List site monitors with optional filters.
 */
export async function listMonitors(
  filters?: MonitorListFilters
): Promise<SiteMonitor[]> {
  const supabase = createDraymondAdminClient();
  const safeLimit = Math.min(Math.max(filters?.limit ?? 100, 1), 500);

  let query = supabase
    .from('draymond_site_monitors')
    .select('*')
    .order('name', { ascending: true })
    .limit(safeLimit);

  if (filters?.is_enabled !== undefined) {
    query = query.eq('is_enabled', filters.is_enabled);
  }
  if (filters?.current_status) {
    query = query.eq('current_status', filters.current_status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list monitors: ${error.message}`);
  }

  return (data ?? []) as SiteMonitor[];
}

/**
 * Get a single site monitor by ID.
 */
export async function getMonitor(id: string): Promise<SiteMonitor> {
  const supabase = createDraymondAdminClient();

  const { data, error } = await supabase
    .from('draymond_site_monitors')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw new Error(
      `Monitor ${id} not found: ${error?.message ?? 'no data returned'}`
    );
  }

  return data as SiteMonitor;
}

/**
 * Create a new site monitor.
 */
export async function createMonitor(
  input: CreateMonitorInput
): Promise<SiteMonitor> {
  const supabase = createDraymondAdminClient();

  const { data, error } = await supabase
    .from('draymond_site_monitors')
    .insert({
      name: input.name,
      url: input.url,
      check_interval_seconds: input.check_interval_seconds ?? 300,
      expected_status_code: input.expected_status_code ?? 200,
      timeout_ms: input.timeout_ms ?? 10000,
      max_failures_before_alert: input.max_failures_before_alert ?? 3,
      notify_on_down: input.notify_on_down ?? true,
      notify_on_recovery: input.notify_on_recovery ?? true,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create monitor: ${error?.message ?? 'no data returned'}`
    );
  }

  return data as SiteMonitor;
}

/**
 * Update an existing site monitor.
 */
export async function updateMonitor(
  id: string,
  updates: UpdateMonitorInput
): Promise<SiteMonitor> {
  const supabase = createDraymondAdminClient();

  const { data, error } = await supabase
    .from('draymond_site_monitors')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update monitor ${id}: ${error?.message ?? 'no data returned'}`
    );
  }

  return data as SiteMonitor;
}

/**
 * Delete a site monitor.
 */
export async function deleteMonitor(id: string): Promise<void> {
  const supabase = createDraymondAdminClient();

  const { error } = await supabase
    .from('draymond_site_monitors')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete monitor ${id}: ${error.message}`);
  }
}

// ============================================================================
// SITE CHECKING
// ============================================================================

/**
 * Check a single site by its monitor ID.
 *
 * Flow:
 * 1. Fetch the URL with the configured timeout
 * 2. Compare status code against expected_status_code
 * 3. If mismatch: increment consecutive_failures
 *    - If consecutive_failures >= max_failures_before_alert AND current_status != 'down':
 *      Set current_status = 'down', send site_down notification
 * 4. If match AND current_status == 'down':
 *    Reset consecutive_failures, set current_status = 'up',
 *    send site_recovered notification if notify_on_recovery
 * 5. Update last_check_at, last_status_code, last_response_time_ms
 */
export async function checkSite(monitorId: string): Promise<SiteCheckResult> {
  const supabase = createDraymondAdminClient();

  // 1. Fetch monitor config
  const monitor = await getMonitor(monitorId);

  const previousStatus = monitor.current_status;
  let statusCode: number | null = null;
  let responseTimeMs: number | null = null;
  let isUp = false;
  let fetchError: string | undefined;

  // 2. Perform the HTTP check
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), monitor.timeout_ms);

    const response = await fetch(monitor.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'Draymond-Monitor/1.0',
      },
    });

    clearTimeout(timeoutId);
    responseTimeMs = Date.now() - startTime;
    statusCode = response.status;
    isUp = statusCode === monitor.expected_status_code;
  } catch (err) {
    responseTimeMs = Date.now() - startTime;
    fetchError =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Timeout after ${monitor.timeout_ms}ms`
          : err.message
        : String(err);
    isUp = false;
  }

  // 3. Compute new state
  let newConsecutiveFailures = monitor.consecutive_failures;
  let newStatus: MonitorStatus = monitor.current_status;

  if (!isUp) {
    // Site check failed
    newConsecutiveFailures += 1;

    if (
      newConsecutiveFailures >= monitor.max_failures_before_alert &&
      monitor.current_status !== 'down'
    ) {
      newStatus = 'down';

      // Send site_down notification
      if (monitor.notify_on_down && NOTIFICATION_RECIPIENT) {
        try {
          await sendNotification({
            channel: 'email',
            recipient: NOTIFICATION_RECIPIENT,
            subject: `${monitor.name} is DOWN`,
            body: [
              `Site "${monitor.name}" (${monitor.url}) is unreachable.`,
              '',
              `Expected status: ${monitor.expected_status_code}`,
              `Received status: ${statusCode ?? 'N/A'}`,
              `Response time: ${responseTimeMs ?? 'N/A'}ms`,
              `Consecutive failures: ${newConsecutiveFailures}`,
              fetchError ? `Error: ${fetchError}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            type: 'site_down',
            priority: 'high',
            metadata: {
              monitor_id: monitor.id,
              monitor_name: monitor.name,
              url: monitor.url,
              status_code: statusCode,
              response_time_ms: responseTimeMs,
              consecutive_failures: newConsecutiveFailures,
              error: fetchError,
            },
          });
        } catch (notifErr) {
          console.error(
            `[Draymond Monitors] Failed to send site_down notification for ${monitor.name}:`,
            notifErr instanceof Error ? notifErr.message : notifErr
          );
        }
      }

      emitSiteDown(monitor.id, monitor.name, monitor.url, statusCode, responseTimeMs, newConsecutiveFailures);
    }
  } else {
    // Site is up
    if (monitor.current_status === 'down') {
      // Recovery
      newStatus = 'up';
      newConsecutiveFailures = 0;

      if (monitor.notify_on_recovery && NOTIFICATION_RECIPIENT) {
        try {
          await sendNotification({
            channel: 'email',
            recipient: NOTIFICATION_RECIPIENT,
            subject: `${monitor.name} has RECOVERED`,
            body: [
              `Site "${monitor.name}" (${monitor.url}) is back up.`,
              '',
              `Status code: ${statusCode}`,
              `Response time: ${responseTimeMs}ms`,
              `Was down for ${monitor.consecutive_failures} consecutive check(s).`,
            ].join('\n'),
            type: 'site_recovered',
            priority: 'normal',
            metadata: {
              monitor_id: monitor.id,
              monitor_name: monitor.name,
              url: monitor.url,
              status_code: statusCode,
              response_time_ms: responseTimeMs,
              previous_consecutive_failures: monitor.consecutive_failures,
            },
          });
        } catch (notifErr) {
          console.error(
            `[Draymond Monitors] Failed to send site_recovered notification for ${monitor.name}:`,
            notifErr instanceof Error ? notifErr.message : notifErr
          );
        }
      }

      emitSiteRecovered(monitor.id, monitor.name, monitor.url, statusCode, responseTimeMs);
    } else {
      // Was already up (or unknown) — just mark as up
      newStatus = 'up';
      newConsecutiveFailures = 0;
    }
  }

  // 4. Persist updated state
  const { error: updateError } = await supabase
    .from('draymond_site_monitors')
    .update({
      current_status: newStatus,
      last_check_at: new Date().toISOString(),
      last_status_code: statusCode,
      last_response_time_ms: responseTimeMs,
      consecutive_failures: newConsecutiveFailures,
    })
    .eq('id', monitor.id);

  if (updateError) {
    console.error(
      `[Draymond Monitors] Failed to update monitor ${monitor.name}:`,
      updateError.message
    );
  }

  return {
    monitor_id: monitor.id,
    monitor_name: monitor.name,
    url: monitor.url,
    status_code: statusCode,
    response_time_ms: responseTimeMs,
    is_up: isUp,
    previous_status: previousStatus,
    new_status: newStatus,
    consecutive_failures: newConsecutiveFailures,
    error: fetchError,
  };
}

/**
 * Check all enabled site monitors and return a summary.
 */
export async function checkAllSites(): Promise<CheckAllSitesResult> {
  const monitors = await listMonitors({ is_enabled: true });

  const results: SiteCheckResult[] = [];

  // Run checks sequentially to avoid overwhelming targets
  for (const monitor of monitors) {
    try {
      const result = await checkSite(monitor.id);
      results.push(result);
    } catch (err) {
      results.push({
        monitor_id: monitor.id,
        monitor_name: monitor.name,
        url: monitor.url,
        status_code: null,
        response_time_ms: null,
        is_up: false,
        previous_status: monitor.current_status,
        new_status: monitor.current_status,
        consecutive_failures: monitor.consecutive_failures,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const upCount = results.filter((r) => r.is_up).length;
  const downCount = results.filter((r) => !r.is_up).length;
  const errorCount = results.filter((r) => !!r.error).length;

  emitHealthCheckComplete(results.length, upCount, downCount);

  return {
    checked_at: new Date().toISOString(),
    total: results.length,
    up: upCount,
    down: downCount,
    errors: errorCount,
    results,
  };
}

// ============================================================================
// AGENT HEALTH MONITOR SEEDING
// ============================================================================

/**
 * Pre-defined site monitors for the entire Uplift agent fleet.
 * Each agent with an HTTP health endpoint gets a monitor entry.
 * Agents without HTTP (Sub Team, TradingAgents) are excluded.
 */
interface AgentMonitorDef {
  name: string;
  url: string;
  check_interval_seconds: number;
  expected_status_code: number;
  timeout_ms: number;
  metadata: Record<string, unknown>;
}

function getAgentMonitorDefs(): AgentMonitorDef[] {
  return [
    {
      name: 'Uplift Agent',
      url: `${process.env.UPLIFT_BASE_URL || 'http://localhost:8000'}/health`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'uplift-agent', category: 'automation' },
    },
    {
      name: 'Sports Steve',
      url: `${process.env.SPORTS_STEVE_URL || 'http://localhost:8010'}/health`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'sports-steve', category: 'sports' },
    },
    {
      name: 'Bet Buddy',
      url: `${process.env.BET_BUDDY_URL || 'http://localhost:3001'}/health`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'bet-buddy', category: 'sports' },
    },
    {
      name: 'Social Media Dashboard',
      url: `${process.env.SOCIAL_MEDIA_URL || 'http://localhost:8030'}/api/ai/health`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'social-media-dashboard', category: 'marketing' },
    },
    {
      name: 'OmniResearch Pro',
      url: `${process.env.OMNI_RESEARCH_URL || 'http://localhost:3010'}/api/health`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'omni-research', category: 'research' },
    },
    {
      name: 'Indy Music Platform',
      url: `${process.env.INDY_MUSIC_URL || 'http://localhost:8020'}/health`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'indy-music-platform', category: 'music' },
    },
    {
      name: 'MegaCode',
      url: `${process.env.MEGACODE_URL || 'http://localhost:9744'}/health`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'megacode', category: 'development' },
    },
    {
      name: 'Overlay Chain',
      url: `${process.env.OVERLAY_CHAIN_URL || 'http://localhost:3020'}/api`,
      check_interval_seconds: 300,
      expected_status_code: 200,
      timeout_ms: 10000,
      metadata: { slug: 'overlay-chain', category: 'supply-chain' },
    },
  ];
}

export interface SeedMonitorsResult {
  created: number;
  skipped: number;
  errors: string[];
  names: string[];
}

/**
 * Seed site monitors for all agents with HTTP health endpoints.
 *
 * Uses upsert (matched by name) to remain idempotent and avoid race conditions
 * when multiple seed calls run concurrently.
 */
export async function seedAgentMonitors(): Promise<SeedMonitorsResult> {
  const supabase = createDraymondAdminClient();
  const defs = getAgentMonitorDefs();
  const result: SeedMonitorsResult = {
    created: 0,
    skipped: 0,
    errors: [],
    names: [],
  };

  for (const def of defs) {
    try {
      // Use upsert to atomically create-or-update. The `name` column has a
      // unique constraint (from the migration), so onConflict works correctly.
      const { data, error } = await supabase
        .from('draymond_site_monitors')
        .upsert(
          {
            name: def.name,
            url: def.url,
            check_interval_seconds: def.check_interval_seconds,
            expected_status_code: def.expected_status_code,
            timeout_ms: def.timeout_ms,
            max_failures_before_alert: 3,
            notify_on_down: true,
            notify_on_recovery: true,
            metadata: def.metadata,
          },
          { onConflict: 'name' }
        )
        .select('id, created_at, updated_at')
        .single();

      if (error) {
        result.errors.push(
          `[monitor:${def.name}] ${error.message}`
        );
        continue;
      }

      // If created_at equals updated_at, this was a new insert
      const isNew = data && data.created_at === data.updated_at;
      if (isNew) {
        result.created += 1;
      } else {
        result.skipped += 1;
      }
      result.names.push(def.name);
    } catch (err) {
      result.errors.push(
        `[monitor:${def.name}] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

// ============================================================================
// STATS
// ============================================================================

/**
 * Get current status info for a specific monitor.
 */
export async function getMonitorStats(monitorId: string): Promise<MonitorStats> {
  const monitor = await getMonitor(monitorId);

  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    current_status: monitor.current_status,
    last_check_at: monitor.last_check_at,
    last_status_code: monitor.last_status_code,
    last_response_time_ms: monitor.last_response_time_ms,
    consecutive_failures: monitor.consecutive_failures,
    is_enabled: monitor.is_enabled,
  };
}

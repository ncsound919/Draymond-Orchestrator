export const dynamic = 'force-dynamic';

import { createDraymondAdminClient } from '@/lib/draymond/client';
import type { Metadata } from 'next';
import type { DraymondAgent, DraymondChain, DraymondEntity } from '@/lib/draymond/types';
import type { ScheduledJob } from '@/lib/draymond/scheduler';
import type { SiteMonitor } from '@/lib/draymond/monitors';
import type { NotificationRecord } from '@/lib/draymond/notifications';
import QuickActionButton from '@/components/QuickActionButton';
import DataExportButton from '@/components/DataExportButton';

export const metadata: Metadata = {
  title: 'Operations Center | Draymond Orchestrator',
  description: 'Autonomous business system operations dashboard',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '--';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  degraded: 'bg-yellow-500',
  stalled: 'bg-orange-500',
  crashed: 'bg-red-500',
  recovering: 'bg-blue-500',
  suspended: 'bg-gray-500',
  terminated: 'bg-gray-700',
};

const STATUS_RING_COLORS: Record<string, string> = {
  active: 'ring-green-500/30',
  degraded: 'ring-yellow-500/30',
  stalled: 'ring-orange-500/30',
  crashed: 'ring-red-500/30',
  recovering: 'ring-blue-500/30',
  suspended: 'ring-gray-500/30',
  terminated: 'ring-gray-700/30',
};

const CHAIN_STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  active: 'bg-emerald-500/20 text-emerald-400',
  draft: 'bg-gray-500/20 text-gray-400',
  cancelled: 'bg-gray-500/20 text-gray-400',
  archived: 'bg-gray-500/20 text-gray-400',
};

const JOB_STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  running: 'bg-blue-500/20 text-blue-400',
  never: 'bg-gray-500/20 text-gray-400',
  skipped: 'bg-yellow-500/20 text-yellow-400',
};

const NOTIF_TYPE_COLORS: Record<string, string> = {
  agent_failure: 'bg-red-500/20 text-red-400',
  chain_completed: 'bg-green-500/20 text-green-400',
  chain_failed: 'bg-red-500/20 text-red-400',
  trade_signal: 'bg-blue-500/20 text-blue-400',
  site_down: 'bg-red-500/20 text-red-400',
  site_recovered: 'bg-green-500/20 text-green-400',
  health_summary: 'bg-blue-500/20 text-blue-400',
};

const ENTITY_HEALTH_COLORS: Record<string, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-gray-500',
};

const ENTITY_HEALTH_RING_COLORS: Record<string, string> = {
  healthy: 'ring-green-500/30',
  degraded: 'ring-yellow-500/30',
  unhealthy: 'ring-red-500/30',
  unknown: 'ring-gray-500/30',
};

const ENTITY_CATEGORY_COLORS: Record<string, string> = {
  automation: 'bg-purple-500/20 text-purple-400',
  finance: 'bg-emerald-500/20 text-emerald-400',
  sports: 'bg-orange-500/20 text-orange-400',
  marketing: 'bg-pink-500/20 text-pink-400',
  research: 'bg-blue-500/20 text-blue-400',
  music: 'bg-violet-500/20 text-violet-400',
  development: 'bg-cyan-500/20 text-cyan-400',
  'supply-chain': 'bg-amber-500/20 text-amber-400',
  engineering: 'bg-teal-500/20 text-teal-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400',
  normal: 'text-blue-400',
  high: 'text-yellow-400',
  critical: 'text-red-400',
};

// ---------------------------------------------------------------------------
// Data Fetching
// ---------------------------------------------------------------------------

async function fetchDashboardData() {
  const supabase = createDraymondAdminClient();

  const [
    { data: agents, error: agentsError },
    { data: entities, error: entitiesError },
    { data: chains, error: chainsError },
    { data: jobs, error: jobsError },
    { data: monitors, error: monitorsError },
    { data: notifications, error: notificationsError },
  ] = await Promise.all([
    supabase
      .from('draymond_agents')
      .select('*')
      .order('name'),
    supabase
      .from('draymond_entities')
      .select('*')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('draymond_chains')
      .select('*')
      .in('status', ['running', 'completed', 'failed', 'active', 'paused'])
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase
      .from('draymond_scheduled_jobs')
      .select('*')
      .order('name'),
    supabase
      .from('draymond_site_monitors')
      .select('*')
      .order('name'),
    supabase
      .from('draymond_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  // Log errors from each query so failures don't silently produce empty data.
  if (agentsError) console.error('[fetchDashboardData] agents error:', agentsError);
  if (entitiesError) console.error('[fetchDashboardData] entities error:', entitiesError);
  if (chainsError) console.error('[fetchDashboardData] chains error:', chainsError);
  if (jobsError) console.error('[fetchDashboardData] jobs error:', jobsError);
  if (monitorsError) console.error('[fetchDashboardData] monitors error:', monitorsError);
  if (notificationsError) console.error('[fetchDashboardData] notifications error:', notificationsError);

  return {
    agents: (agents ?? []) as DraymondAgent[],
    entities: (entities ?? []) as DraymondEntity[],
    chains: (chains ?? []) as DraymondChain[],
    jobs: (jobs ?? []) as ScheduledJob[],
    monitors: (monitors ?? []) as SiteMonitor[],
    notifications: (notifications ?? []) as NotificationRecord[],
  };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function OperationsPage() {
  // SECURITY TODO: Auth gate is currently disabled for local development.
  // BEFORE DEPLOYING TO PRODUCTION, re-enable the admin role check below.
  // Access to this page is controlled by middleware.ts (purchase verification),
  // but row-level admin verification is also required to prevent privilege escalation.
  // const supabase = await createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  // if (!user) redirect('/auth/login');
  // const { data: profile } = await (supabase as any)
  //   .from('profiles').select('role').eq('id', user.id).single();
  // if (!profile || profile.role !== 'admin') redirect('/');

  let data: Awaited<ReturnType<typeof fetchDashboardData>>;
  try {
    data = await fetchDashboardData();
  } catch (err) {
    console.error('[OperationsPage] Failed to load dashboard data:', err);
    return (
      <div className="min-h-screen text-white">
        <div className="max-w-6xl mx-auto px-4 py-24 text-center">
          <p className="text-5xl mb-4 opacity-40">&#x26A0;</p>
          <h1 className="text-xl font-bold mb-2">Failed to load operations data</h1>
          <p className="text-white/40 text-sm">Could not connect to the database. Check your Supabase configuration and try again.</p>
        </div>
      </div>
    );
  }

  const { agents, entities, chains, jobs, monitors, notifications } = data;

  // Count from both draymond_agents AND draymond_entities for the status banner.
  // Agents (legacy) use status/consecutive_errors; entities use is_active + health_status.
  const agentHealthyCount = agents.filter(
    (a) => a.status === 'active' && a.consecutive_errors === 0,
  ).length;
  const agentDegradedCount = agents.filter(
    (a) => a.status === 'degraded' || a.consecutive_errors > 0,
  ).length;
  // DB query already filters is_active=true, so all returned entities are active.
  const entityActiveCount = entities.length;
  // Entities with unhealthy/degraded health_status count toward degraded total.
  const entityDegradedCount = entities.filter(
    (e: DraymondEntity) => e.health_status === 'unhealthy' || e.health_status === 'degraded',
  ).length;

  const healthyCount = agentHealthyCount + (entityActiveCount - entityDegradedCount);
  const degradedCount = agentDegradedCount + entityDegradedCount;
  const totalAgents = agents.length + entities.length;

  const systemHealth: 'green' | 'yellow' | 'red' =
    degradedCount === 0 && agents.every((a) => a.status === 'active')
      ? 'green'
      : agents.some((a) => a.status === 'crashed' || a.status === 'stalled')
        ? 'red'
        : degradedCount > 0
          ? 'yellow'
          : 'green';

  const bannerStyles = {
    green: 'from-green-500/20 to-green-900/10 border-green-500/30',
    yellow: 'from-yellow-500/20 to-yellow-900/10 border-yellow-500/30',
    red: 'from-red-500/20 to-red-900/10 border-red-500/30',
  };

  const bannerLabels = {
    green: 'All Systems Operational',
    yellow: 'Degraded Performance',
    red: 'System Issues Detected',
  };

  const bannerDotColors = {
    green: 'bg-green-400',
    yellow: 'bg-yellow-400',
    red: 'bg-red-400',
  };

  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Operations Center
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Draymond Orchestrator &mdash; Autonomous Business System
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* ── Section 1: System Status Banner ───────────────────────── */}
        <div
          className={`rounded-xl border bg-gradient-to-r p-5 ${bannerStyles[systemHealth]}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 rounded-full ${bannerDotColors[systemHealth]} animate-pulse`}
              />
              <span className="text-lg font-semibold text-white">
                {bannerLabels[systemHealth]}
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-300">
              <span>
                <span className="font-mono font-semibold text-white">{totalAgents}</span>{' '}
                Total Agents
              </span>
              <span>
                <span className="font-mono font-semibold text-green-400">{healthyCount}</span>{' '}
                Healthy
              </span>
              {degradedCount > 0 && (
                <span>
                  <span className="font-mono font-semibold text-yellow-400">
                    {degradedCount}
                  </span>{' '}
                  Degraded
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 2: Agent Fleet Status ──────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              Agent Fleet Status
            </h2>
            <DataExportButton
              label="Agents"
              data={agents.map(({ id, name, status, last_heartbeat, consecutive_errors }) => ({
                id, name, status, last_heartbeat, consecutive_errors,
              }))}
            />
          </div>
          {agents.length === 0 ? (
            <p className="text-sm text-gray-500">No agents registered.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-4 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-semibold text-white truncate pr-2">
                      {agent.name}
                    </h3>
                    <span
                      className={`mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${STATUS_COLORS[agent.status] ?? 'bg-gray-500'} ${STATUS_RING_COLORS[agent.status] ?? 'ring-gray-500/30'}`}
                      title={agent.status}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500 capitalize">
                    {agent.status}
                  </p>
                  <div className="mt-3 space-y-1 text-xs text-gray-400">
                    <div className="flex justify-between">
                      <span>Last heartbeat</span>
                      <span className="text-gray-300">
                        {relativeTime(agent.last_heartbeat)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Errors</span>
                      <span
                        className={
                          agent.consecutive_errors > 0
                            ? 'text-red-400 font-semibold'
                            : 'text-gray-300'
                        }
                      >
                        {agent.consecutive_errors}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
           )}
        </section>

        {/* ── Section 2b: Entity Registry (Full Fleet) ───────────────── */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xl font-semibold text-white">
              Entity Registry
            </h2>
            <DataExportButton
              label="Entities"
              data={entities.map(({ id, name, category, kind, health_status, invocation_method, last_invoked_at, description, capabilities }) => ({
                id, name, category, kind, health_status, invocation_method, last_invoked_at, description,
                // capabilities may be null in the DB despite the TypeScript type saying string[] — guard defensively.
                capabilities: (capabilities ?? []).join(', '),
              }))}
            />
          </div>
          <p className="text-xs text-gray-500 mb-4">
            {entities.length} registered entities across the Uplift Ecosystem
          </p>
          {entities.length === 0 ? (
            <p className="text-sm text-gray-500">
              No entities registered. Run &ldquo;Seed Business Data&rdquo; below.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {entities.map((entity) => (
                <div
                  key={entity.id}
                  className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-4 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-white truncate pr-2">
                        {entity.name}
                      </h3>
                      {entity.category && (
                        <span
                          className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${ENTITY_CATEGORY_COLORS[entity.category] ?? 'bg-gray-500/20 text-gray-400'}`}
                        >
                          {entity.category}
                        </span>
                      )}
                    </div>
                    <span
                      className={`mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${ENTITY_HEALTH_COLORS[entity.health_status] ?? 'bg-gray-500'} ${ENTITY_HEALTH_RING_COLORS[entity.health_status] ?? 'ring-gray-500/30'}`}
                      title={entity.health_status}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">
                    {entity.description ?? 'No description'}
                  </p>
                  <div className="mt-3 space-y-1 text-xs text-gray-400">
                    <div className="flex justify-between">
                      <span>Kind</span>
                      <span className="text-gray-300 capitalize">{entity.kind}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Method</span>
                      <span className="text-gray-300 font-mono text-[10px]">
                        {entity.invocation_method}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last invoked</span>
                      <span className="text-gray-300">
                        {relativeTime(entity.last_invoked_at)}
                      </span>
                    </div>
                  </div>
                  {/* capabilities may be null from DB even though the type says string[] */}
                  {(entity.capabilities ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(entity.capabilities ?? []).slice(0, 3).map((cap) => (
                        <span
                          key={cap}
                          className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400"
                        >
                          {cap}
                        </span>
                      ))}
                      {(entity.capabilities ?? []).length > 3 && (
                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                          +{(entity.capabilities ?? []).length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Section 3: Active Chains ───────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              Active Chains
            </h2>
            <DataExportButton
              label="Chains"
              data={chains.map(({ id, name, status, completed_steps, total_steps, total_duration_ms, started_at }) => ({
                id, name, status, completed_steps, total_steps, total_duration_ms, started_at,
              }))}
            />
          </div>
          {chains.length === 0 ? (
            <p className="text-sm text-gray-500">No recent chains.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-gray-900/80 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left font-medium" scope="col">Name</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Status</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Progress</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Duration</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {chains.map((chain) => {
                    const progress =
                      chain.total_steps > 0
                        ? Math.round(
                            (chain.completed_steps / chain.total_steps) * 100,
                          )
                        : 0;
                    return (
                      <tr
                        key={chain.id}
                        className="bg-gray-900/40 hover:bg-gray-900/60 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-white">
                          {chain.name}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CHAIN_STATUS_COLORS[chain.status] ?? 'bg-gray-500/20 text-gray-400'}`}
                          >
                            {chain.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 rounded-full bg-gray-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-green-500 transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400">
                              {chain.completed_steps}/{chain.total_steps}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-xs font-mono">
                          {formatDuration(chain.total_duration_ms)}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {formatDateTime(chain.started_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 4: Scheduled Jobs ──────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              Scheduled Jobs
            </h2>
            <DataExportButton
              label="Scheduled Jobs"
              filenamePrefix="scheduled-jobs"
              data={jobs.map(({ id, name, cron_expression, next_run_at, last_run_status, run_count, is_enabled }) => ({
                id, name, cron_expression, next_run_at, last_run_status, run_count, is_enabled,
              }))}
            />
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-gray-500">No scheduled jobs.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-gray-900/80 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left font-medium" scope="col">Name</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Cron</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Next Run</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Last Status</th>
                    <th className="px-4 py-3 text-right font-medium" scope="col">Runs</th>
                    <th className="px-4 py-3 text-center font-medium" scope="col">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="bg-gray-900/40 hover:bg-gray-900/60 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-white">
                        {job.name}
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300 font-mono">
                          {job.cron_expression}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {job.next_run_at
                          ? formatDateTime(job.next_run_at)
                          : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_STATUS_COLORS[job.last_run_status] ?? 'bg-gray-500/20 text-gray-400'}`}
                        >
                          {job.last_run_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">
                        {job.run_count}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${job.is_enabled ? 'bg-green-500' : 'bg-gray-600'}`}
                          title={job.is_enabled ? 'Enabled' : 'Disabled'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 5: Site Monitors ───────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              Site Monitors
            </h2>
            <DataExportButton
              label="Site Monitors"
              filenamePrefix="site-monitors"
              data={monitors.map(({ id, name, url, current_status, last_response_time_ms, last_check_at, consecutive_failures }) => ({
                id, name, url, current_status, last_response_time_ms, last_check_at, consecutive_failures,
              }))}
            />
          </div>
          {monitors.length === 0 ? (
            <p className="text-sm text-gray-500">No site monitors configured.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {monitors.map((monitor) => {
                const isUp = monitor.current_status === 'up';
                const isDown = monitor.current_status === 'down';
                return (
                  <div
                    key={monitor.id}
                    className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-4 hover:border-white/10 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-white truncate">
                          {monitor.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-gray-500 truncate">
                          {monitor.url}
                        </p>
                      </div>
                      <span
                        className={`ml-2 mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          isUp
                            ? 'bg-green-500/20 text-green-400'
                            : isDown
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isUp
                              ? 'bg-green-400'
                              : isDown
                                ? 'bg-red-400'
                                : 'bg-yellow-400'
                          }`}
                        />
                        {monitor.current_status}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-gray-400">
                      <div className="flex justify-between">
                        <span>Response time</span>
                        <span className="text-gray-300 font-mono">
                          {monitor.last_response_time_ms !== null
                            ? `${monitor.last_response_time_ms}ms`
                            : '--'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Last check</span>
                        <span className="text-gray-300">
                          {relativeTime(monitor.last_check_at)}
                        </span>
                      </div>
                      {monitor.consecutive_failures > 0 && (
                        <div className="flex justify-between">
                          <span>Failures</span>
                          <span className="text-red-400 font-semibold">
                            {monitor.consecutive_failures}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Section 6: Recent Notifications ────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              Recent Notifications
            </h2>
            <DataExportButton
              label="Notifications"
              data={notifications.map(({ id, type, subject, recipient, priority, sent_at, error_message }) => ({
                id, type, subject, recipient, priority, sent_at, status: sent_at ? 'sent' : error_message ? 'failed' : 'pending',
              }))}
            />
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-gray-500">No notifications yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-gray-900/80 text-gray-400 text-xs uppercase tracking-wider">
                    <th scope="col" className="px-4 py-3 text-left font-medium">Type</th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">Subject</th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">Recipient</th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">Priority</th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">Sent</th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {notifications.map((notif) => (
                    <tr
                      key={notif.id}
                      className="bg-gray-900/40 hover:bg-gray-900/60 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${NOTIF_TYPE_COLORS[notif.type] ?? 'bg-gray-500/20 text-gray-400'}`}
                        >
                          {notif.type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white max-w-xs truncate">
                        {notif.subject}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs truncate max-w-[140px]">
                        {notif.recipient}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium uppercase ${PRIORITY_COLORS[notif.priority] ?? 'text-gray-400'}`}
                        >
                          {notif.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {formatDateTime(notif.sent_at)}
                      </td>
                      <td className="px-4 py-3">
                        {notif.sent_at ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                            Sent
                          </span>
                        ) : notif.error_message ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-red-400"
                            title={notif.error_message}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                            Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 7: Quick Actions ───────────────────────────────── */}
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">
            Quick Actions
          </h2>
          {/* NOTE: These actions invoke server-side API routes that can mutate state
              (health checks, site monitors, notifications, data seeding). Access is
              gated by middleware.ts purchase verification. Re-enable the admin role
              check in this page component before exposing to untrusted users. */}
          <div className="flex flex-wrap gap-3">
            <QuickActionButton
              label="Run Health Check"
              endpoint="/api/cron"
              method="POST"
              color="green"
            />
            <QuickActionButton
              label="Check All Sites"
              endpoint="/api/monitors/check"
              method="GET"
              color="blue"
            />
            <QuickActionButton
              label="Send Test Email"
              endpoint="/api/notifications/test"
              method="POST"
              color="purple"
            />
            <QuickActionButton
              label="Seed Business Data"
              endpoint="/api/seed"
              method="POST"
              color="yellow"
            />
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 pt-6 pb-4">
          <p className="text-xs text-gray-600 text-center">
            Last loaded: {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
          </p>
        </div>
      </div>
    </div>
  );
}


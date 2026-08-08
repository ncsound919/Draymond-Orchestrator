export const dynamic = 'force-dynamic';

import { createDraymondAdminClient } from '@/lib/draymond/client';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin | Draymond Orchestrator',
};

export default async function AdminPage() {
  // Auth gate disabled for local dev — TODO: re-enable when dashboard auth is built

  let stats: { label: string; value: number; color: string }[] = [];
  let fetchError = false;

  try {
    const supabase = createDraymondAdminClient();

    const [
      { count: agentCount },
      { count: entityCount },
      { count: chainCount },
      { count: jobCount },
      { count: monitorCount },
      { count: notificationCount },
    ] = await Promise.all([
      supabase.from('draymond_agents').select('*', { count: 'exact', head: true }),
      supabase.from('draymond_entities').select('*', { count: 'exact', head: true }),
      supabase.from('draymond_chains').select('*', { count: 'exact', head: true }),
      supabase.from('draymond_scheduled_jobs').select('*', { count: 'exact', head: true }),
      supabase.from('draymond_site_monitors').select('*', { count: 'exact', head: true }),
      supabase.from('draymond_notifications').select('*', { count: 'exact', head: true }),
    ]);

    stats = [
      { label: 'Agents', value: agentCount ?? 0, color: 'text-[#22c55e]' },
      { label: 'Entities', value: entityCount ?? 0, color: 'text-blue-400' },
      { label: 'Chains', value: chainCount ?? 0, color: 'text-yellow-400' },
      { label: 'Scheduled Jobs', value: jobCount ?? 0, color: 'text-purple-400' },
      { label: 'Site Monitors', value: monitorCount ?? 0, color: 'text-cyan-400' },
      { label: 'Notifications', value: notificationCount ?? 0, color: 'text-orange-400' },
    ];
  } catch (err) {
    console.error('[AdminPage] Failed to load stats:', err);
    fetchError = true;
  }

  if (fetchError) {
    return (
      <div className="min-h-screen">
        <div className="max-w-6xl mx-auto px-4 py-24 text-center text-white">
          <p className="text-5xl mb-4 opacity-40">&#x26A0;</p>
          <h1 className="text-xl font-bold mb-2">Failed to load admin data</h1>
          <p className="text-white/40 text-sm">Could not connect to the database. Check your local SQLite configuration.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Hero bar */}
      <div className="border-b border-white/5 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">System Admin</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Draymond infrastructure overview and management
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="glass-card p-6 text-center">
              <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-sm text-white/40 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/operations"
              className="px-4 py-2 text-sm font-medium rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              Operations Center
            </Link>
            <Link
              href="/agents"
              className="px-4 py-2 text-sm font-medium rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              Agent Roster
            </Link>
            <Link
              href="/agents/import"
              className="px-4 py-2 text-sm font-medium rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              Import Agents
            </Link>
          </div>
        </div>

        {/* Environment info */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Environment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5">
              <span className="text-white/40">Runtime</span>
              <span className="text-white/80 font-mono">Next.js</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5">
              <span className="text-white/40">Database</span>
              <span className="text-white/80 font-mono">SQLite (local)</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5">
              <span className="text-white/40">Agent Backend</span>
              <span className="text-white/80 font-mono">aiohttp :8000</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5">
              <span className="text-white/40">Dashboard</span>
              <span className="text-white/80 font-mono">localhost:3000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

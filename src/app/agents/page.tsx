/**
 * /agents — Marvel-style agent roster grid
 */
import { getAllAgents } from '@/lib/registry/agent-store';
import AgentCard from '@/components/registry/AgentCard';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AgentsPage() {
  let agents: Awaited<ReturnType<typeof getAllAgents>> = [];
  let fetchError = false;

  try {
    agents = await getAllAgents();
  } catch (err) {
    console.error('[AgentsPage] Failed to load agents:', err);
    fetchError = true;
  }

  if (fetchError) {
    return (
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-6 py-24 text-center">
          <p className="text-5xl mb-4 opacity-40">&#x26A0;</p>
          <h1 className="text-xl font-bold mb-2">Failed to load agents</h1>
          <p className="text-white/40 text-sm">Could not connect to the agent registry. Check your configuration and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Agent Roster</h1>
            <p className="text-white/40 text-sm mt-1">
              {agents.length} agent{agents.length !== 1 ? 's' : ''} registered
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/agents/import"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white text-sm font-semibold transition-colors"
            >
              + Import Agent
            </Link>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {agents.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-6xl mb-4">🤖</p>
            <p className="text-white/40 text-lg">No agents registered yet.</p>
            <Link
              href="/agents/import"
              className="mt-4 inline-block px-6 py-3 rounded-xl bg-indigo-600
                         hover:bg-indigo-500 text-white font-semibold transition-colors"
            >
              Import your first agent
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

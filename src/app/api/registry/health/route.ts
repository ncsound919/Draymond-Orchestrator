/**
 * POST /api/registry/health
 * Pings all registered agents and systems and updates their status.
 * Can be called on a schedule or triggered manually from the UI.
 */
import { NextResponse } from 'next/server';
import { getAllAgents, getAllSystems, updateAgentStatus } from '@/lib/registry/agent-store';
import { AgentStatus } from '@/lib/registry/types';

async function pingEndpoint(url: string, timeoutMs = 5000): Promise<AgentStatus> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) return 'online';
    if (res.status >= 500) return 'degraded';
    return 'offline';
  } catch {
    return 'offline';
  }
}

export async function POST() {
  const agents = await getAllAgents();
  const systems = await getAllSystems();
  const results: { id: string; name: string; status: AgentStatus }[] = [];

  for (const agent of agents) {
    if (agent.runtime.type === 'http' && agent.runtime.endpoint) {
      const healthUrl = `${agent.runtime.endpoint}${agent.runtime.healthPath ?? '/health'}`;
      const status = await pingEndpoint(healthUrl, agent.runtime.timeoutMs ?? 5000);
      await updateAgentStatus(agent.id, status);
      results.push({ id: agent.id, name: agent.name, status });
    }
  }

  for (const sys of systems) {
    if (sys.config.endpoint) {
      const healthUrl = `${sys.config.endpoint}${sys.config.healthPath ?? '/health'}`;
      const status = await pingEndpoint(healthUrl);
      results.push({ id: sys.id, name: sys.name, status });
    }
  }

  return NextResponse.json({ checked: results.length, results });
}

/**
 * POST /api/registry/health
 * Pings all registered agents and systems and updates their status.
 * Can be called on a schedule or triggered manually from the UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents, getAllSystems, updateAgentStatus } from '@/lib/registry/agent-store';
import { AgentStatus } from '@/lib/registry/types';
import { authorizeRequest } from '@/lib/draymond/api-auth';

/** Validate URL is not a private/internal address to prevent SSRF */
function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    // Block common private/internal addresses
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (hostname === '0.0.0.0') return true;
    if (hostname.endsWith('.local')) return true;
    // Block private IP ranges
    if (hostname.startsWith('10.')) return true;
    if (hostname.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    // Block metadata endpoints
    if (hostname === '169.254.169.254') return true;
    return false;
  } catch {
    return true; // Invalid URL — treat as private
  }
}

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

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const agents = await getAllAgents();
  const systems = await getAllSystems();
  const results: { id: string; name: string; status: AgentStatus }[] = [];

  for (const agent of agents) {
    if (agent.runtime.type === 'http' && agent.runtime.endpoint) {
      const healthUrl = `${agent.runtime.endpoint}${agent.runtime.healthPath ?? '/health'}`;
      if (isPrivateUrl(healthUrl)) {
        results.push({ id: agent.id, name: agent.name, status: 'unknown' as AgentStatus });
        continue;
      }
      const status = await pingEndpoint(healthUrl, agent.runtime.timeoutMs ?? 5000);
      await updateAgentStatus(agent.id, status);
      results.push({ id: agent.id, name: agent.name, status });
    }
  }

  for (const sys of systems) {
    if (sys.config.endpoint) {
      const healthUrl = `${sys.config.endpoint}${sys.config.healthPath ?? '/health'}`;
      if (isPrivateUrl(healthUrl)) {
        results.push({ id: sys.id, name: sys.name, status: 'unknown' as AgentStatus });
        continue;
      }
      const status = await pingEndpoint(healthUrl);
      results.push({ id: sys.id, name: sys.name, status });
    }
  }

  return NextResponse.json({ checked: results.length, results });
}

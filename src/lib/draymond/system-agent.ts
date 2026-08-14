// ============================================================================
// DRAYMOND SYSTEM AGENT CLIENT — laptop-wide control + telemetry bridge
// ============================================================================
// Talks to the resident system-agent (port 3405) that watches the whole OS.
// Draymond uses this to control the laptop (launch/kill/power/file/service),
// read system telemetry (processes, network, USB, Defender, info), and stream
// endpoint protection detections from Claw-Protect.
//
// Dangerous control actions require an HMAC approval token (minted here,
// bound to action+target, 5 min TTL) that the system-agent verifies. The
// Draymond approval gate (ntfy push → user taps Approve) mints the token.
// ============================================================================

import crypto from 'node:crypto';

const AGENT_BASE = process.env.SYSTEM_AGENT_URL || 'http://127.0.0.1:3405';
const AGENT_KEY = process.env.SYSTEM_AGENT_KEY || process.env.CLAW_PROTECT_API_KEY || '';
const APPROVAL_SECRET = process.env.SYSTEM_AGENT_APPROVAL_SECRET || process.env.DRAYMOND_APPROVAL_SECRET || '';

export interface SystemAgentHealth {
  status: string;
  agent: string;
  port: number;
  watching: string[];
  processes: number;
  connections: number;
  usb: number;
  defender: unknown;
  quarantineDir: string;
}

export type SystemControlAction =
  | 'launch'
  | 'kill'
  | 'power'
  | 'file'
  | 'service'
  | 'priority';

/**
 * Mint an approval token for a dangerous system action. The system-agent
 * verifies the HMAC signature + expiry + action/target binding. Return the
 * token or null if the approval secret is not configured.
 */
export function mintSystemApproval(action: SystemControlAction, target: string): string | null {
  if (!APPROVAL_SECRET) return null;
  const payload = {
    action,
    target,
    mintedBy: 'draymond',
    exp: Date.now() + 5 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', APPROVAL_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${AGENT_KEY}`,
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  };
}

async function agentGet<T>(path: string): Promise<{ ok: boolean; data: T; status: number; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}${path}`, {
      headers: headers(),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, data: null as T, status: res.status, error: json.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json as T, status: res.status };
  } catch (err) {
    return {
      ok: false,
      data: null as T,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function agentPost<T>(path: string, body: unknown, approvalToken?: string): Promise<{ ok: boolean; data: T; status: number; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}${path}`, {
      method: 'POST',
      headers: headers(approvalToken ? { 'X-Approval-Token': approvalToken } : undefined),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, data: null as T, status: res.status, error: json.error ?? json.detail ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json as T, status: res.status };
  } catch (err) {
    return {
      ok: false,
      data: null as T,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function systemAgentHealth(): Promise<{ ok: boolean; data?: SystemAgentHealth; error?: string; status: number }> {
  return agentGet<SystemAgentHealth>('/api/health');
}

export async function systemInfo(): Promise<any> {
  return agentGet('/api/v1/system/info');
}

export async function systemProcesses(): Promise<any> {
  return agentGet('/api/v1/system/processes');
}

export async function systemConnections(): Promise<any> {
  return agentGet('/api/v1/system/connections');
}

export async function systemUsb(): Promise<any> {
  return agentGet('/api/v1/system/usb');
}

export async function systemDefender(): Promise<any> {
  return agentGet('/api/v1/system/defender');
}

export async function systemServices(): Promise<any> {
  return agentGet('/api/v1/system/services');
}

export async function systemTasks(): Promise<any> {
  return agentGet('/api/v1/system/tasks');
}

export async function systemSnapshot(): Promise<any> {
  return agentGet('/api/v1/system/snapshot');
}

export async function systemRecentAudit(limit = 50): Promise<any> {
  return agentGet(`/api/v1/audit/recent?limit=${limit}`);
}

export async function systemAgentStatus(): Promise<any> {
  return agentGet('/api/v1/agent/health');
}

// ── Control actions (require an approval token) ─────────────────────────────

export async function controlLaunch(input: { path: string; args?: string[]; cwd?: string; hidden?: boolean }, approvalToken: string): Promise<any> {
  return agentPost('/api/v1/control/launch', input, approvalToken);
}

export async function controlKill(input: { pid?: number; name?: string; force?: boolean }, approvalToken: string): Promise<any> {
  return agentPost('/api/v1/control/kill', input, approvalToken);
}

export async function controlPower(input: { action: 'shutdown' | 'restart' | 'sleep' | 'hibernate' | 'lock' }, approvalToken: string): Promise<any> {
  return agentPost('/api/v1/control/power', input, approvalToken);
}

export async function controlFile(input: { op: string; path: string; dest?: string }, approvalToken: string): Promise<any> {
  return agentPost('/api/v1/control/file', input, approvalToken);
}

export async function controlService(input: { name: string; action: 'start' | 'stop' | 'restart' }, approvalToken: string): Promise<any> {
  return agentPost('/api/v1/control/service', input, approvalToken);
}

export async function controlPriority(input: { pid: number; priority: string }, approvalToken: string): Promise<any> {
  return agentPost('/api/v1/control/priority', input, approvalToken);
}

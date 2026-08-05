// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — AetherDesk Call Center Integration
// ============================================================================
// Registers AetherDesk as a Draymond entity and provides a typed operation
// catalog plus a REST executor for the AetherDesk Call Center API
// (http://127.0.0.1:8000/api/v1, auth via x-api-key = INTERNAL_API_KEY).
//
// This module is deliberately free of Supabase/Next imports so the catalog
// and URL builder are unit-testable in a plain node environment. The only
// other import is ./types (pure types) and ./ntfy (pure, fetch-only).
// ============================================================================

import type { ActionRiskLevel } from './types';
import { publishResultNotification } from './ntfy';

export type AetherDeskOperationDef = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path template relative to AETHERDESK_BASE_URL. `{tenant_id}` and `{*_id}` placeholders. */
  path: string;
  risk: Exclude<ActionRiskLevel, 'safe'>;
  /** Routes whose tenant_id is a *query* param (verify_tenant_access reads it from the query string). */
  tenantQuery?: boolean;
};

export const AETHERDESK_OPERATIONS: Record<string, AetherDeskOperationDef> = {
  health: { method: 'GET', path: '/health', risk: 'low' },
  list_agents: { method: 'GET', path: '/tenants/{tenant_id}/agents', risk: 'low' },
  get_agent: { method: 'GET', path: '/tenants/{tenant_id}/agents/{agent_id}', risk: 'low' },
  create_agent: { method: 'POST', path: '/tenants/{tenant_id}/agents', risk: 'high' },
  update_agent: { method: 'PUT', path: '/tenants/{tenant_id}/agents/{agent_id}', risk: 'high' },
  delete_agent: { method: 'DELETE', path: '/tenants/{tenant_id}/agents/{agent_id}', risk: 'critical' },
  list_campaigns: { method: 'GET', path: '/campaign/campaigns', risk: 'low' },
  get_campaign: { method: 'GET', path: '/campaign/campaigns/{campaign_id}', risk: 'low' },
  create_campaign: { method: 'POST', path: '/campaign/campaigns', risk: 'high' },
  update_campaign: { method: 'PATCH', path: '/campaign/campaigns/{campaign_id}', risk: 'high' },
  launch_campaign: { method: 'POST', path: '/campaign/launch', risk: 'critical' },
  list_leads: { method: 'GET', path: '/campaign/leads', risk: 'low' },
  list_calls: { method: 'GET', path: '/calls', risk: 'low', tenantQuery: true },
  get_call: { method: 'GET', path: '/calls/{call_id}', risk: 'low', tenantQuery: true },
  start_call: { method: 'POST', path: '/calls', risk: 'high', tenantQuery: true },
  call_action: { method: 'POST', path: '/calls/{call_id}/action', risk: 'medium', tenantQuery: true },
};

/** Look up the risk level for an operation. Returns null for unknown ops. */
export function getOperationRisk(
  operation: string
): Exclude<ActionRiskLevel, 'safe'> | null {
  return AETHERDESK_OPERATIONS[operation]?.risk ?? null;
}

/**
 * Build the absolute URL + request body for an AetherDesk operation.
 * Pure function — no I/O. Throws on unknown operation or missing placeholder.
 */
export function buildAetherDeskUrl(
  baseUrl: string,
  operation: string,
  input: Record<string, unknown>,
  tenantId: string
): { url: string; body: Record<string, unknown> | null } {
  const def = AETHERDESK_OPERATIONS[operation];
  if (!def) throw new Error(`Unknown AetherDesk operation "${operation}"`);

  // Copy input; placeholder fields are consumed (removed from the body).
  const body: Record<string, unknown> = { ...input };
  delete body.tenant_id;

  let path = def.path.replace(/\{tenant_id\}/g, encodeURIComponent(tenantId));

  // Substitute remaining {*_id} placeholders from input.
  path = path.replace(/\{([a-z0-9_]+)\}/g, (match, key: string) => {
    if (key === 'tenant_id') return match;
    const value = body[key];
    if (value === undefined) {
      throw new Error(`AetherDesk operation "${operation}" requires input field "${key}"`);
    }
    delete body[key];
    return encodeURIComponent(String(value));
  });

  // verify_tenant_access reads tenant_id from the query string for calls routes.
  if (def.tenantQuery) {
    path += `${path.includes('?') ? '&' : '?'}tenant_id=${encodeURIComponent(tenantId)}`;
  }

  const hasBody = def.method !== 'GET' && def.method !== 'DELETE';
  return {
    url: `${baseUrl.replace(/\/+$/, '')}${path}`,
    body: hasBody ? body : null,
  };
}

export type AetherDeskExecutionResult = {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  status_code?: number;
};

/**
 * Execute an AetherDesk operation over its REST API.
 * Never throws — always returns a structured result.
 */
export async function executeAetherDeskOperation(
  operation: string,
  input: Record<string, unknown>,
  options?: { tenantId?: string; timeoutMs?: number }
): Promise<AetherDeskExecutionResult> {
  const baseUrl = process.env.AETHERDESK_BASE_URL;
  const apiKey = process.env.AETHERDESK_API_KEY;

  if (!baseUrl || !apiKey) {
    return {
      success: false,
      output: {},
      error: 'AETHERDESK_BASE_URL / AETHERDESK_API_KEY not configured',
    };
  }

  const def = AETHERDESK_OPERATIONS[operation];
  if (!def) {
    return { success: false, output: {}, error: `Unknown AetherDesk operation "${operation}"` };
  }

  let url: string;
  let body: Record<string, unknown> | null;
  try {
    const built = buildAetherDeskUrl(baseUrl, operation, input, options?.tenantId ?? 'TENANT-001');
    url = built.url;
    body = built.body;
  } catch (err) {
    return {
      success: false,
      output: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const timeoutMs = options?.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions: RequestInit = {
      method: def.method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      signal: controller.signal,
    };
    if (body) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url, fetchOptions);
    clearTimeout(timer);

    const bodyText = await response.text();
    let output: Record<string, unknown>;
    try {
      output = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      output = { raw_output: bodyText };
    }

    return {
      success: response.ok,
      output,
      error: response.ok ? undefined : `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      status_code: response.status,
    };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    return {
      success: false,
      output: {},
      error: isTimeout ? `Request timed out after ${timeoutMs}ms` : message,
    };
  }
}

/**
 * Resolve the id of the AetherDesk control agent from draymond_agents.
 * Dynamic import of ./client keeps this module testable without Supabase.
 */
export async function resolveAetherDeskAgentId(): Promise<string | null> {
  const { createDraymondClient } = await import('./client');
  const supabase = await createDraymondClient();
  const { data, error } = await supabase
    .from('draymond_agents')
    .select('id')
    .eq('slug', 'aetherdesk')
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}

/**
 * Execute a previously approved AetherDesk action, then record the result and
 * publish it to the results ntfy topic. Fire-and-forget — invoked post-response
 * so the ntfy Approve button callback stays fast. Idempotent: skips if the
 * action is no longer `approved` or was already executed.
 */
export async function executeApprovedAetherDeskAction(actionId: string): Promise<void> {
  const { createDraymondClient } = await import('./client');
  const supabase = await createDraymondClient();

  const { data: action, error } = await supabase
    .from('draymond_actions')
    .select('*')
    .eq('id', actionId)
    .maybeSingle();

  if (error || !action) return;
  if (action.status !== 'approved') return;
  if (action.executed_at) return; // already executed — idempotent

  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const operation = typeof payload.aetherdesk_operation === 'string' ? payload.aetherdesk_operation : '';
  const input = (payload.aetherdesk_input as Record<string, unknown>) ?? {};
  const tenantId = typeof payload.tenant_id === 'string' ? payload.tenant_id : 'TENANT-001';

  const result = await executeAetherDeskOperation(operation, input, { tenantId });
  const executedAt = new Date().toISOString();

  if (result.success) {
    await supabase
      .from('draymond_actions')
      .update({
        status: 'completed',
        executed_at: executedAt,
        result: { ok: true, operation, output: result.output, status_code: result.status_code },
        error_message: null,
      })
      .eq('id', actionId);
  } else {
    await supabase
      .from('draymond_actions')
      .update({
        status: 'failed',
        executed_at: executedAt,
        result: { ok: false, operation, error: result.error },
        error_message: result.error ?? 'AetherDesk execution failed',
      })
      .eq('id', actionId);
  }

  await publishResultNotification({
    operation,
    success: result.success,
    error: result.error,
    status_code: result.status_code,
  }).catch(() => {});
}

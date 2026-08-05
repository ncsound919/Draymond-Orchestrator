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

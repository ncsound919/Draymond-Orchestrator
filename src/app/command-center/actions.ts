'use server';

import { requireDraymondActionAuth } from '@/lib/draymond/auth';

// ============================================================================
// Command Center — server-side action bridge
// ============================================================================
// Client panels never see CRON_SECRET. They call these actions, which validate
// the admin session and forward to the internal admin API routes with the
// secret attached server-side. Mirrors the existing `runQuickAction` pattern
// but supports GET/POST/PATCH/DELETE with bodies and a wider allowed set.
// ============================================================================

export interface BridgeResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

interface BridgeCall {
  endpoint: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
}

const ALLOWED_PREFIXES = [
  '/api/command-center/crm',
  '/api/command-center/seo',
  '/api/command-center/deploy',
  '/api/command-center/science',
  '/api/monitors',
  '/api/monitors/check',
  '/api/jobs',
  '/api/chains',
  '/api/agents',
  '/api/ops/day',
  '/api/ops/brain',
  '/api/ops/brain/sweep',
  '/api/ops/brain/task',
  '/api/ops/brain/fallback',
  '/api/ops/controls',
  '/api/ops/repair',
  '/api/ops/repair-triage',
  '/api/ops/heartbeats',
  '/api/ops/learning',
  '/api/ops/metrics',
  '/api/ops/services',
  '/api/research/papers',
  '/api/v1/science',
  '/api/v1/sports',
];

function isAllowed(endpoint: string): boolean {
  return ALLOWED_PREFIXES.some(
    (prefix) => endpoint === prefix || endpoint.startsWith(prefix + '/'),
  );
}

export async function ccFetch<T = unknown>(call: BridgeCall): Promise<BridgeResult<T>> {
  await requireDraymondActionAuth();

  if (!isAllowed(call.endpoint)) {
    return { ok: false, status: 403, error: 'Endpoint not allowed' };
  }

  const secret = process.env.CRON_SECRET;
  const baseUrl =
    process.env.DRAYMOND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://127.0.0.1:3444';
  if (!secret) {
    return { ok: false, status: 503, error: 'CRON_SECRET not configured' };
  }

  try {
    const targetUrl = new URL(call.endpoint, `${baseUrl.replace(/\/$/, '')}/`).toString();
    const res = await fetch(targetUrl, {
      method: call.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body:
        call.method === 'GET' || call.method === 'DELETE'
          ? undefined
          : JSON.stringify(call.body ?? {}),
      cache: 'no-store',
    });

    let data: T | undefined;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : 'Bridge request failed',
    };
  }
}

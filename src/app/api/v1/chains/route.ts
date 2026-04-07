/**
 * /api/v1/chains — Open Chat chain management proxy
 * GET  — List chains (with optional filters)
 * POST — Execute a chain by slug
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { listChains, instantiateChain, executeChain, getChainSummary } from '@/lib/draymond/chains';
import type { ChainStatus } from '@/lib/draymond/types';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: ChainStatus[] = [
  'draft', 'active', 'running', 'paused', 'completed', 'failed', 'cancelled', 'archived',
];

// GET — list chains with optional filters
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const isTemplateRaw = url.searchParams.get('is_template');
    const statusRaw = url.searchParams.get('status');
    const limitRaw = url.searchParams.get('limit');

    let status: ChainStatus | undefined;
    if (statusRaw) {
      if (!VALID_STATUSES.includes(statusRaw as ChainStatus)) {
        return NextResponse.json(
          { ok: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
          { status: 400 },
        );
      }
      status = statusRaw as ChainStatus;
    }

    const limit = limitRaw ? Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 50)) : undefined;

    const chains = await listChains({
      is_template: isTemplateRaw !== null ? isTemplateRaw === 'true' : undefined,
      status,
      limit,
    });

    return NextResponse.json({ ok: true, chains });
  } catch (err) {
    console.error('[API /api/v1/chains GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// POST — execute a chain by slug
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    chain_slug?: string;
    chain_id?: string;
    input?: Record<string, unknown>;
    agent_id?: string;
  }>(request);
  if (parseError) return parseError;

  try {
    const slug = body.chain_slug;
    const chainId = body.chain_id;

    if (!slug && !chainId) {
      return NextResponse.json(
        { ok: false, error: 'Either chain_slug or chain_id is required' },
        { status: 400 },
      );
    }

    if (slug) {
      // Instantiate from template and execute
      const input = body.input ?? {};
      const instance = await instantiateChain(slug, input, undefined, body.agent_id);
      const ctx = await executeChain(instance.id, body.agent_id);
      return NextResponse.json({ ok: true, chain_id: instance.id, context: ctx.context, steps: ctx.steps });
    } else {
      // Get summary of an existing chain
      const summary = await getChainSummary(chainId!);
      return NextResponse.json({ ok: true, summary });
    }
  } catch (err) {
    console.error('[API /api/v1/chains POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

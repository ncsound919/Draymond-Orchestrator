// ============================================================================
// /api/chains/[id]/steps — Chain step operations (list & add)
// ============================================================================
// GET  — Return all steps for a chain, ordered by step_order
// POST — Add one or many steps to a chain (accepts object or array)
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getChainSteps, addStep, addSteps } from '@/lib/draymond/chains';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import type { DraymondChainStepInsert } from '@/lib/draymond/types';

export const dynamic = 'force-dynamic';

// ── GET /api/chains/[id]/steps ──────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const steps = await getChainSteps(id);
    return NextResponse.json({ ok: true, steps });
  } catch (err) {
    console.error('[API /api/chains/[id]/steps GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// ── POST /api/chains/[id]/steps ─────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  try {
    const { id } = await params;

    if (Array.isArray(body)) {
      if (body.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'Steps array cannot be empty' },
          { status: 400 },
        );
      }

      // Validate each step has required fields
      for (let i = 0; i < body.length; i++) {
        const s = body[i] as Record<string, unknown>;
        if (!s.name || typeof s.name !== 'string') {
          return NextResponse.json(
            { ok: false, error: `Step ${i + 1}: missing required field "name"` },
            { status: 400 },
          );
        }
        if (!s.entity_id || typeof s.entity_id !== 'string') {
          return NextResponse.json(
            { ok: false, error: `Step ${i + 1}: missing required field "entity_id"` },
            { status: 400 },
          );
        }
        if (!s.action || typeof s.action !== 'string') {
          return NextResponse.json(
            { ok: false, error: `Step ${i + 1}: missing required field "action"` },
            { status: 400 },
          );
        }
      }

      // Bulk insert — inject chain_id into every entry
      const inputs: DraymondChainStepInsert[] = body.map(
        (s: DraymondChainStepInsert) => ({ ...s, chain_id: id }),
      );
      const steps = await addSteps(inputs);
      return NextResponse.json({ ok: true, steps }, { status: 201 });
    }

    // Single insert
    const b = body as Record<string, unknown>;
    if (!b.name || typeof b.name !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: name' },
        { status: 400 },
      );
    }
    if (!b.entity_id || typeof b.entity_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: entity_id' },
        { status: 400 },
      );
    }
    if (!b.action || typeof b.action !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: action' },
        { status: 400 },
      );
    }

    const input: DraymondChainStepInsert = { ...(body as DraymondChainStepInsert), chain_id: id };
    const step = await addStep(input);
    return NextResponse.json({ ok: true, step }, { status: 201 });
  } catch (err) {
    console.error('[API /api/chains/[id]/steps POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

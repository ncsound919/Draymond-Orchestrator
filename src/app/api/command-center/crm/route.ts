// ============================================================================
// /api/command-center/crm — Command Center CRM (command_leads)
// ============================================================================
// GET  /api/command-center/crm          — list leads (optionally ?stage=)
// POST /api/command-center/crm          — create lead
// PATCH /api/command-center/crm          — update lead (supports { action: 'move', stage })
// DELETE /api/command-center/crm?id=     — delete lead
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError, isValidId } from '@/lib/draymond/api-auth';
import {
  listLeads,
  listLeadsByStage,
  createLead,
  updateLead,
  moveLead,
  deleteLead,
  addLeadNote,
  leadStageCounts,
} from '@/lib/command-center/crm';
import type { LeadInsert, LeadStage } from '@/lib/command-center/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const stage = request.nextUrl.searchParams.get('stage');
    const counts = await leadStageCounts();
    if (stage) {
      const leads = await listLeadsByStage(stage as LeadStage);
      return NextResponse.json({ ok: true, leads, counts });
    }
    const leads = await listLeads();
    return NextResponse.json({ ok: true, leads, counts });
  } catch (err) {
    console.error('[api/command-center/crm] GET', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { data: body, error: parseError } = await parseJsonBody<LeadInsert>(request);
  if (parseError) return parseError;
  try {
    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
    }
    const lead = await createLead(body);
    return NextResponse.json({ ok: true, lead }, { status: 201 });
  } catch (err) {
    console.error('[api/command-center/crm] POST', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(request);
  if (parseError) return parseError;
  try {
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id || !isValidId(id)) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing id' }, { status: 400 });
    }
    const action = body.action;
    let lead;
    if (action === 'move') {
      lead = await moveLead(id, body.stage);
    } else if (action === 'note') {
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text.trim()) {
        return NextResponse.json({ ok: false, error: 'text is required for note action' }, { status: 400 });
      }
      lead = await addLeadNote(id, text, typeof body.by === 'string' ? body.by : undefined);
    } else {
      const patch: Record<string, unknown> = {};
      for (const key of ['name', 'email', 'phone', 'company', 'stage', 'value_cents', 'owner', 'source', 'notes', 'tags', 'metadata', 'next_follow_up_at'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 });
      }
      lead = await updateLead(id, patch as Parameters<typeof updateLead>[1]);
    }
    return NextResponse.json({ ok: true, lead });
  } catch (err) {
    console.error('[api/command-center/crm] PATCH', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id || !isValidId(id)) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing id' }, { status: 400 });
    }
    await deleteLead(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/command-center/crm] DELETE', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

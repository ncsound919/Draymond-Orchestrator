// ============================================================================
// /api/monitors/[id] — Site monitor update + delete
// ============================================================================
// PATCH /api/monitors/[id] — update a monitor (fields from UpdateMonitorInput)
// DELETE /api/monitors/[id] — delete a monitor
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { updateMonitor, deleteMonitor } from '@/lib/draymond/monitors';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(request);
    if (parseError) return parseError;

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const monitor = await updateMonitor(id, body);
    return NextResponse.json({ ok: true, monitor });
  } catch (err) {
    console.error('[api/monitors/[id]] PATCH error:', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await deleteMonitor(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/monitors/[id]] DELETE error:', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

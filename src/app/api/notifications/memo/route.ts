import { NextRequest, NextResponse } from 'next/server';
import { sendMemo } from '@/lib/draymond/notifications';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST /api/notifications/memo — send a low-urgency memo/update email
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody<{
      subject?: unknown;
      body?: unknown;
      recipient?: unknown;
    }>(request);
    if (bodyResult.error) return bodyResult.error;
    const { subject, body, recipient } = bodyResult.data;

    if (typeof subject !== 'string' || !subject.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: subject' },
        { status: 400 },
      );
    }
    if (typeof body !== 'string' || !body.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: body' },
        { status: 400 },
      );
    }
    if (recipient !== undefined && typeof recipient !== 'string') {
      return NextResponse.json(
        { error: 'recipient must be a string' },
        { status: 400 },
      );
    }

    const record = await sendMemo(subject.trim(), body.trim(), recipient);

    return NextResponse.json({ ok: true, notification: record });
  } catch (error) {
    console.error('[api/notifications/memo] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send memo' },
      { status: 500 },
    );
  }
}

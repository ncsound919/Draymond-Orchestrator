import { NextRequest, NextResponse } from 'next/server';
import { sendNotification } from '@/lib/draymond/notifications';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST /api/notifications/test — send a test notification (protected)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody<{ recipient?: string }>(request);
    if (bodyResult.error) return bodyResult.error;
    const { recipient } = bodyResult.data;

    if (!recipient || typeof recipient !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: recipient' },
        { status: 400 },
      );
    }

    const record = await sendNotification({
      channel: 'email',
      recipient,
      subject: 'Draymond Test Notification',
      body: 'This is a test notification confirming that the Draymond notification system is working correctly.',
      type: 'custom',
      priority: 'low',
    });

    return NextResponse.json({ ok: true, notification: record });
  } catch (error) {
    console.error('[api/notifications/test] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send test notification' },
      { status: 500 },
    );
  }
}

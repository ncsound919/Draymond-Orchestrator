import { NextRequest, NextResponse } from 'next/server';
import { sendNotification } from '@/lib/draymond/notifications';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST /api/notifications/test — send a test notification (protected)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Authenticate via CRON_SECRET
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { recipient } = (await request.json()) as { recipient?: string };

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

import { NextRequest, NextResponse } from 'next/server';
import {
  sendNotification,
  getNotificationHistory,
  type NotificationType,
  type NotificationPriority,
} from '@/lib/draymond/notifications';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/notifications — list notification history
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);

    const type = searchParams.get('type') as NotificationType | null;
    const priority = searchParams.get('priority') as NotificationPriority | null;
    const since = searchParams.get('since') ?? undefined;
    const rawLimit = searchParams.get('limit');
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;

    if (since) {
      const parsed = new Date(since).getTime();
      if (isNaN(parsed)) {
        return NextResponse.json(
          { error: "Invalid 'since' parameter — use ISO 8601 format (e.g. 2026-04-01T00:00:00Z)" },
          { status: 400 },
        );
      }
    }

    const history = await getNotificationHistory({
      type: type ?? undefined,
      priority: priority ?? undefined,
      since,
      limit: limit && !isNaN(limit) ? Math.min(Math.max(limit, 1), 500) : undefined,
    });

    return NextResponse.json({ notifications: history, count: history.length });
  } catch (error) {
    console.error('[api/notifications] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch notification history' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/notifications — send a notification
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody<Record<string, unknown>>(request);
    if (bodyResult.error) return bodyResult.error;
    const body = bodyResult.data;

    const { recipient, subject, body: messageBody, type, priority } = body as {
      recipient?: string;
      subject?: string;
      body?: string;
      type?: NotificationType;
      priority?: NotificationPriority;
    };

    // Validate required fields
    const missing: string[] = [];
    if (!recipient || typeof recipient !== 'string') missing.push('recipient');
    if (!subject || typeof subject !== 'string') missing.push('subject');
    if (!messageBody || typeof messageBody !== 'string') missing.push('body');

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    const record = await sendNotification({
      channel: 'email',
      recipient: recipient as string,
      subject: subject as string,
      body: messageBody as string,
      type: type ?? 'custom',
      priority,
    });

    return NextResponse.json({ ok: true, notification: record }, { status: 201 });
  } catch (error) {
    console.error('[api/notifications] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send notification' },
      { status: 500 },
    );
  }
}

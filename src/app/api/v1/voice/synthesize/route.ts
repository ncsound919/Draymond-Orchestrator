import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { appendAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const AETHERDESK_BASE_URL =
  process.env.AETHERDESK_BASE_URL || 'http://127.0.0.1:8000/api/v1';
const AETHERDESK_API_KEY = process.env.AETHERDESK_API_KEY || '';

export async function POST(request: Request) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  let text = '';
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 });
  }

  try {
    const res = await fetch(`${AETHERDESK_BASE_URL}/voice/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AETHERDESK_API_KEY,
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      await appendAuditLog({
        event: 'voice_synthesize_error',
        status_code: res.status,
        error: errText.slice(0, 200),
        agent: 'draymond',
      });
      return NextResponse.json(
        { error: `AetherDesk synthesize failed: HTTP ${res.status}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { audio?: string };
    await appendAuditLog({
      event: 'voice_synthesize',
      text_preview: text.slice(0, 120),
      agent: 'draymond',
    });
    return NextResponse.json({ audio: data.audio ?? '' });
  } catch (err) {
    await appendAuditLog({
      event: 'voice_synthesize_error',
      error: err instanceof Error ? err.message : String(err),
      agent: 'draymond',
    });
    return NextResponse.json(
      { error: 'AetherDesk synthesize unreachable' },
      { status: 502 },
    );
  }
}

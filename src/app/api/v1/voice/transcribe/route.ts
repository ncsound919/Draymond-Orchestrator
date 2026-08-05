import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { appendAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const AETHERDESK_BASE_URL =
  process.env.AETHERDESK_BASE_URL || 'http://127.0.0.1:8000/api/v1';
const AETHERDESK_API_KEY = process.env.AETHERDESK_API_KEY || '';

/** Max audio payload in bytes (matches AetherDesk's 25 MB cap). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const contentLength = parseInt(request.headers.get('content-length') ?? '', 10);
  if (contentLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio payload too large' }, { status: 413 });
  }

  const audio = Buffer.from(await request.arrayBuffer());
  if (audio.length === 0) {
    return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio payload too large' }, { status: 413 });
  }

  try {
    const res = await fetch(`${AETHERDESK_BASE_URL}/voice/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-api-key': AETHERDESK_API_KEY,
      },
      body: audio,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      await appendAuditLog({
        event: 'voice_transcribe_error',
        status_code: res.status,
        error: text.slice(0, 200),
        agent: 'draymond',
      });
      return NextResponse.json(
        { error: `AetherDesk transcribe failed: HTTP ${res.status}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { text?: string };
    await appendAuditLog({
      event: 'voice_transcribe',
      text_preview: (data.text ?? '').slice(0, 120),
      agent: 'draymond',
    });
    return NextResponse.json({ text: data.text ?? '' });
  } catch (err) {
    await appendAuditLog({
      event: 'voice_transcribe_error',
      error: err instanceof Error ? err.message : String(err),
      agent: 'draymond',
    });
    return NextResponse.json(
      { error: 'AetherDesk transcribe unreachable' },
      { status: 502 },
    );
  }
}

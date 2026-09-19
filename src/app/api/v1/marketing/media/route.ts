// ============================================================================
// POST /api/v1/marketing/media — store a phone-captured image into SMD media
// ============================================================================
// Open Chat uploads a base64 screenshot from the phone; Draymond writes it
// into the SMD generated-images dir so the content pipeline (generate_image /
// schedule) can reference it. Returns the file path used.
//
// Body: { filename?: string, data: <base64>, mime?: string }
// Auth: CRON_SECRET Bearer.  Size-capped (8 MB base64).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { appendAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;

/** SMD generated-images directory (mirrors SMD MEDIA_IMAGES_DIR). */
const SMD_IMAGES_DIR =
  process.env.SMD_IMAGES_DIR ??
  'C:/Users/User/Downloads/Uplift/Draymond-Orchestrator/agents/Social-Media-Dashboard--main/media/generated/images';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    filename?: string;
    data?: string;
    mime?: string;
  }>(request);
  if (parseError) return parseError;

  const b64 = typeof body.data === 'string' ? body.data.replace(/^data:[^;]+;base64,/, '') : '';
  if (!b64) {
    return NextResponse.json({ ok: false, error: 'data (base64) is required' }, { status: 400 });
  }
  if (b64.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'image too large (max 8MB base64)' }, { status: 413 });
  }

  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(SMD_IMAGES_DIR, { recursive: true });

    const name = String(body.filename ?? 'capture.png').replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeName = name.toLowerCase().endsWith('.png') || name.toLowerCase().endsWith('.jpg')
      ? name
      : `${name.replace(/\.(png|jpe?g)$/i, '')}.png`;
    const filePath = /*turbopackIgnore: true*/ path.join(SMD_IMAGES_DIR, safeName);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));

    await appendAuditLog({ event: 'marketing.media_stored', path: safeName });

    return NextResponse.json({
      ok: true,
      filename: safeName,
      path: filePath,
      size: /*turbopackIgnore: true*/ fs.statSync(filePath).size,
    });
  } catch (err) {
    console.error('[API /api/v1/marketing/media]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

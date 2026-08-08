import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getCurrentUser } from '@/lib/db/session';
import { getDb } from '@/lib/db/connection';

// Object keys in the local `paid-releases` releases directory.
// Each key maps a product ID to the filename stored in the directory.
const PRODUCT_FILES: Record<string, string> = {
  'sports-steve-bet-buddy': 'SportsSteveAndBetBuddy-Windows-x64.exe',
  'draymond-orchestrator': 'DraymondOrchestrator-Windows-x64.exe',
  'open-chat': 'OpenChat-Windows-x64.exe', // placeholder — not yet uploaded
};

function releasesDir(): string {
  return process.env.DRAYMOND_RELEASES_DIR ?? path.join(process.cwd(), 'data', 'paid-releases');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const productId: string | undefined = body?.product_id;

    if (!productId) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
    }

    const objectKey = PRODUCT_FILES[productId];
    if (!objectKey) {
      return NextResponse.json({ error: 'Unknown product' }, { status: 404 });
    }

    // ── 1. Verify a local session ─────────────────────────────────────────
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'No purchase found for this product. Complete checkout to unlock the download.' }, { status: 402 });
    }

    // ── 2. Verify a purchase record for this user + product ───────────────
    const purchase = getDb()
      .prepare('SELECT id FROM purchases WHERE product_id = ? AND user_id = ?')
      .get(productId, user.id);
    if (!purchase) {
      return NextResponse.json(
        { error: 'No purchase found for this product. Complete checkout to unlock the download.' },
        { status: 402 },
      );
    }

    // ── 3. Confirm the release file exists locally ────────────────────────
    const filePath = path.join(releasesDir(), objectKey);
    if (!fs.existsSync(filePath)) {
      console.error('Local release file missing:', filePath);
      return NextResponse.json({ error: 'Failed to generate download link' }, { status: 500 });
    }

    return NextResponse.json({
      url: `/api/downloads/file?product_id=${encodeURIComponent(productId)}`,
      filename: objectKey,
      expires_in: 900,
    });
  } catch (err) {
    console.error('signed-url route error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

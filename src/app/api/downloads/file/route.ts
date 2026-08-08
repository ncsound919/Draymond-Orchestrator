import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getCurrentUser } from '@/lib/db/session';
import { getDb } from '@/lib/db/connection';

// Mirrors the map in /api/downloads/signed-url.
const PRODUCT_FILES: Record<string, string> = {
  'sports-steve-bet-buddy': 'SportsSteveAndBetBuddy-Windows-x64.exe',
  'draymond-orchestrator': 'DraymondOrchestrator-Windows-x64.exe',
  'open-chat': 'OpenChat-Windows-x64.exe',
};

function releasesDir(): string {
  return process.env.DRAYMOND_RELEASES_DIR ?? path.join(process.cwd(), 'data', 'paid-releases');
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get('product_id');
  if (!productId) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
  }

  const objectKey = PRODUCT_FILES[productId];
  if (!objectKey) {
    return NextResponse.json({ error: 'Unknown product' }, { status: 404 });
  }

  // Verify the session + purchase (same gate as the signed-url route).
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'No purchase found for this product.' }, { status: 402 });
  }
  const purchase = getDb()
    .prepare('SELECT id FROM purchases WHERE product_id = ? AND user_id = ?')
    .get(productId, user.id);
  if (!purchase) {
    return NextResponse.json({ error: 'No purchase found for this product.' }, { status: 402 });
  }

  const filePath = path.join(releasesDir(), objectKey);
  if (!fs.existsSync(filePath)) {
    console.error('Local release file missing:', filePath);
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream;

  return new NextResponse(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${objectKey}"`,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=60',
    },
  });
}

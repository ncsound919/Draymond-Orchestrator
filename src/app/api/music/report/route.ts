import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { generateCrossPlatformFiles, type MusicOrg } from '@/lib/music-rights';

export const dynamic = 'force-dynamic';

const ORGS: MusicOrg[] = ['ascap', 'hfa', 'mlc'];

/**
 * POST /api/music/report
 * After registering a song on ONE platform, report it here. Draymond generates
 * the registration payloads (files) for the remaining platforms (ASCAP / HFA /
 * MLC) so each can be submitted next.
 *
 * Body: { org: "ascap"|"hfa"|"mlc", songs: [{ title, artist, isrc, writers, ... }] }
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { org, songs } = (body ?? {}) as Record<string, unknown>;

  if (typeof org !== 'string' || !ORGS.includes(org as MusicOrg)) {
    return NextResponse.json({ error: `org must be one of: ${ORGS.join(', ')}` }, { status: 400 });
  }

  try {
    const result = await generateCrossPlatformFiles(org as MusicOrg, Array.isArray(songs) ? songs as never[] : []);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate cross-platform files';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

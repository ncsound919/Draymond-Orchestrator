import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { registerMusic, type MusicOrg } from '@/lib/music-rights';

export const dynamic = 'force-dynamic';

const ORGS: MusicOrg[] = ['ascap', 'hfa', 'mlc'];

/**
 * POST /api/music/register
 * Stage + submit a music catalog for registration with ASCAP, HFA, or MLC.
 * Requires the admin CRON_SECRET. Credentials are read from the request body
 * (never logged); if missing, the catalog is staged for later submission.
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
  const { org, songs, email, password, publisher_name, publisher_ipi, publisher_p_number } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof org !== 'string' || !ORGS.includes(org as MusicOrg)) {
    return NextResponse.json(
      { error: `org must be one of: ${ORGS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const record = await registerMusic({
      org: org as MusicOrg,
      songs: Array.isArray(songs) ? songs as never[] : [],
      email: typeof email === 'string' ? email : undefined,
      password: typeof password === 'string' ? password : undefined,
      publisher_name: typeof publisher_name === 'string' ? publisher_name : undefined,
      publisher_ipi: typeof publisher_ipi === 'string' ? publisher_ipi : undefined,
      publisher_p_number: typeof publisher_p_number === 'string' ? publisher_p_number : undefined,
    });
    return NextResponse.json(record, { status: record.status === 'failed' ? 422 : 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

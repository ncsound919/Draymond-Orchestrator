import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { buildRecap, saveRecap, sendRecap, renderRecap } from '@/lib/draymond/communicator';

export const dynamic = 'force-dynamic';

/** GET /api/ops/communicator?phase=morning|midday|evening|night — preview a recap */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const phase = (new URL(request.url).searchParams.get('phase') ?? 'evening') as 'morning' | 'midday' | 'evening' | 'night';
  const recap = await buildRecap(phase);
  return NextResponse.json({ recap, markdown: renderRecap(recap) });
}

/** POST /api/ops/communicator — { phase, send?: boolean } build (+send) a recap */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const phase = (body.phase ?? 'evening') as 'morning' | 'midday' | 'evening' | 'night';
  const recap = await buildRecap(phase);
  await saveRecap(recap);
  if (body.send === true) {
    const sent = await sendRecap(recap);
    return NextResponse.json({ recap, sent });
  }
  return NextResponse.json({ recap });
}

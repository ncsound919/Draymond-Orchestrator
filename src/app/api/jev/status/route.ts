import { NextRequest, NextResponse } from 'next/server';
import { jevStatus } from '@/lib/draymond/jevClient';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    return NextResponse.json({ ok: true, ...(await jevStatus()) });
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
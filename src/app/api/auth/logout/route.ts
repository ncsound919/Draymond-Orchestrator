import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, destroySession } from '@/lib/db/auth';
import { clearSessionCookie } from '@/lib/db/session';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  return clearSessionCookie(NextResponse.json({ ok: true }));
}

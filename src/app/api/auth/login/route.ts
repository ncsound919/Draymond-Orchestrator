import { NextRequest, NextResponse } from 'next/server';
import { login } from '@/lib/db/auth';
import { setSessionCookie } from '@/lib/db/session';

// Simple in-memory brute-force guard: per-IP sliding window of failed attempts.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, { count: number; firstAt: number }>();

function isBlocked(ip: string): boolean {
  const rec = failures.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    failures.set(ip, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (isBlocked(ip)) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const email: string | undefined = body?.email;
    const password: string | undefined = body?.password;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const result = login(email, password);
    if (!result.token || !result.user) {
      recordFailure(ip);
      return NextResponse.json({ error: result.error ?? 'Login failed' }, { status: 401 });
    }

    failures.delete(ip);
    const response = NextResponse.json({ ok: true, user: { id: result.user.id, email: result.user.email } });
    const secure = request.nextUrl.protocol === 'https:';
    return setSessionCookie(response, result.token, secure);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

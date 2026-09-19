/**
 * GET /api/v1/snapshot — the ONE-push ecosystem status export for Open-Chat.
 *
 * Returns a single packaged snapshot: revenue pulse (mission), fleet health
 * (heartbeats + critical Kairos moments), strategy + marketing team state,
 * recommended actions, and a plain-language narrative paragraph describing the
 * state of things. Everything a command layer needs to show "the ecosystem
 * right now" in one call.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { buildEcosystemStatus } from '@/lib/draymond/ecosystem-status';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await buildEcosystemStatus());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 }
    );
  }
}
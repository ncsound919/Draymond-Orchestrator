import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import {
  affiliateSummary,
  createAffiliate,
  listAffiliates,
  type AffiliateRole,
} from '@/lib/draymond/affiliates';

export const dynamic = 'force-dynamic';

const ROLES: AffiliateRole[] = ['referrer', 'recruiter', 'supervisor', 'agent'];

/**
 * GET /api/affiliates — the partner registry + ledger summary.
 * POST /api/affiliates — register a partner (referrer | recruiter | supervisor | agent).
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  return NextResponse.json({
    affiliates: await listAffiliates(),
    summary: await affiliateSummary(),
  });
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => null)) as {
    code?: string;
    name?: string;
    role?: string;
    email?: string;
    parentId?: string;
  } | null;

  if (!body?.code || !body?.name || !body?.role) {
    return NextResponse.json({ error: 'code, name and role are required' }, { status: 400 });
  }
  if (!ROLES.includes(body.role as AffiliateRole)) {
    return NextResponse.json({ error: `role must be one of: ${ROLES.join(', ')}` }, { status: 400 });
  }

  try {
    const affiliate = await createAffiliate({
      code: body.code,
      name: body.name,
      role: body.role as AffiliateRole,
      email: body.email,
      parentId: body.parentId,
    });
    return NextResponse.json(affiliate, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

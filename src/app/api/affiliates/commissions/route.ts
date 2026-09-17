import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import {
  listCommissions,
  setCommissionStatus,
  type CommissionStatus,
} from '@/lib/draymond/affiliates';

export const dynamic = 'force-dynamic';

const STATUSES: CommissionStatus[] = ['accrued', 'approved', 'paid'];

/**
 * GET /api/affiliates/commissions?affiliateId=&status=
 * The payout ledger — accrued → approved → paid. Money movement itself runs
 * through Stripe Connect (OpenPartner / Commission Engine); this is the record.
 *
 * POST /api/affiliates/commissions  { id, status }
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const params = new URL(request.url).searchParams;
  const status = params.get('status') ?? undefined;
  if (status && !STATUSES.includes(status as CommissionStatus)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
  }

  const commissions = await listCommissions({
    affiliateId: params.get('affiliateId') ?? undefined,
    status: status as CommissionStatus | undefined,
  });

  return NextResponse.json({
    commissions,
    totalCents: commissions.reduce((s, c) => s + c.amountCents, 0),
  });
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    status?: string;
  } | null;

  if (!body?.id || !body?.status) {
    return NextResponse.json({ error: 'id and status are required' }, { status: 400 });
  }
  if (!STATUSES.includes(body.status as CommissionStatus)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
  }

  const updated = await setCommissionStatus(body.id, body.status as CommissionStatus);
  if (!updated) return NextResponse.json({ error: 'commission not found' }, { status: 404 });
  return NextResponse.json(updated);
}

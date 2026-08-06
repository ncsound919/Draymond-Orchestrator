import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { listOpportunities, addOpportunity, updateOpportunityStage } from '@/lib/draymond/business-pipeline';

export const dynamic = 'force-dynamic';

const STAGES = ['lead', 'proposal', 'negotiation', 'won', 'lost'];
const ENGINES = ['E1-platform', 'E2-b2b', 'E3-tooling', 'E4-vertical'];

export async function GET() {
  const authError = authorizeRequest(new NextRequest('http://localhost'));
  if (authError) return authError;
  return NextResponse.json({ opportunities: await listOpportunities() });
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { name, engine, stage, monthlyValue, owner, nextAction } = body;
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (typeof engine !== 'string' || !ENGINES.includes(engine)) {
    return NextResponse.json({ error: `engine must be one of: ${ENGINES.join(', ')}` }, { status: 400 });
  }
  if (typeof stage !== 'string' || !STAGES.includes(stage)) {
    return NextResponse.json({ error: `stage must be one of: ${STAGES.join(', ')}` }, { status: 400 });
  }
  const value = Number(monthlyValue);
  if (!Number.isFinite(value) || value < 0) {
    return NextResponse.json({ error: 'monthlyValue must be a non-negative number' }, { status: 400 });
  }

  const opp = await addOpportunity({
    name,
    engine: engine as never,
    stage: stage as never,
    monthlyValue: value,
    owner: typeof owner === 'string' ? owner : 'draymond',
    nextAction: typeof nextAction === 'string' ? nextAction : '',
  });
  return NextResponse.json(opp, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id, stage } = body;
  if (typeof id !== 'string' || typeof stage !== 'string' || !STAGES.includes(stage)) {
    return NextResponse.json({ error: 'id and a valid stage are required' }, { status: 400 });
  }
  const opp = await updateOpportunityStage(id, stage as never);
  if (!opp) return NextResponse.json({ error: 'opportunity not found' }, { status: 404 });
  return NextResponse.json(opp);
}

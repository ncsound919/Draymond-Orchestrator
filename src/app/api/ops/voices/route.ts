import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { listVoices, agentVoice } from '@/lib/draymond/voices';

export const dynamic = 'force-dynamic';

const VOICED_AGENTS = [
  'aetherdesk', 'social-media-dashboard', 'overlay-guardian', 'overlay-auditor',
  'overlay-treasurer', 'overlay-strategist', 'agent-browser', 'overlay365-qa',
];

/** GET /api/ops/voices — voice registry + per-agent assignment status */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const voices = await listVoices();
  const assignments = [];
  for (const a of VOICED_AGENTS) {
    assignments.push({ agentId: a, ...(await agentVoice(a)) });
  }
  return NextResponse.json({ voices, assignments });
}

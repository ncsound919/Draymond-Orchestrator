import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { runSiteTests, isAgentBrowserConfigured } from '@/lib/agentbrowser';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agentbrowser/test?suite=all|overlay365|health|wealth|justice
 * Runs the Overlay365 Playwright QA suite via AgentBrowser. Admin (CRON_SECRET).
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  if (!isAgentBrowserConfigured()) {
    return NextResponse.json(
      { error: 'AgentBrowser not configured — set AGENTBROWSER_URL + AGENTBROWSER_API_KEY' },
      { status: 503 },
    );
  }

  const suite = new URL(request.url).searchParams.get('suite') ?? 'all';
  const valid = ['all', 'overlay365', 'health', 'wealth', 'justice'];
  if (!valid.includes(suite)) {
    return NextResponse.json({ error: `suite must be one of: ${valid.join(', ')}` }, { status: 400 });
  }

  try {
    const report = await runSiteTests(suite);
    return NextResponse.json(report, { status: report.overall === 'pass' ? 200 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QA run failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

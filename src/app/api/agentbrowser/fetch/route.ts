import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { browserFetch, isAgentBrowserConfigured } from '@/lib/agentbrowser';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agentbrowser/fetch
 * Ask AgentBrowser's browser skills to fetch a file / page for Draymond.
 * Body: { url, action?: "get-content"|"extract"|"download", selectors?: string[] }
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { url, action, selectors } = (body ?? {}) as Record<string, unknown>;

  if (typeof url !== 'string' || !url.startsWith('http')) {
    return NextResponse.json({ error: 'url must be an http(s) URL' }, { status: 400 });
  }

  if (!isAgentBrowserConfigured()) {
    return NextResponse.json(
      { error: 'AgentBrowser not configured — set AGENTBROWSER_URL + AGENTBROWSER_API_KEY' },
      { status: 503 },
    );
  }

  try {
    const result = await browserFetch(
      url,
      action === 'download' || action === 'extract' || action === 'get-content' ? action : 'get-content',
      Array.isArray(selectors) ? selectors.map(String) : undefined,
    );
    return NextResponse.json(result, { status: result.error ? 422 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AgentBrowser fetch failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// ============================================================================
// POST /api/bridge/v1/environments/bridge — Register a bridge environment
// ============================================================================
// Creates (or resumes) an environment that a bridge worker (e.g. Open-Chat's
// UpliftBridgeClient) polls for work. Returns the environment_id +
// environment_secret used on all subsequent work calls.
//
// Auth: CRON_SECRET Bearer token (same as other Draymond APIs).
//
// Body (JSON):
//   { machine_name, directory, branch, git_repo_url?, max_sessions?,
//     environment_id?, metadata?: { worker_type? } }
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { getBridgeStore } from '@/lib/draymond/bridge-singleton';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    machine_name?: unknown;
    directory?: unknown;
    branch?: unknown;
    git_repo_url?: unknown;
    max_sessions?: unknown;
    environment_id?: unknown;
    metadata?: unknown;
  }>(request);
  if (parseError) return parseError;

  try {
    const machineName =
      typeof body.machine_name === 'string' ? body.machine_name.slice(0, 128) : 'bridge-worker';
    const directory = typeof body.directory === 'string' ? body.directory.slice(0, 512) : '/';
    const branch = typeof body.branch === 'string' ? body.branch.slice(0, 128) : 'main';
    const gitRepoUrl =
      typeof body.git_repo_url === 'string' && body.git_repo_url
        ? body.git_repo_url.slice(0, 512)
        : null;
    const maxSessions =
      typeof body.max_sessions === 'number' && Number.isFinite(body.max_sessions)
        ? Math.max(1, Math.min(64, Math.floor(body.max_sessions)))
        : 1;
    const reuseEnvironmentId =
      typeof body.environment_id === 'string' && /^[a-zA-Z0-9_-]+$/.test(body.environment_id)
        ? body.environment_id
        : undefined;
    const workerType =
      body.metadata && typeof body.metadata === 'object' &&
      (body.metadata as { worker_type?: unknown }).worker_type &&
      typeof (body.metadata as { worker_type: unknown }).worker_type === 'string'
        ? ((body.metadata as { worker_type: string }).worker_type as string)
        : 'claude_code';

    const store = await getBridgeStore();
    const apiBaseUrl =
      process.env.DRAYMOND_PUBLIC_URL?.replace(/\/$/, '') ??
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    const result = store.register(
      {
        dir: directory,
        machineName,
        branch,
        gitRepoUrl,
        maxSessions,
        workerType,
        environmentId: reuseEnvironmentId,
      },
      apiBaseUrl,
    );

    return NextResponse.json({ ...result, ok: true });
  } catch (err) {
    console.error('[API /api/bridge/v1/environments/bridge]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

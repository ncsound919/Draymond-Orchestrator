/**
 * POST /api/ops/repair-triage
 *
 * Triggered from the Open-Chat "Diagnose & Repair" ntfy action (or by scripts
 * with the CRON_SECRET Bearer token). Runs RepoRank + Grader diagnosis on the
 * affected component, then dispatches the repair team:
 *   - kind=job      → repairFailedJob (config fixes / crew assignment)
 *   - kind=monitor  → attemptRepair (known safe self-repair)
 *
 * Auth (either is sufficient):
 *   - Bearer token checked against CRON_SECRET env var (admin / scripts)
 *   - X-Repair-Token header matching a single-use repair token issued by
 *     publishIssueNotification (set by Open-Chat's ntfy HTTP action).
 *
 * Body (JSON):
 *   { signal: string, detail: string, kind?: 'job'|'monitor',
 *     repoUrl?: string, job?: { id, name, job_type, job_config } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { consumeRepairToken, publishIssueNotification } from '@/lib/draymond/ntfy';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // -- Auth: CRON_SECRET Bearer OR single-use repair token ------------------
  const cronAuthorized = authorizeRequest(request) === null;

  const headerToken = request.headers.get('x-repair-token');
  const repairClaim = headerToken ? consumeRepairToken(headerToken) : null;

  if (!cronAuthorized && !repairClaim) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bodyResult = await parseJsonBody<{
    signal?: unknown;
    detail?: unknown;
    kind?: unknown;
    repoUrl?: unknown;
    job?: unknown;
  }>(request);
  if (bodyResult.error) return bodyResult.error;

  const { signal, detail, kind, repoUrl, job } = bodyResult.data;

  // A repair token carries the original signal/detail when the body omits them.
  const effSignal =
    typeof signal === 'string' && signal.trim()
      ? signal.trim()
      : repairClaim?.signal ?? null;
  const effDetail =
    typeof detail === 'string' && detail.trim()
      ? detail.trim()
      : repairClaim?.detail ?? effSignal ?? 'unknown failure';
  const effKind = (kind === 'job' || repairClaim?.kind === 'job') ? 'job' : 'monitor';
  const effRepoUrl = typeof repoUrl === 'string' && repoUrl.trim() ? repoUrl.trim() : repairClaim?.repoUrl;

  if (!effSignal) {
    return NextResponse.json({ error: 'signal is required (e.g. job:error, monitor:down)' }, { status: 400 });
  }

  const startedAt = Date.now();

  // -- Benign whitelist: record-and-return before any LLM scorers run --------
  // Routed through attemptRepair (not a synthetic response) so the skipped
  // attempt is actually appended to repair-log.json — the audit trail holds
  // for every entry path, not just the scheduler/monitor callers.
  const { isIgnoredSignal, attemptRepair } = await import('@/lib/draymond/self-repair');
  if (isIgnoredSignal(effSignal)) {
    const repair = await attemptRepair(effSignal, effDetail);
    await publishIssueNotification({
      title: 'Draymond · Benign signal recorded',
      message: `${effSignal} — on the benign whitelist, no diagnosis or repair dispatched.\n\n${String(repair?.detail ?? effDetail ?? '')}`,
      priority: 1,
      tags: ['bell', 'information_source'],
    }).catch(() => {});
    return NextResponse.json({
      ok: true,
      signal: effSignal,
      kind: effKind,
      diagnosis: [],
      repair,
      duration_ms: Date.now() - startedAt,
    }, { status: 200 });
  }

  // -- 1. Diagnosis: RepoRank + Grader (best-effort, never blocks repair) ----
  const diagnosis: Array<{ scorer: string; score: number | null; grade?: string; summary: string; error?: string }> = [];
  if (effRepoUrl) {
    const { scoreWithReporank, scoreWithGrader } = await import('@/lib/draymond/deep-scorers');
    const [rr, gr] = await Promise.all([
      scoreWithReporank('failed-component', effRepoUrl).catch(() => ({
        scorer: 'reporank', score: null, summary: 'reporank diagnosis failed', error: 'scorer threw',
      })),
      scoreWithGrader('failed-component', effRepoUrl).catch(() => ({
        scorer: 'grader', score: null, summary: 'grader diagnosis failed', error: 'scorer threw',
      })),
    ]);
    diagnosis.push(
      { scorer: rr.scorer, score: rr.score, summary: rr.summary, error: rr.error },
      { scorer: gr.scorer, score: gr.score, summary: gr.summary, error: gr.error },
    );
  }

  // -- 2. Repair team --------------------------------------------------------
  let repair: Record<string, unknown>;
  if (effKind === 'job') {
    const { repairFailedJob } = await import('@/lib/draymond/repair-team');
    const { updateJob } = await import('@/lib/draymond/scheduler');
    const jobPayload = (job ?? repairClaim?.job) as {
      id: string; name: string; job_type: string; job_config: Record<string, unknown>;
    } | undefined;
    if (jobPayload?.id) {
      repair = await repairFailedJob(jobPayload, effDetail, {
        updateJobConfig: (id, config) => updateJob(id, { job_config: config }),
      }) as unknown as Record<string, unknown>;
    } else {
      repair = { action: 'escalated', detail: 'no job payload provided — escalate for manual review', signal: effSignal };
    }
  } else {
    const { attemptRepair } = await import('@/lib/draymond/self-repair');
    repair = await attemptRepair(effSignal, effDetail) as unknown as Record<string, unknown>;
  }

  // -- 3. Report the outcome back to Open-Chat via the results topic ---------
  const ok = repair?.status === 'applied' || repair?.action === 'fixed';
  await publishIssueNotification({
    title: ok ? 'Draymond · Repair applied' : 'Draymond · Repair escalated',
    message: `${effSignal} — ${ok ? 'fixed automatically' : 'needs human attention'}.\n\n${String(repair?.detail ?? '')}`,
    priority: ok ? 3 : 5,
    tags: ok ? ['white_check_mark'] : ['rotating_light'],
  }).catch(() => {});

  return NextResponse.json({
    ok,
    signal: effSignal,
    kind: effKind,
    diagnosis,
    repair,
    duration_ms: Date.now() - startedAt,
  }, { status: ok ? 200 : 202 });
}

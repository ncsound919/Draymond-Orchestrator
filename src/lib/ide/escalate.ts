// ============================================================================
// DRAYMOND AGENT IDE — interjection escalation ladder
// ============================================================================
// When a session needs a human decision on a risky step, it escalates in
// order:
//   1. chat   — the decision appears inline in the /ide session (and chat).
//   2. openchat — ntfy push to the Open-Chat app with one-tap Approve/Reject
//                buttons that POST back through the decisions API.
//   3. email  — Gmail alert via the existing notification service.
//   4. montecarlo — if the human still hasn't answered, the MathX Monte Carlo
//                engine picks the best choice from the option estimates and
//                the session continues, recording WHY so the human can see it.
//
// All channels are best-effort; an offline Open Chat / email must never block
// the session. The escalation loop itself just polls the decision's status and
// moves to the next channel when the current one times out.
// ============================================================================

import { randomBytes } from 'crypto';
import type { IdeDecision, IdeSession } from './types';
import { publishSessionEvent } from './event-bus';
import { loadSession, saveSession } from './session-store';
import { decideByMonteCarlo } from './monte-carlo';

const CHAT_TTL_MS = Number(process.env.IDE_DECISION_CHAT_TTL_MS ?? 120_000);
const PUSH_TTL_MS = Number(process.env.IDE_DECISION_PUSH_TTL_MS ?? 180_000);
const EMAIL_TTL_MS = Number(process.env.IDE_DECISION_EMAIL_TTL_MS ?? 180_000);
const POLL_MS = 5_000;
const MAX_DECISION_TOKENS = 500;

// ── Decision waiter registry (resolved by the decisions API or the ladder) ──

type Waiter = { resolve: (d: IdeDecision) => void };
const waiters = new Map<string, Waiter>();

function keyOf(sessionId: string, decisionId: string): string {
  return `${sessionId}:${decisionId}`;
}

/** Wait (async) until the decision is resolved or escalated to auto-decide. */
export function waitForDecision(sessionId: string, decisionId: string): Promise<IdeDecision> {
  return new Promise((resolve) => {
    waiters.set(keyOf(sessionId, decisionId), { resolve });
  });
}

/** Resolve a pending decision waiter (called by the decisions API / the ladder). */
export function releaseDecision(sessionId: string, decisionId: string, decision: IdeDecision): void {
  const w = waiters.get(keyOf(sessionId, decisionId));
  if (w) {
    waiters.delete(keyOf(sessionId, decisionId));
    w.resolve(decision);
  }
}

/** Release every pending waiter for a session (used on abort so the runner can unwind). */
export function releaseSessionWaiters(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const [key, w] of waiters) {
    if (key.startsWith(prefix)) {
      waiters.delete(key);
      w.resolve({
        id: key.slice(prefix.length),
        prompt: 'session aborted',
        risk: 'medium',
        reason: 'session aborted by user',
        status: 'rejected',
        method: 'chat',
        options: [],
        resolvedAt: new Date().toISOString(),
      });
    }
  }
}

export function hasDecisionWaiter(sessionId: string, decisionId: string): boolean {
  return waiters.has(keyOf(sessionId, decisionId));
}

// ── Single-use decision review tokens (ntfy buttons) ────────────────────────

type DecisionToken = { sessionId: string; decisionId: string; expiresAt: number };
const decisionTokens = new Map<string, DecisionToken>();

export function issueDecisionToken(sessionId: string, decisionId: string): { token: string; expiresAt: string } {
  const token = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + PUSH_TTL_MS + EMAIL_TTL_MS + 60_000;
  decisionTokens.set(token, { sessionId, decisionId, expiresAt });
  if (decisionTokens.size > MAX_DECISION_TOKENS) {
    const oldest = decisionTokens.keys().next().value as string;
    decisionTokens.delete(oldest);
  }
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function consumeDecisionToken(token: string): { sessionId: string; decisionId: string } | null {
  const entry = decisionTokens.get(token);
  if (!entry) return null;
  decisionTokens.delete(token); // single-use
  if (Date.now() > entry.expiresAt) return null;
  return { sessionId: entry.sessionId, decisionId: entry.decisionId };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function latestDecision(sessionId: string, decisionId: string): Promise<IdeDecision | null> {
  const session = await loadSession(sessionId);
  return session?.decisions.find((d) => d.id === decisionId) ?? null;
}

function emit(sessionId: string, type: string, stepId: string | undefined, data: Record<string, unknown>): void {
  publishSessionEvent(sessionId, {
    id: randomBytes(6).toString('hex'),
    ts: new Date().toISOString(),
    type: type as never,
    sessionId,
    stepId,
    data,
  });
}

async function markEscalated(session: IdeSession, decision: IdeDecision, method: IdeDecision['method']): Promise<void> {
  const d = await latestDecision(session.id, decision.id);
  if (!d || d.status !== 'pending') return;
  d.escalatedAt = new Date().toISOString();
  const s = await loadSession(session.id);
  if (s) {
    const idx = s.decisions.findIndex((x) => x.id === decision.id);
    // Compare-and-swap: only persist if the decision is still pending (a human
    // may have answered between the read above and this write).
    if (idx >= 0 && s.decisions[idx].status === 'pending') {
      s.decisions[idx] = d;
      await saveSession(s);
    }
  }
  emit(session.id, 'decision.escalated', undefined, {
    decisionId: decision.id,
    method,
    prompt: d.prompt,
    risk: d.risk,
  });
}

async function publishOpenChatPush(session: IdeSession, decision: IdeDecision): Promise<boolean> {
  const baseUrl = process.env.NTFY_URL;
  const topic = process.env.NTFY_TOPIC;
  const publicUrl = process.env.DRAYMOND_PUBLIC_URL;
  if (!baseUrl || !topic || !publicUrl) return false;

  const { token } = issueDecisionToken(session.id, decision.id);
  const path = `/api/ide/sessions/${encodeURIComponent(session.id)}/decisions/${encodeURIComponent(decision.id)}`;
  const approveHeaders = { 'Content-Type': 'application/json', 'X-Decision-Token': token };
  const options = decision.options.map((o) => `- ${o.label}${o.description ? `: ${o.description}` : ''}`).join('\n');

  try {
    const res = await fetch(baseUrl.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title: `Draymond · Decision needed: ${decision.risk}`,
        message: `${decision.prompt}\n\n${options}\n\nReason: ${decision.reason}`,
        priority: decision.risk === 'critical' ? 5 : decision.risk === 'high' ? 4 : 3,
        tags: ['warning'],
        actions: [
          {
            action: 'http',
            label: 'Approve',
            url: `${publicUrl.replace(/\/+$/, '')}${path}`,
            method: 'POST',
            headers: approveHeaders,
            body: JSON.stringify({ approved: true }),
            clear: true,
          },
          {
            action: 'http',
            label: 'Reject',
            url: `${publicUrl.replace(/\/+$/, '')}${path}`,
            method: 'POST',
            headers: approveHeaders,
            body: JSON.stringify({ approved: false }),
            clear: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendDecisionEmail(session: IdeSession, decision: IdeDecision): Promise<boolean> {
  const recipient = process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER;
  if (!recipient) return false;
  try {
    const { sendNotification } = await import('../draymond/notifications');
    await sendNotification({
      channel: 'email',
      recipient,
      subject: `Decision needed (${decision.risk} risk): ${decision.prompt.slice(0, 80)}`,
      body: `${decision.prompt}\n\nReason: ${decision.reason}\n\nOptions:\n${decision.options
        .map((o) => `- ${o.label}${o.description ? `: ${o.description}` : ''}`)
        .join('\n')}\n\nOpen the IDE session to respond: ${publicSessionUrl(session.id)}`,
      type: 'custom',
      priority: decision.risk === 'critical' ? 'critical' : decision.risk === 'high' ? 'high' : 'normal',
      metadata: { session_id: session.id, decision_id: decision.id },
    });
    return true;
  } catch {
    return false;
  }
}

function publicSessionUrl(sessionId: string): string {
  const base = process.env.DRAYMOND_PUBLIC_URL ?? '';
  return base ? `${base.replace(/\/+$/, '')}/ide/${sessionId}` : `/ide/${sessionId}`;
}

/**
 * Poll a decision until it's no longer pending, or until the timeout expires.
 */
async function waitPending(sessionId: string, decisionId: string, timeoutMs: number): Promise<IdeDecision | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await latestDecision(sessionId, decisionId);
    if (d && d.status !== 'pending') return d;
    await sleep(POLL_MS);
  }
  return latestDecision(sessionId, decisionId);
}

/**
 * Run the full escalation ladder for a pending decision. Fire-and-forget from
 * the session runner. When every human channel times out, auto-decides via the
 * Monte Carlo engine and releases the runner's waiter.
 */
export async function beginEscalation(session: IdeSession, decision: IdeDecision): Promise<IdeDecision> {
  // The decision.required event was already emitted by createDecision (with the
  // option list); the ladder only adds the escalation notifications from here.
  let current = await waitPending(session.id, decision.id, CHAT_TTL_MS);
  if (current && current.status !== 'pending') return current;

  // 2. openchat — ntfy push with Approve/Reject buttons.
  await markEscalated(session, decision, 'openchat');
  await publishOpenChatPush(session, decision);
  current = await waitPending(session.id, decision.id, PUSH_TTL_MS);
  if (current && current.status !== 'pending') return current;

  // 3. email.
  await markEscalated(session, decision, 'email');
  await sendDecisionEmail(session, decision);
  current = await waitPending(session.id, decision.id, EMAIL_TTL_MS);
  if (current && current.status !== 'pending') return current;

  // 4. montecarlo — autonomous best choice with evidence.
  const latest = await latestDecision(session.id, decision.id);
  if (latest && latest.status !== 'pending') return latest;

  const mc = decideByMonteCarlo(
    decision.options.map((o) => ({
      id: o.id,
      label: o.label,
      expectedOutcome: o.expectedOutcome,
      outcomeSpread: o.outcomeSpread,
    })),
    { trials: 20_000, riskAversion: 0.6 },
  );

  const resolved: IdeDecision = {
    ...decision,
    status: 'auto_decided',
    method: 'montecarlo',
    resolution: mc.choiceId,
    resolvedAt: new Date().toISOString(),
  };

  const s = await loadSession(session.id);
  if (s) {
    const idx = s.decisions.findIndex((d) => d.id === decision.id);
    // Compare-and-swap: never clobber a human answer that landed since the read.
    if (idx >= 0 && s.decisions[idx].status === 'pending') {
      s.decisions[idx] = resolved;
      await saveSession(s);
    }
  }
  emit(session.id, 'decision.resolved', undefined, {
    decisionId: decision.id,
    status: 'auto_decided',
    method: 'montecarlo',
    resolution: mc.choiceId,
    justification: mc.justification,
  });
  releaseDecision(session.id, decision.id, resolved);
  return resolved;
}

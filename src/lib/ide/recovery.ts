// ============================================================================
// DRAYMOND AGENT IDE — startup recovery sweep
// ============================================================================
// Closes the durability hole left by the in-memory runner: if the server dies
// mid-run, sessions stranded in `running` / `reviewing` / `paused` / 
// `waiting_decision` have no live runner or ladder. This sweep, run once at
// startup, recovers them:
//   • running/reviewing/paused → marked `error` (run aborted by restart),
//     a `session.error` event is published, and the result is distilled into
//     the team's memory so a future session doesn't repeat the failure.
//   • waiting_decision → the escalation ladder is re-armed for each pending
//     decision (so the human can still answer / it auto-decides), and when the
//     decision resolves the session is finalized as `error` with the outcome.
// Docker-free, in-process, idempotent.
// ============================================================================

import type { IdeSession } from './types';
import { loadSession, saveSession, listSessions } from './session-store';
import { publishSessionEvent } from './event-bus';
import { recordSessionMemory } from './session-memory';
import { beginEscalation, hasDecisionWaiter } from './escalate';

const INTERRUPTED_NOTE = 'interrupted by server restart';

let swept = false;

function makeEvent(sessionId: string, error: string, decisionStatus?: string): void {
  publishSessionEvent(sessionId, {
    id: `${Date.now()}-recovery-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type: 'session.error',
    sessionId,
    data: { error, decision: decisionStatus },
  });
}

async function finalizeError(session: IdeSession, note: string, decisionStatus?: string): Promise<void> {
  session.phase = 'error';
  session.note = session.note ? `${session.note} — ${note}` : note;
  await saveSession(session);
  makeEvent(session.id, session.note, decisionStatus);
  await recordSessionMemory(session).catch(() => {});
}

/** Re-arm the ladder for a stranded waiting_decision session and finish it once resolved. */
async function recoverWaiting(session: IdeSession): Promise<void> {
  const pending = session.decisions.filter((d) => d.status === 'pending');
  if (pending.length === 0) {
    await finalizeError(session, `${INTERRUPTED_NOTE} (no pending decision to resolve)`);
    return;
  }
  for (const decision of pending) {
    if (hasDecisionWaiter(session.id, decision.id)) continue; // a live runner owns it
    void beginEscalation(session, decision)
      .then(async (resolved) => {
        const s = await loadSession(session.id);
        if (!s) return;
        if (s.phase === 'waiting_decision') {
          await finalizeError(s, `${INTERRUPTED_NOTE} — decision resolved as ${resolved.status}`, resolved.status);
        }
      })
      .catch(() => {});
  }
}

/**
 * Scan persisted sessions and recover any that were interrupted by a restart.
 * Runs once per process unless `force` is set (tests). Returns the number of
 * sessions that needed recovery.
 */
export async function runRecoverySweep(opts: { force?: boolean } = {}): Promise<number> {
  if (swept && !opts.force) return 0;
  swept = true;

  let recovered = 0;
  const sessions = await listSessions(200);
  for (const session of sessions) {
    if (session.phase === 'done' || session.phase === 'error' || session.phase === 'assembling') continue;
    recovered += 1;
    if (session.phase === 'waiting_decision') {
      await recoverWaiting(session);
    } else {
      // running / reviewing / paused — the runner died with the process.
      await finalizeError(session, INTERRUPTED_NOTE);
    }
  }
  return recovered;
}

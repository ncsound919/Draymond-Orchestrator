// ============================================================================
// RECAP DELIVERY VOICE — JEV-framed humanized recap emails for Draymond
// ============================================================================
// The recap BODY is real telemetry (money, issues, insights, upgrades — never
// fabricated). JEV adds the DELIVERY VOICE: a choice over pre-authored framings
// that varies how the email opens/closes and the subject line, matched to the
// actual recap state (settled money, issues present, etc.).
//
// Honesty contract:
//   - Numbers always come from the PhaseRecap; framing only changes the words.
//   - When JEV is offline/unreachable, a deterministic framing is picked from
//     the same state so delivery still varies — source reports 'deterministic'.
//   - Never throws; always returns a usable voice + subject.
// ============================================================================

import { decideSystemOne, jevEnabled, type JevResult, type JevState, type JevQuestion } from './jevClient';
import type { PhaseRecap } from './communicator';

export type DeliverySource = 'vercel' | 'localjev' | 'deterministic';

export type RecapFraming = 'steady' | 'good-news' | 'attention' | 'action' | 'review';

export interface RecapVoice {
  framing: RecapFraming;
  source: DeliverySource;
  subject: string;
  opener: string;
  closer: string;
}

interface FramingTemplate {
  subject: string;
  opener: string;
  closer: string;
}

const FRAMINGS: Record<RecapFraming, FramingTemplate> = {
  steady: {
    subject: '{phase} recap — steady as she goes',
    opener: 'Quick read: things are moving without needing your attention.',
    closer: 'Nothing here demands action. I will flag it the moment that changes.',
  },
  'good-news': {
    subject: '{phase} recap — money landed',
    opener: 'Good news first: real cash came in and it is in the ledger.',
    closer: 'That is the highlight. The rest below is for context, not action.',
  },
  attention: {
    subject: '{phase} recap — worth a look',
    opener: 'A couple of signals today are worth your eyes — nothing on fire.',
    closer: 'Read the sections below when you get a minute.',
  },
  action: {
    subject: '{phase} recap — needs a decision',
    opener: 'One or two things today need your input before they can move.',
    closer: 'Those are the ones I need you on. The rest is already handled.',
  },
  review: {
    subject: '{phase} recap — the numbers',
    opener: 'No big swings, but here is where the day actually landed.',
    closer: 'Facts first, opinions second — that is all below.',
  },
};

/** Deterministic framing from real recap state (no JEV). */
export function deterministicRecapFraming(recap: PhaseRecap): RecapFraming {
  const money = recap.sections.money ?? '';
  const issues = recap.sections.issues ?? '';
  const hasSettledMoney = /\$([1-9]\d*|\d*[1-9])/.test(money);
  const hasIssues = issues.length > 0 && !issues.includes('No recurring issues');
  const hasUpgrades = Boolean(recap.sections.upgrades);

  if (hasSettledMoney) return 'good-news';
  if (hasIssues) return 'action';
  if (hasUpgrades) return 'attention';
  return recap.phase === 'night' ? 'review' : 'steady';
}

/** Build the JEV state + a single choice question over recap framings. */
export function recapDeliveryAdvisory(recap: PhaseRecap): { state: JevState; questions: Record<string, JevQuestion> } {
  const state: JevState = {
    action: 'recap_delivery',
    phase: recap.phase,
    money: (recap.sections.money ?? '').slice(0, 200),
    issues: (recap.sections.issues ?? '').slice(0, 200),
    insights: (recap.sections.insights ?? '').slice(0, 200),
    upgrades: (recap.sections.upgrades ?? '').slice(0, 200),
  };
  const questions: Record<string, JevQuestion> = {
    framing: {
      type: 'choice',
      instructions: 'Which delivery framing fits this recap best?',
      criteria: {
        steady: 'No money landed, no issues, no urgent flags',
        'good-news': 'Settled revenue present in the recap',
        attention: 'Upgrades or insights worth a glance, nothing urgent',
        action: 'Issues present that need the operator or a decision',
        review: 'End-of-day numbers recap, no swings',
      },
    },
  };
  return { state, questions };
}

function parseJevFraming(result: JevResult): RecapFraming | null {
  const answer = result.answers?.framing;
  if (answer && answer.type === 'choice') {
    const f = answer.choice as RecapFraming;
    if (f in FRAMINGS) return f;
  }
  return null;
}

const PHASE_LABEL: Record<PhaseRecap['phase'], string> = {
  morning: 'Morning',
  midday: 'Midday',
  evening: 'Evening',
  night: 'Night',
};

/** Build the delivery voice for a recap. Never throws. */
export async function buildRecapVoice(recap: PhaseRecap): Promise<RecapVoice> {
  const phase = PHASE_LABEL[recap.phase] ?? recap.phase;
  const fallback = (framing: RecapFraming, source: DeliverySource): RecapVoice => {
    const t = FRAMINGS[framing];
    return {
      framing,
      source,
      subject: t.subject.replace('{phase}', phase),
      opener: t.opener,
      closer: t.closer,
    };
  };

  if (!jevEnabled()) return fallback(deterministicRecapFraming(recap), 'deterministic');

  try {
    const { state, questions } = recapDeliveryAdvisory(recap);
    const result = await decideSystemOne({ state, questions });
    if (!result.ok) return fallback(deterministicRecapFraming(recap), 'deterministic');
    const framing = parseJevFraming(result);
    if (!framing) return fallback(deterministicRecapFraming(recap), 'deterministic');
    const src: DeliverySource = result.source === 'offline' ? 'deterministic' : result.source;
    return fallback(framing, src);
  } catch {
    return fallback(deterministicRecapFraming(recap), 'deterministic');
  }
}

/** Humanized, JEV-framed recap body. Facts from the recap, words from the voice. */
export async function humanizedRecap(recap: PhaseRecap): Promise<{ subject: string; body: string; voice: RecapVoice }> {
  const voice = await buildRecapVoice(recap);
  const lines = [`# ${PHASE_LABEL[recap.phase] ?? recap.phase} Recap — ${recap.generatedAt.slice(0, 10)}`, ''];
  for (const [label, text] of Object.entries(recap.sections)) {
    if (text) lines.push(`**${label}:** ${text}`, '');
  }
  const body = [voice.opener, '', ...lines, voice.closer, '', `(delivery voice: ${voice.framing} · ${voice.source})`].join('\n');
  return { subject: voice.subject, body, voice };
}
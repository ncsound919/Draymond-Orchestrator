import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildRecapVoice,
  deterministicRecapFraming,
  humanizedRecap,
  recapDeliveryAdvisory,
} from '../src/lib/draymond/recap-voice';
import type { PhaseRecap } from '../src/lib/draymond/communicator';

function recap(over: Partial<PhaseRecap> = {}): PhaseRecap {
  return {
    phase: 'morning',
    generatedAt: '2026-09-22T08:00:00.000Z',
    sections: {
      money: 'Settled revenue: $1250. Pipeline: $3000 active.',
      issues: 'No recurring issues.',
      insights: 'News: Example headline.',
      upgrades: 'Dev queue: Test feature.',
    },
    summary: 'Morning recap: money ok',
    ...over,
  };
}

describe('recap-voice', () => {
  beforeEach(() => {
    vi.stubEnv('DRAYMOND_JEV_ENABLED', '0');
    vi.stubEnv('TYPESAFE_BASE_URL', '');
    vi.stubEnv('JEV_LOCAL_BASE_URL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('picks good-news framing when settled money is present', () => {
    expect(deterministicRecapFraming(recap())).toBe('good-news');
  });

  it('picks action framing when issues are present', () => {
    const r = recap({ sections: { money: 'Settled revenue: $0', issues: '1 lesson(s): job X failing', insights: '', upgrades: '' } });
    expect(deterministicRecapFraming(r)).toBe('action');
  });

  it('builds a deterministic voice when JEV is unavailable', async () => {
    const voice = await buildRecapVoice(recap());
    expect(voice.source).toBe('deterministic');
    expect(voice.subject).toContain('Morning');
    expect(voice.opener.length).toBeGreaterThan(0);
  });

  it('builds a JEV advisory over the recap state', () => {
    const { state, questions } = recapDeliveryAdvisory(recap());
    const s = state as Record<string, unknown>;
    expect(s.action).toBe('recap_delivery');
    expect(s.phase).toBe('morning');
    expect(questions.framing.type).toBe('choice');
  });

  it('humanized recap keeps real facts and adds voice', async () => {
    const { subject, body, voice } = await humanizedRecap(recap());
    expect(subject.length).toBeGreaterThan(0);
    expect(body).toContain('$1250');
    expect(body).toContain('(delivery voice:');
    expect(voice.framing).toBe('good-news');
  });
});
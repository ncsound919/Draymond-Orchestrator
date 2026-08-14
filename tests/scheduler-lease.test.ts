import { describe, expect, it } from 'vitest';
import { isStaleLease } from '../src/lib/draymond/scheduler';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');

describe('isStaleLease', () => {
  it('treats an expired lease as stale', () => {
    const expired = new Date(NOW - 1).toISOString();
    expect(isStaleLease(expired, null, NOW, 45 * 60 * 1000)).toBe(true);
  });

  it('treats a live lease as alive even when last activity is old', () => {
    const live = new Date(NOW + 60_000).toISOString();
    const oldActivity = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(isStaleLease(live, oldActivity, NOW, 45 * 60 * 1000)).toBe(false);
  });

  it('falls back to the legacy threshold when there is no lease', () => {
    const oldActivity = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago
    const recent = new Date(NOW - 60_000).toISOString(); // 1m ago
    expect(isStaleLease(null, oldActivity, NOW, 45 * 60 * 1000)).toBe(true);
    expect(isStaleLease(null, recent, NOW, 45 * 60 * 1000)).toBe(false);
  });

  it('treats rows with no timestamps at all as stale', () => {
    expect(isStaleLease(null, null, NOW, 45 * 60 * 1000)).toBe(true);
  });

  it('falls back to the legacy threshold when the lease is invalid', () => {
    // An unparseable lease is ignored; the last-activity threshold decides.
    expect(isStaleLease('not-a-date', new Date(NOW).toISOString(), NOW, 45 * 60 * 1000)).toBe(false);
    const oldActivity = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(isStaleLease('not-a-date', oldActivity, NOW, 45 * 60 * 1000)).toBe(true);
  });
});

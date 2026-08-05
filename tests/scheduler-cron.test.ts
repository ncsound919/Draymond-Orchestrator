import { describe, expect, it } from 'vitest';
import { getNextRunTime } from '../src/lib/draymond/scheduler';

// getNextRunTime evaluates cron fields in LOCAL time (getMinutes/getHours/...),
// so tests build reference dates with the local-time constructor and assert
// against local-time getters to stay timezone-independent.

function local(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe('getNextRunTime', () => {
  it('computes the next minute for a simple interval', () => {
    const next = getNextRunTime('* * * * *', local(2026, 1, 5, 10, 0));
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(1);
  });

  it('runs at a specific hour', () => {
    const next = getNextRunTime('0 12 * * *', local(2026, 1, 5, 10, 0));
    expect(next.getHours()).toBe(12);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(5);
  });

  it('rolls to the next day when the scheduled hour has passed', () => {
    const next = getNextRunTime('0 12 * * *', local(2026, 1, 5, 15, 0));
    expect(next.getHours()).toBe(12);
    expect(next.getDate()).toBe(6);
  });

  it('handles every-N-minute intervals', () => {
    const next = getNextRunTime('*/5 * * * *', local(2026, 1, 5, 10, 0));
    expect(next.getMinutes()).toBe(5);
  });

  it('handles ranges (mon-fri daily 9am)', () => {
    const next = getNextRunTime('0 9 * * 1-5', local(2026, 1, 5, 8, 0)); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(5);
  });

  it('skips weekends for a mon-fri schedule', () => {
    // Saturday 2026-01-10; next mon-fri 9am is Monday 2026-01-12
    const next = getNextRunTime('0 9 * * 1-5', local(2026, 1, 10, 8, 0));
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(12);
    expect(next.getHours()).toBe(9);
  });

  it('supports comma lists in the minute field', () => {
    const next = getNextRunTime('15,45 * * * *', local(2026, 1, 5, 10, 0));
    expect(next.getMinutes()).toBe(15);
  });

  it('handles month/day-of-month constraints', () => {
    // 0 0 1 3 * — March 1
    const next = getNextRunTime('0 0 1 3 *', local(2026, 2, 1, 0, 0));
    expect(next.getMonth()).toBe(2); // March (0-indexed)
    expect(next.getDate()).toBe(1);
  });

  it('throws on malformed cron expressions', () => {
    expect(() => getNextRunTime('* * *', new Date())).toThrow(/expected 5 fields/);
    expect(() => getNextRunTime('', new Date())).toThrow();
  });
});

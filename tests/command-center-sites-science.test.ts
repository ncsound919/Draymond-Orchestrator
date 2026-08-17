// ============================================================================
// Command Center — Sites & Science pure helpers
// ============================================================================
// Unit tests for the framework-free helpers in
// src/components/command-center/sites-lib.ts. No network, no server, no React.
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  deploySummary,
  formatLastCheck,
  formatResponseTime,
  monitorIsDown,
  monitorStatusColor,
  paperSourceLabel,
  paperYearLabel,
  papersByGoal,
  type MonitorLike,
  type PaperLike,
} from '../src/components/command-center/sites-lib';

// ── monitorStatusColor ──────────────────────────────────────────────────────

describe('monitorStatusColor', () => {
  it('maps the four known statuses to the right dot colors', () => {
    expect(monitorStatusColor('up')).toBe('bg-green-500');
    expect(monitorStatusColor('down')).toBe('bg-red-500');
    expect(monitorStatusColor('degraded')).toBe('bg-yellow-500');
    expect(monitorStatusColor('unknown')).toBe('bg-gray-500');
  });

  it('falls back to gray for unknown statuses', () => {
    expect(monitorStatusColor('pending')).toBe('bg-gray-500');
    expect(monitorStatusColor('weird')).toBe('bg-gray-500');
    expect(monitorStatusColor('UP')).toBe('bg-gray-500');
  });

  it('falls back to gray for nullish / empty input', () => {
    expect(monitorStatusColor(null)).toBe('bg-gray-500');
    expect(monitorStatusColor(undefined)).toBe('bg-gray-500');
    expect(monitorStatusColor('')).toBe('bg-gray-500');
  });
});

// ── monitorIsDown ───────────────────────────────────────────────────────────

describe('monitorIsDown', () => {
  it('returns true only when current_status is exactly "down"', () => {
    expect(monitorIsDown({ current_status: 'down' })).toBe(true);
    expect(monitorIsDown({ current_status: 'up' })).toBe(false);
    expect(monitorIsDown({ current_status: 'degraded' })).toBe(false);
    expect(monitorIsDown({ current_status: 'unknown' })).toBe(false);
    expect(monitorIsDown({ current_status: null })).toBe(false);
    expect(monitorIsDown({ current_status: undefined })).toBe(false);
    expect(monitorIsDown({})).toBe(false);
  });

  it('handles nullish monitor objects', () => {
    expect(monitorIsDown(null)).toBe(false);
    expect(monitorIsDown(undefined)).toBe(false);
  });

  it('is usable with a full monitor object', () => {
    const m: MonitorLike = {
      id: '1',
      name: 'Uplift Agent',
      url: 'http://localhost:8000/health',
      current_status: 'down',
      consecutive_failures: 4,
    };
    expect(monitorIsDown(m)).toBe(true);
  });
});

// ── paperSourceLabel ────────────────────────────────────────────────────────

describe('paperSourceLabel', () => {
  it('maps known sources to display names', () => {
    expect(paperSourceLabel('openalex')).toBe('OpenAlex');
    expect(paperSourceLabel('pubmed')).toBe('PubMed');
  });

  it('passes unknown sources through unchanged', () => {
    expect(paperSourceLabel('arxiv')).toBe('arxiv');
    expect(paperSourceLabel('ArXiv')).toBe('ArXiv');
    expect(paperSourceLabel('Crossref')).toBe('Crossref');
  });

  it('handles nullish / empty input', () => {
    expect(paperSourceLabel(null)).toBe('Unknown');
    expect(paperSourceLabel(undefined)).toBe('Unknown');
    expect(paperSourceLabel('')).toBe('Unknown');
  });
});

// ── formatResponseTime ──────────────────────────────────────────────────────

describe('formatResponseTime', () => {
  it('formats sub-second times in milliseconds', () => {
    expect(formatResponseTime(120)).toBe('120ms');
    expect(formatResponseTime(0)).toBe('0ms');
    expect(formatResponseTime(999.4)).toBe('999ms');
    expect(formatResponseTime(500)).toBe('500ms');
  });

  it('formats one second and above as seconds with one decimal', () => {
    expect(formatResponseTime(1000)).toBe('1.0s');
    expect(formatResponseTime(1200)).toBe('1.2s');
    expect(formatResponseTime(15600)).toBe('15.6s');
  });

  it('handles null / undefined / NaN', () => {
    expect(formatResponseTime(null)).toBe('--');
    expect(formatResponseTime(undefined)).toBe('--');
    expect(formatResponseTime(Number.NaN)).toBe('--');
  });
});

// ── formatLastCheck ─────────────────────────────────────────────────────────

describe('formatLastCheck', () => {
  const now = Date.now();

  it('returns "Never" when there is no timestamp', () => {
    expect(formatLastCheck(null)).toBe('Never');
    expect(formatLastCheck(undefined)).toBe('Never');
    expect(formatLastCheck('')).toBe('Never');
  });

  it('returns "Never" for an unparseable timestamp', () => {
    expect(formatLastCheck('not-a-date')).toBe('Never');
  });

  it('renders future timestamps as "just now"', () => {
    expect(formatLastCheck(new Date(now + 5000).toISOString())).toBe('just now');
  });

  it('renders seconds, minutes, hours and days ago', () => {
    expect(formatLastCheck(new Date(now - 45_000).toISOString())).toBe('45s ago');
    expect(formatLastCheck(new Date(now - 60_000).toISOString())).toBe('1m ago');
    expect(formatLastCheck(new Date(now - 35 * 60_000).toISOString())).toBe('35m ago');
    expect(formatLastCheck(new Date(now - 2 * 3600_000).toISOString())).toBe('2h ago');
    expect(formatLastCheck(new Date(now - 3 * 24 * 3600_000).toISOString())).toBe('3d ago');
  });
});

// ── deploySummary ───────────────────────────────────────────────────────────

describe('deploySummary', () => {
  it('summarizes a successful deploy with duration', () => {
    expect(deploySummary({ ok: true, durationMs: 1200 })).toBe('Deploy succeeded (1.2s)');
    expect(deploySummary({ ok: true, message: 'Restarted pm2 process "draymond"', durationMs: 900 })).toBe(
      'Deploy succeeded (900ms)',
    );
  });

  it('summarizes a successful deploy without duration', () => {
    expect(deploySummary({ ok: true })).toBe('Deploy succeeded');
    expect(deploySummary({ ok: true, durationMs: null })).toBe('Deploy succeeded');
  });

  it('summarizes a failed deploy with the message', () => {
    expect(deploySummary({ ok: false, message: 'Deploy failed: pm2 not found' })).toBe(
      'Deploy failed: pm2 not found',
    );
    expect(deploySummary({ ok: false, message: 'Smoke test failed: Expected HTTP 200, got 500' })).toBe(
      'Deploy failed: Smoke test failed: Expected HTTP 200, got 500',
    );
  });

  it('does not duplicate the "Deploy failed:" prefix from the provider', () => {
    expect(deploySummary({ ok: false, message: 'Deploy failed: Deploy failed: pm2 not found' })).toBe(
      'Deploy failed: pm2 not found',
    );
  });

  it('handles missing or empty messages', () => {
    expect(deploySummary({ ok: false })).toBe('Deploy failed: unknown error');
    expect(deploySummary({ ok: false, message: '' })).toBe('Deploy failed: unknown error');
    expect(deploySummary({ ok: false, message: '   ' })).toBe('Deploy failed: unknown error');
    expect(deploySummary({ ok: false, message: 'Deploy failed:   ' })).toBe('Deploy failed: unknown error');
  });

  it('handles nullish results', () => {
    expect(deploySummary(null)).toBe('Deploy unavailable');
    expect(deploySummary(undefined)).toBe('Deploy unavailable');
  });
});

// ── papersByGoal ────────────────────────────────────────────────────────────

describe('papersByGoal', () => {
  const p1: PaperLike = { id: 'a', title: 'A paper', source: 'openalex', url: 'https://example.com/a' };
  const p2: PaperLike = { id: 'b', title: 'B paper', source: 'pubmed', url: 'https://example.com/b' };

  it('flattens a record into non-empty groups', () => {
    const groups = papersByGoal({ 'goal-one': [p1], 'goal-two': [p2] });
    expect(groups).toHaveLength(2);
    expect(groups[0].goal).toBe('goal-one');
    expect(groups[0].papers).toEqual([p1]);
    expect(groups[1].goal).toBe('goal-two');
    expect(groups[1].papers).toEqual([p2]);
  });

  it('drops empty groups', () => {
    const groups = papersByGoal({ 'empty-goal': [], 'full-goal': [p1] });
    expect(groups).toHaveLength(1);
    expect(groups[0].goal).toBe('full-goal');
  });

  it('coerces non-array entries to empty and drops them', () => {
    const groups = papersByGoal({ 'bad-goal': undefined as unknown as PaperLike[] });
    expect(groups).toEqual([]);
  });

  it('returns an empty array for empty or missing input', () => {
    expect(papersByGoal({})).toEqual([]);
    expect(papersByGoal(null)).toEqual([]);
    expect(papersByGoal(undefined)).toEqual([]);
  });
});

// ── paperYearLabel ──────────────────────────────────────────────────────────

describe('paperYearLabel', () => {
  it('passes numeric years through', () => {
    expect(paperYearLabel(2024)).toBe('2024');
    expect(paperYearLabel(1999)).toBe('1999');
  });

  it('extracts a 4-digit year from fuller date strings', () => {
    expect(paperYearLabel('2024 Feb 03')).toBe('2024');
    expect(paperYearLabel('Feb 2024')).toBe('2024');
    expect(paperYearLabel('2024')).toBe('2024');
  });

  it('falls back to the raw string when no year is found', () => {
    expect(paperYearLabel('N/A')).toBe('N/A');
    expect(paperYearLabel('unknown date')).toBe('unknown date');
  });

  it('handles nullish / empty input', () => {
    expect(paperYearLabel(null)).toBe('—');
    expect(paperYearLabel(undefined)).toBe('—');
    expect(paperYearLabel('')).toBe('—');
  });
});

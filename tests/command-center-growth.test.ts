// ============================================================================
// Command Center — Growth Ops helpers (pure unit tests, no network/server)
// ============================================================================
import { describe, expect, it } from 'vitest';
import type { CommandLead, SeoTask } from '@/lib/command-center/types';
import {
  formatCents,
  leadStageCount,
  nextStage,
  pipelineValue,
} from '@/components/command-center/crm-lib';
import { priorityColor, seoFilter } from '@/components/command-center/seo-lib';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLead(over: Partial<CommandLead> = {}): CommandLead {
  return {
    id: 'lead-1',
    name: 'Test Lead',
    email: null,
    phone: null,
    company: null,
    stage: 'new',
    value_cents: 0,
    owner: null,
    source: null,
    notes: [],
    tags: [],
    metadata: {},
    next_follow_up_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function makeTask(over: Partial<SeoTask> = {}): SeoTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: null,
    url: null,
    priority: 'medium',
    status: 'todo',
    owner: null,
    is_done: false,
    metadata: {},
    due_at: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// formatCents
// ---------------------------------------------------------------------------

describe('formatCents', () => {
  it('formats whole-dollar amounts with thousands separators', () => {
    expect(formatCents(500_000)).toBe('$5,000');
    expect(formatCents(1_234_567)).toBe('$12,346');
    expect(formatCents(12_500)).toBe('$125');
  });

  it('handles zero, null, undefined, and NaN', () => {
    expect(formatCents(0)).toBe('$0');
    expect(formatCents(null)).toBe('$0');
    expect(formatCents(undefined)).toBe('$0');
    expect(formatCents(Number.NaN)).toBe('$0');
  });

  it('handles negative amounts', () => {
    expect(formatCents(-500_000)).toBe('-$5,000');
    expect(formatCents(-10)).toBe('-$0');
  });

  it('rounds fractional cents to whole dollars', () => {
    expect(formatCents(99)).toBe('$1');
    expect(formatCents(49)).toBe('$0');
  });
});

// ---------------------------------------------------------------------------
// pipelineValue
// ---------------------------------------------------------------------------

describe('pipelineValue', () => {
  it('returns 0 for empty or missing lists', () => {
    expect(pipelineValue([])).toBe(0);
    expect(pipelineValue(null)).toBe(0);
    expect(pipelineValue(undefined)).toBe(0);
  });

  it('sums value_cents across active pipeline stages', () => {
    const leads = [
      makeLead({ id: 'a', stage: 'new', value_cents: 100_00 }),
      makeLead({ id: 'b', stage: 'qualified', value_cents: 250_00 }),
      makeLead({ id: 'c', stage: 'proposal', value_cents: 1_000_00 }),
    ];
    expect(pipelineValue(leads)).toBe(135_000);
  });

  it('excludes won and lost leads', () => {
    const leads = [
      makeLead({ id: 'a', stage: 'new', value_cents: 100_00 }),
      makeLead({ id: 'b', stage: 'won', value_cents: 999_000 }),
      makeLead({ id: 'c', stage: 'lost', value_cents: 888_000 }),
    ];
    expect(pipelineValue(leads)).toBe(10_000);
  });

  it('guards against missing or NaN value_cents', () => {
    const leads = [
      makeLead({ id: 'a', stage: 'new', value_cents: Number.NaN }),
      makeLead({ id: 'b', stage: 'contacted', value_cents: 5_000 }),
    ];
    expect(pipelineValue(leads)).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// leadStageCount
// ---------------------------------------------------------------------------

describe('leadStageCount', () => {
  it('returns 0 for empty or missing lists', () => {
    expect(leadStageCount([], 'new')).toBe(0);
    expect(leadStageCount(null, 'won')).toBe(0);
    expect(leadStageCount(undefined, 'won')).toBe(0);
  });

  it('counts leads in the requested stage only', () => {
    const leads = [
      makeLead({ id: 'a', stage: 'new' }),
      makeLead({ id: 'b', stage: 'new' }),
      makeLead({ id: 'c', stage: 'contacted' }),
      makeLead({ id: 'd', stage: 'won' }),
    ];
    expect(leadStageCount(leads, 'new')).toBe(2);
    expect(leadStageCount(leads, 'contacted')).toBe(1);
    expect(leadStageCount(leads, 'won')).toBe(1);
    expect(leadStageCount(leads, 'qualified')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// nextStage
// ---------------------------------------------------------------------------

describe('nextStage', () => {
  it('advances through the funnel in order', () => {
    expect(nextStage('new')).toBe('contacted');
    expect(nextStage('contacted')).toBe('qualified');
    expect(nextStage('qualified')).toBe('proposal');
    expect(nextStage('proposal')).toBe('won');
  });

  it('returns null for terminal stages', () => {
    expect(nextStage('won')).toBeNull();
    expect(nextStage('lost')).toBeNull();
  });

  it('returns null for unknown or missing stages', () => {
    expect(nextStage('spam')).toBeNull();
    expect(nextStage(null)).toBeNull();
    expect(nextStage(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// priorityColor
// ---------------------------------------------------------------------------

describe('priorityColor', () => {
  it('maps each known priority to its badge classes', () => {
    expect(priorityColor('low')).toBe('bg-gray-500/20 text-gray-400');
    expect(priorityColor('medium')).toBe('bg-blue-500/20 text-blue-400');
    expect(priorityColor('high')).toBe('bg-yellow-500/20 text-yellow-400');
    expect(priorityColor('urgent')).toBe('bg-red-500/20 text-red-400');
  });

  it('falls back to gray for unknown or missing priorities', () => {
    expect(priorityColor('critical')).toBe('bg-gray-500/20 text-gray-400');
    expect(priorityColor(null)).toBe('bg-gray-500/20 text-gray-400');
    expect(priorityColor(undefined)).toBe('bg-gray-500/20 text-gray-400');
  });
});

// ---------------------------------------------------------------------------
// seoFilter
// ---------------------------------------------------------------------------

describe('seoFilter', () => {
  const tasks = [
    makeTask({ id: '1', title: 'todo-a', status: 'todo', is_done: false }),
    makeTask({ id: '2', title: 'doing-b', status: 'in_progress', is_done: false }),
    makeTask({ id: '3', title: 'blocked-c', status: 'blocked', is_done: false }),
    makeTask({ id: '4', title: 'done-d', status: 'done', is_done: true }),
    makeTask({ id: '5', title: 'done-e', status: 'done', is_done: false }),
  ];

  it('returns everything (and empty) for the all filter', () => {
    expect(seoFilter(tasks, 'all')).toHaveLength(5);
    expect(seoFilter([], 'all')).toEqual([]);
    expect(seoFilter(null, 'all')).toEqual([]);
    expect(seoFilter(undefined, 'all')).toEqual([]);
  });

  it('filters by status', () => {
    expect(seoFilter(tasks, 'todo')).toEqual([tasks[0]]);
    expect(seoFilter(tasks, 'in_progress')).toEqual([tasks[1]]);
    expect(seoFilter(tasks, 'blocked')).toEqual([tasks[2]]);
  });

  it('matches done via is_done or status', () => {
    const done = seoFilter(tasks, 'done').map((t) => t.id);
    expect(done).toContain('4');
    expect(done).toContain('5');
    expect(done).toHaveLength(2);
  });
});

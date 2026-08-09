import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepairCrew } from '../src/lib/draymond/repair-team';

vi.mock('../src/lib/ide/opencode-client', () => ({
  runOpencodeCodegen: vi.fn(),
}));
vi.mock('../src/lib/uplift', () => ({
  pingUplift: vi.fn(),
  dispatchTask: vi.fn(),
}));
vi.mock('../src/lib/draymond/scheduler', () => ({
  updateJob: vi.fn(async () => ({})),
}));

import {
  dispatchCodingRepair,
  deterministicRepairPlan,
} from '../src/lib/draymond/coding-repair';
import { runOpencodeCodegen } from '../src/lib/ide/opencode-client';
import { pingUplift, dispatchTask } from '../src/lib/uplift';
import { updateJob } from '../src/lib/draymond/scheduler';

const job = { id: 'a', name: 'Evening Marketing Prep', job_type: 'custom', job_config: {} };
const crew: RepairCrew = { lead: 'opencode', members: ['big-homie'], reason: 'master coding stack' };

afterEach(() => {
  vi.clearAllMocks();
});

describe('coding repair dispatch', () => {
  it('produces a fixed, actionable deterministic plan', () => {
    const plan = deterministicRepairPlan(job, 'boom', crew);
    expect(plan).toContain('Evening Marketing Prep');
    expect(plan).toContain('opencode');
    expect(plan).toContain('boom');
  });

  it('applies a job_config patch returned by opencode', async () => {
    vi.mocked(runOpencodeCodegen).mockResolvedValue({
      success: true,
      content: '```json\n{"handler":"scan_book_library"}\n```',
      duration_ms: 5,
      model: 'opencode',
    });
    const out = await dispatchCodingRepair(job, 'boom', [], crew);
    expect(out.action).toBe('fixed');
    expect(out.dispatch.engine).toBe('opencode');
    expect(updateJob).toHaveBeenCalledWith('a', { job_config: { handler: 'scan_book_library' } });
  });

  it('hands a fix proposal off without applying when opencode returns non-config text', async () => {
    vi.mocked(runOpencodeCodegen).mockResolvedValue({
      success: true,
      content: 'check the API key for this provider',
      duration_ms: 5,
      model: 'opencode',
    });
    const out = await dispatchCodingRepair(job, 'boom', [], crew);
    expect(out.action).toBe('handed-off');
    expect(out.dispatch.engine).toBe('opencode');
    expect(updateJob).not.toHaveBeenCalled();
  });

  it('does not auto-apply a config patch that does not overlap the current job_config', async () => {
    const jobWithConfig = { ...job, job_config: { chain: 'marketing-pulse' } };
    vi.mocked(runOpencodeCodegen).mockResolvedValue({
      success: true,
      content: '```json\n{"type":"sms"}\n```',
      duration_ms: 5,
      model: 'opencode',
    });
    const out = await dispatchCodingRepair(jobWithConfig, 'boom', [], crew);
    expect(out.action).toBe('handed-off');
    expect(updateJob).not.toHaveBeenCalled();
    expect(out.detail).toContain('overlap');
  });

  it('hands off to uplift-agent when opencode returns nothing usable', async () => {
    vi.mocked(runOpencodeCodegen).mockResolvedValue({
      success: false,
      content: '',
      error: 'opencode returned no text',
      duration_ms: 5,
    });
    vi.mocked(pingUplift).mockResolvedValue(true);
    vi.mocked(dispatchTask).mockResolvedValue({ task_id: 't_123' });

    const out = await dispatchCodingRepair(job, 'boom', [], crew);
    expect(out.action).toBe('handed-off');
    expect(out.dispatch.engine).toBe('uplift-agent');
    expect(dispatchTask).toHaveBeenCalled();
  });

  it('degrades to a deterministic plan when both engines are unavailable', async () => {
    vi.mocked(runOpencodeCodegen).mockResolvedValue({
      success: false,
      content: '',
      error: 'connection refused',
      duration_ms: 5,
    });
    vi.mocked(pingUplift).mockResolvedValue(false);

    const out = await dispatchCodingRepair(job, 'boom', [], crew);
    expect(out.action).toBe('escalated');
    expect(out.dispatch.engine).toBe('deterministic');
    expect(out.dispatch.result).toContain('Evening Marketing Prep');
  });

  it('never throws even when both codegen engines reject', async () => {
    vi.mocked(runOpencodeCodegen).mockRejectedValue(new Error('server down'));
    vi.mocked(pingUplift).mockRejectedValue(new Error('unreachable'));

    const out = await dispatchCodingRepair(job, 'boom', [], crew);
    expect(out.action).toBe('escalated');
    expect(out.dispatch.engine).toBe('deterministic');
  });
});

import { describe, expect, it } from 'vitest';
import { repairFailedJob } from './repair-team';

describe('repairFailedJob deterministic brain fallback', () => {
  it('escalates chain token failures to the deterministic brain instead of generic env repair', async () => {
    const report = await repairFailedJob(
      {
        id: 'chain-briefing-1',
        name: 'morning-briefing',
        job_type: 'chain',
        job_config: {
          trigger_type: 'schedule',
          topic: 'AI strategy',
        },
      },
      'Missing API key: OPENCODE_API_KEY is not set',
      { updateJobConfig: async () => ({ ok: true }) },
      [],
      {}
    );

    expect(report.detail.toLowerCase()).toContain('deterministic brain');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '@/lib/db/connection';
import { dispatchWorkerTasks } from '@/lib/draymond/worker-tasks';

describe('dispatchWorkerTasks', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM draymond_worker_tasks').run();
  });

  it('enqueues tasks for each item in job_config', async () => {
    const config = {
      tasks: [
        { skill_pack_id: 'social_post:1.0.0', payload: { platform: 'x' } },
        { skill_pack_id: 'lead_pulse:2.0.0', payload: {} },
      ],
    };
    const result = await dispatchWorkerTasks(config);
    expect(result.enqueued).toBe(2);
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as n FROM draymond_worker_tasks').get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('returns zero when config has no tasks', async () => {
    const result = await dispatchWorkerTasks({});
    expect(result.enqueued).toBe(0);
  });

  it('rejects a non-array config.tasks', async () => {
    await expect(dispatchWorkerTasks({ tasks: 'x' as never })).rejects.toThrow(/array/);
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as n FROM draymond_worker_tasks').get() as { n: number };
    expect(count.n).toBe(0);
  });
});

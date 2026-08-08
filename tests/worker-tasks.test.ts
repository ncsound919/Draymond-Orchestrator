import { describe, it, expect, beforeEach } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '@/lib/db/connection';
import { enqueueWorkerTask, pullDueTasks, claimTask, reportTask } from '@/lib/draymond/worker-tasks';

describe('worker-tasks', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM draymond_worker_tasks').run();
  });

  it('enqueues and pulls due tasks for a worker', async () => {
    const id = await enqueueWorkerTask({
      skill_pack_id: 'social_post:1.0.0',
      payload: { platform: 'x', topic: 'launch' },
    });
    const tasks = await pullDueTasks('worker-1');
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(id);
    expect(tasks[0].status).toBe('queued');
  });

  it('claims a task and reports completion', async () => {
    const id = await enqueueWorkerTask({ skill_pack_id: 'lead_pulse:2.0.0' });
    const claimed = await claimTask(id, 'worker-1');
    expect(claimed).toBe(true);
    await reportTask(id, { ok: true }, ['screenshot://a.png']);
    const db = getDb();
    const row = db.prepare('SELECT * FROM draymond_worker_tasks WHERE id = ?').get(id) as {
      status: string; result: string; artifact_refs: string;
    };
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.result).ok).toBe(true);
    expect(JSON.parse(row.artifact_refs).length).toBe(1);
  });
});

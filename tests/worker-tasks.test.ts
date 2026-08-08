import { describe, it, expect, beforeEach } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '@/lib/db/connection';
import {
  enqueueWorkerTask,
  pullDueTasks,
  claimTask,
  reportTask,
  getWorkerTask,
} from '@/lib/draymond/worker-tasks';

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

  it('pulls only due tasks, oldest first', async () => {
    const db = getDb();
    const iso = (msOffset: number) => new Date(Date.now() + msOffset).toISOString();
    const insert = (id: string, dueAt: string | null, createdOffset: number) =>
      db
        .prepare(
          "INSERT INTO draymond_worker_tasks (id, payload, status, due_at, created_at) VALUES (?, '{}', 'queued', ?, ?)"
        )
        .run(id, dueAt, iso(createdOffset));
    insert('future', iso(3600_000), 3000);
    insert('past', iso(-3600_000), 1000);
    insert('nodue', null, 2000);
    const tasks = await pullDueTasks('worker-1');
    expect(tasks.map((t) => t.id)).toEqual(['past', 'nodue']);
  });

  it('scopes pulls to unassigned tasks plus the worker\u2019s own', async () => {
    const db = getDb();
    const insert = (id: string, workerId: string | null) =>
      db
        .prepare(
          "INSERT INTO draymond_worker_tasks (id, worker_id, payload, status, created_at) VALUES (?, ?, '{}', 'queued', ?)"
        )
        .run(id, workerId, new Date().toISOString());
    insert('mine', 'worker-1');
    insert('theirs', 'worker-2');
    insert('open', null);
    const w1 = await pullDueTasks('worker-1');
    expect(w1.map((t) => t.id).sort()).toEqual(['mine', 'open']);
    const w2 = await pullDueTasks('worker-2');
    expect(w2.map((t) => t.id).sort()).toEqual(['open', 'theirs']);
  });

  it('refuses to claim an already-claimed or missing task', async () => {
    const id = await enqueueWorkerTask({ skill_pack_id: 'social_post:1.0.0' });
    expect(await claimTask(id, 'worker-1')).toBe(true);
    expect(await claimTask(id, 'worker-2')).toBe(false);
    expect(await claimTask('no-such-task', 'worker-1')).toBe(false);
  });

  it('refuses to report a task that is still queued', async () => {
    const id = await enqueueWorkerTask({ skill_pack_id: 'social_post:1.0.0' });
    expect(await reportTask(id, { ok: true })).toBe(false);
    const db = getDb();
    const row = db.prepare('SELECT status FROM draymond_worker_tasks WHERE id = ?').get(id) as {
      status: string;
    };
    expect(row.status).toBe('queued');
  });

  it('refuses a report from a different worker', async () => {
    const id = await enqueueWorkerTask({ skill_pack_id: 'social_post:1.0.0' });
    expect(await claimTask(id, 'worker-1')).toBe(true);
    expect(await reportTask(id, { ok: true }, undefined, undefined, 'worker-2')).toBe(false);
    const db = getDb();
    const row = db.prepare('SELECT status, worker_id FROM draymond_worker_tasks WHERE id = ?').get(id) as {
      status: string; worker_id: string;
    };
    expect(row.status).toBe('claimed');
    expect(row.worker_id).toBe('worker-1');
  });

  it('marks a task failed when reporting an error', async () => {
    const id = await enqueueWorkerTask({ skill_pack_id: 'social_post:1.0.0' });
    expect(await claimTask(id, 'worker-1')).toBe(true);
    expect(await reportTask(id, {}, undefined, 'boom')).toBe(true);
    const db = getDb();
    const row = db.prepare('SELECT status, error FROM draymond_worker_tasks WHERE id = ?').get(id) as {
      status: string; error: string;
    };
    expect(row.status).toBe('failed');
    expect(row.error).toBe('boom');
  });

  it('respects the pull limit', async () => {
    for (let i = 0; i < 3; i++) await enqueueWorkerTask({ payload: { i } });
    const tasks = await pullDueTasks('worker-1', 2);
    expect(tasks.length).toBe(2);
  });

  it('returns null for a missing task', async () => {
    expect(await getWorkerTask('no-such-task')).toBeNull();
  });
});

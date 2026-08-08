import { describe, it, expect, beforeEach } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '@/lib/db/connection';
import { createDraymondAdminClient } from '@/lib/draymond/client';
import { ingestWorkerReportEmail } from '@/lib/draymond/notifications';

describe('ingestWorkerReportEmail', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM draymond_worker_tasks').run();
  });

  it('parses task id from subject and marks the claimed task completed', async () => {
    const admin = createDraymondAdminClient();
    const { data: inserted } = await admin
      .from('draymond_worker_tasks')
      .insert({
        worker_id: 'worker-1',
        skill_pack_id: 'social_post:1.0.0',
        payload: { platform: 'x' },
        status: 'claimed',
      })
      .select()
      .single();
    const taskId = (inserted as { id: string }).id;

    const out = await ingestWorkerReportEmail(
      `[OpenChat: ${taskId}] Marketing done`,
      'Summary of work',
      ['https://x/shot.png']
    );
    expect(out.ok).toBe(true);
    expect(out.task_id).toBe(taskId);

    const db = getDb();
    const row = db
      .prepare(
        'SELECT status, result, artifact_refs, completed_at FROM draymond_worker_tasks WHERE id = ?'
      )
      .get(taskId) as {
      status: string;
      result: string;
      artifact_refs: string;
      completed_at: string | null;
    };
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.result).summary).toBe('Summary of work');
    expect(JSON.parse(row.artifact_refs)).toEqual(['https://x/shot.png']);
    expect(row.completed_at).toBeTruthy();
  });

  it('does not overwrite an already-completed task with a re-delivered email', async () => {
    const admin = createDraymondAdminClient();
    const { data: inserted } = await admin
      .from('draymond_worker_tasks')
      .insert({
        worker_id: 'worker-1',
        skill_pack_id: 'social_post:1.0.0',
        payload: { platform: 'x' },
        status: 'completed',
        result: { summary: 'original' },
        artifact_refs: [],
      })
      .select()
      .single();
    const taskId = (inserted as { id: string }).id;

    const out = await ingestWorkerReportEmail(
      `[OpenChat: ${taskId}] Marketing done`,
      'redo summary',
      ['https://x/shot.png']
    );
    expect(out.ok).toBe(false);

    const db = getDb();
    const row = db
      .prepare('SELECT status, result, artifact_refs FROM draymond_worker_tasks WHERE id = ?')
      .get(taskId) as { status: string; result: string; artifact_refs: string };
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.result).summary).toBe('original');
    expect(JSON.parse(row.artifact_refs)).toEqual([]);
  });

  it('returns ok:false when task id missing from subject', async () => {
    const out = await ingestWorkerReportEmail('No id here', 'body', []);
    expect(out.ok).toBe(false);
  });
});

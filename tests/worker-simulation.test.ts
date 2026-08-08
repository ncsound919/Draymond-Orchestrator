import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

// Isolate the self-learning file store to a temp dir for the test.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-worker-sim-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

import { getDb } from '@/lib/db/connection';
import {
  enqueueWorkerTask,
  claimTask,
  reportTask,
  getWorkerTask,
} from '@/lib/draymond/worker-tasks';
import { recordOutcome } from '@/lib/draymond/self-learning';

describe('worker simulation (offline end-to-end)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM draymond_worker_tasks').run();
    fs.rmSync(path.join(tmp, 'learning-outcomes.json'), { force: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runs enqueue → claim → execute → report and records a lesson outcome', async () => {
    const id = await enqueueWorkerTask({
      skill_pack_id: 'marketing_draft:1.0.0',
      payload: { platform: 'x', topic: 'launch' },
    });
    expect(await claimTask(id, 'worker-1')).toBe(true);
    // simulate phone execution (draft assembled from context)
    await reportTask(id, { ok: true, draft: 'Launch post' }, ['uri://screenshot.png']);
    const task = await getWorkerTask(id);
    expect(task?.status).toBe('completed');
    expect(task?.result.draft).toBe('Launch post');

    const out = await recordOutcome({
      agentId: 'worker-1',
      kind: 'job',
      summary: 'marketing draft task completed',
      success: true,
      detail: 'posted ok',
    });
    expect(out?.summary).toBe('marketing draft task completed');
    expect(out?.agentId).toBe('worker-1');
  });
});

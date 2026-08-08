import { describe, it, expect, beforeEach } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '@/lib/db/connection';
import { upsertSkillPack } from '@/lib/draymond/skill-packs';
import { POST as postTasks, GET as getTasks } from '@/app/api/v1/worker/tasks/route';
import { POST as postClaim } from '@/app/api/v1/worker/tasks/[id]/claim/route';
import { POST as postReport } from '@/app/api/v1/worker/tasks/[id]/report/route';
import { GET as getSkills, POST as postPropose } from '@/app/api/v1/worker/skills/route';
import { GET as getSkill } from '@/app/api/v1/worker/skills/[id]/route';
import { POST as postHeartbeat } from '@/app/api/v1/worker/heartbeat/route';
import { GET as getBriefing } from '@/app/api/v1/worker/briefing/route';

function req(body: unknown, path = 'http://localhost/api/v1/worker/tasks') {
  return new Request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
    body: JSON.stringify(body),
  });
}

describe('worker routes', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    const db = getDb();
    db.prepare('DELETE FROM draymond_worker_tasks').run();
    db.prepare('DELETE FROM draymond_skill_packs').run();
    db.prepare('DELETE FROM draymond_worker_proposals').run();
    db.prepare('DELETE FROM draymond_messages').run();
  });

  it('enqueues and pulls tasks through the API', async () => {
    const enq = await postTasks(req({ skill_pack_id: 'social_post:1.0.0', payload: { platform: 'x' } }));
    const enqData = await enq.json();
    expect(enqData.ok).toBe(true);

    const getReq = new Request('http://localhost/api/v1/worker/tasks?worker_id=worker-1&status=queued', {
      headers: { Authorization: `Bearer test-secret` },
    });
    const res = await getTasks(getReq);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tasks.length).toBe(1);
  });

  it('claims and reports a task', async () => {
    const enq = await postTasks(req({ skill_pack_id: 'lead_pulse:2.0.0' }));
    const { id } = await enq.json();
    const claim = await postClaim(req({ worker_id: 'worker-1' }, `http://localhost/api/v1/worker/tasks/${id}/claim`), { params: Promise.resolve({ id }) });
    expect((await claim.json()).ok).toBe(true);
    const report = await postReport(req({ result: { ok: true }, worker_id: 'worker-1' }, `http://localhost/api/v1/worker/tasks/${id}/report`), { params: Promise.resolve({ id }) });
    expect((await report.json()).ok).toBe(true);
  });

  it('lists skills, accepts proposals, and fetches a pack by name:version', async () => {
    const list = await getSkills(new Request('http://localhost/api/v1/worker/skills', { headers: { Authorization: 'Bearer test-secret' } }));
    expect((await list.json()).ok).toBe(true);

    const propose = await postPropose(req({ pack: { name: 'new_skill', version: '0.1.0' }, worker_id: 'worker-1' }, 'http://localhost/api/v1/worker/skills'));
    expect((await propose.json()).ok).toBe(true);

    await upsertSkillPack({ name: 'new_skill', version: '0.1.0', purpose: 'Test pack' });
    const pack = await getSkill(new Request('http://localhost/api/v1/worker/skills/new_skill:0.1.0', { headers: { Authorization: 'Bearer test-secret' } }), { params: Promise.resolve({ id: 'new_skill:0.1.0' }) });
    const packData = await pack.json();
    expect(packData.ok).toBe(true);
    expect(packData.skill.name).toBe('new_skill');
    expect(packData.skill.version).toBe('0.1.0');
  });

  it('accepts heartbeat and briefing', async () => {
    const hb = await postHeartbeat(req({ client_id: 'worker-1', platform: 'open-chat' }, 'http://localhost/api/v1/worker/heartbeat'));
    expect((await hb.json()).ok).toBe(true);

    const briefing = await getBriefing(new Request('http://localhost/api/v1/worker/briefing?worker_id=worker-1', { headers: { Authorization: 'Bearer test-secret' } }));
    const briefData = await briefing.json();
    expect(briefData.ok).toBe(true);
    expect(briefData.worker_id).toBe('worker-1');
    expect(Array.isArray(briefData.tasks)).toBe(true);
  });
});

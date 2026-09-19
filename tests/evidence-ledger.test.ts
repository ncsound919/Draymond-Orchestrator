import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// The ledger resolves its dir from the env at call time, so top-level import is
// safe; the temp dir is still set before each test so no real .draymond is hit.
let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `el-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Imported after env wiring is guaranteed but before any call.
const { recordEvidence, readLedger, settleRecord, supersedeRecord, getRecord, listRecords, sweepLedger } =
  await import('@/lib/draymond/evidence-ledger');

function strong() {
  return {
    refId: 'lo_1',
    subject: 'agent x recovers after restart',
    evidence: [{ kind: 'log.observed' as const, detail: 'post-restart health check green' }],
  };
}

function weak() {
  return {
    refId: 'lo_2',
    subject: 'agent x is slower at night',
    evidence: [{ kind: 'inference' as const, detail: 'model speculation' }],
  };
}

describe('evidence-ledger', () => {
  it('returns an empty ledger on first read', async () => {
    const ledger = await readLedger();
    expect(ledger.records).toEqual([]);
  });

  it('round-trips a strong (verified) conclusion', async () => {
    await recordEvidence(strong(), { recordedBy: 'repair-team', refKind: 'outcome' });
    const record = await getRecord('lo_1');
    expect(record?.status).toBe('verified');
    expect(record?.band).toBe('verified');
    expect(record?.recordedBy).toBe('repair-team');
    expect(record?.evidence).toHaveLength(1);
  });

  it('stores a weak conclusion as a proposal, not silently discarded or forced', async () => {
    const rec = await recordEvidence(weak(), { recordedBy: 'kairos' });
    expect(rec.status).toBe('proposed');
  });

  it('human accept settles a proposal to verified; reject settles to superseded', async () => {
    await recordEvidence(weak(), { recordedBy: 'kairos' });
    const accepted = await settleRecord('lo_2', { accepted: true, by: 'operator', note: 'confirmed' });
    expect(accepted?.status).toBe('verified');
    expect(accepted?.settledBy).toBe('operator');

    await recordEvidence({ refId: 'lo_3', subject: 'noise', evidence: [{ kind: 'inference', detail: 'g' }] }, { recordedBy: 'k' });
    const rejected = await settleRecord('lo_3', { accepted: false, by: 'operator' });
    expect(rejected?.status).toBe('superseded');
    await expect(getRecord('lo_3')).resolves.toBeUndefined();
  });

  it('only lets an active proposal be settled', async () => {
    await recordEvidence(strong(), { recordedBy: 'a' });
    const settled = await settleRecord('lo_1', { accepted: false, by: 'operator' });
    expect(settled).toBeNull();
    expect((await getRecord('lo_1'))?.status).toBe('verified');
  });

  it('re-recording the same refId replaces, not stacks', async () => {
    await recordEvidence(weak(), { recordedBy: 'a' });
    await recordEvidence(weak(), { recordedBy: 'b' });
    const all = await readLedger();
    expect(all.records.filter((r) => r.refId === 'lo_2')).toHaveLength(1);
    expect((await getRecord('lo_2'))?.recordedBy).toBe('b');
  });

  it('supersedes and filters by status and refKind', async () => {
    await recordEvidence(weak(), { recordedBy: 'a', refKind: 'outcome' });
    await recordEvidence({ refId: 'ls_9', subject: 'lesson', evidence: [{ kind: 'inference', detail: 'x' }] }, { recordedBy: 'a', refKind: 'lesson' });

    expect(await listRecords({ status: 'proposed' })).toHaveLength(2);
    expect(await listRecords({ refKind: 'lesson' })).toHaveLength(1);

    await supersedeRecord('ls_9', 'sweep');
    expect((await getRecord('ls_9'))).toBeUndefined();
    expect(await listRecords({ status: 'proposed' })).toHaveLength(1);
  });

  it('sweep prunes old proposals but keeps verified and recent ones', async () => {
    await recordEvidence(weak(), { recordedBy: 'a' }); // lo_2 proposed
    await recordEvidence(strong(), { recordedBy: 'a' }); // lo_1 verified
    // Rewind the proposal timestamp into the past.
    const file = path.join(tmpDir, 'evidence-ledger.json');
    const ledger = JSON.parse(await fs.readFile(file, 'utf-8'));
    for (const r of ledger.records) if (r.status === 'proposed') r.updatedAt = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    await fs.writeFile(file, JSON.stringify(ledger, null, 2), 'utf-8');

    const summary = await sweepLedger({ olderThanMs: 30 * 24 * 3600 * 1000 });
    expect(summary.pruned).toBeGreaterThanOrEqual(1);
    expect((await getRecord('lo_1'))?.status).toBe('verified');
    expect((await getRecord('lo_2'))).toBeUndefined();
  });
});

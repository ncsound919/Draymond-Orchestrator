import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// UPLIFT_ROOT is captured at module load, so set it before importing the
// modules under test.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uplift-repair-root-'));
const projectDir = path.join(tmpRoot, 'proj');
fs.mkdirSync(projectDir, { recursive: true });
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uplift-outside-'));

process.env.UPLIFT_ROOT = tmpRoot;
process.env.DRAYMOND_REPAIR_PROJECT_LOOP = '1';

const { resolveRepairTargetDir } = await import('../src/lib/draymond/repair-targets');
const { dispatchProjectRepair, recourseGroundingBlock } = await import('../src/lib/draymond/repair-crew');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('resolveRepairTargetDir', () => {
  it('resolves an explicit job_config path inside UPLIFT_ROOT', () => {
    const r = resolveRepairTargetDir({ name: 'Job', job_config: { targetDir: projectDir } });
    expect(r).toEqual({ targetDir: projectDir, source: 'job_config.targetDir' });
  });

  it('refuses a path outside UPLIFT_ROOT (containment)', () => {
    const r = resolveRepairTargetDir({ name: 'Job', job_config: { targetDir: outsideDir } });
    expect(r).toBeNull();
  });

  it('returns null when nothing maps', () => {
    const r = resolveRepairTargetDir({ name: 'zzzz-unmapped', job_config: {} });
    expect(r).toBeNull();
  });
});

describe('dispatchProjectRepair', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals?.();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns null when the job has no resolvable workspace', async () => {
    const out = await dispatchProjectRepair({ job: { id: 'j1', name: 'zzzz', job_config: {} }, error: 'boom', lessons: [] });
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches a grounded Axiom project loop and reports the loop id', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/recourse/bridge/exemplars')) return Promise.resolve(jsonOk({ count: 1, block: 'PRIOR ART' }));
      if (u.includes('/api/recourse/bridge/context')) return Promise.resolve(jsonOk({ context: 'LESSON' }));
      if (u.includes('/api/recourse/bridge/repair')) return Promise.resolve(jsonOk({ id: 'proj_1', maxIterations: 4 }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    const out = await dispatchProjectRepair({
      job: { id: 'j2', name: 'Nightly Build', job_config: { targetDir: projectDir } },
      error: 'typecheck failed',
      lessons: ['pin the dependency'],
    });

    expect(out?.action).toBe('handed-off');
    expect(out?.dispatch.kind).toBe('axiom-project-loop');
    expect(out?.dispatch.result).toBe('proj_1');
    const repairCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/bridge/repair'));
    expect(repairCall).toBeTruthy();
    const body = JSON.parse(String((repairCall![1] as RequestInit).body));
    expect(body.targetDir).toBe(projectDir);
    expect(body.goal).toContain('PRIOR ART');
  });

  it('escalates honestly when Axiom rejects the loop', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/bridge/exemplars') || u.includes('/bridge/context')) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(new Response('{"error":"workspace not allowed"}', { status: 403 }));
    });
    const out = await dispatchProjectRepair({
      job: { id: 'j3', name: 'Nightly Build', job_config: { targetDir: projectDir } },
      error: 'boom',
      lessons: [],
    });
    expect(out?.action).toBe('escalated');
    expect(out?.dispatch.result).not.toBe('proj_1');
  });
});

describe('recourseGroundingBlock', () => {
  beforeEach(() => fetchMock.mockReset());

  it('combines exemplars and context, and stays empty when offline', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/bridge/exemplars')) return Promise.resolve(jsonOk({ count: 2, block: 'BLOCK' }));
      if (u.includes('/bridge/context')) return Promise.resolve(jsonOk({ context: 'CTX' }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    const block = await recourseGroundingBlock('repair X');
    expect(block).toContain('BLOCK');
    expect(block).toContain('CTX');

    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 503 })));
    expect(await recourseGroundingBlock('repair Y')).toBe('');
  });
});

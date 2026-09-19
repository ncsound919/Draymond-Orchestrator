import { afterEach, describe, expect, it, vi } from 'vitest';

const callLLMMock = vi.fn();

vi.mock('../src/lib/draymond/llm', () => ({
  callLLM: (...args: unknown[]) => callLLMMock(...args),
}));

async function loadModule(localFirst: '0' | '1') {
  process.env.DRAYMOND_REPAIR_LOCAL_FIRST = localFirst;
  vi.resetModules();
  return import('../src/lib/draymond/local-repair');
}

afterEach(() => {
  callLLMMock.mockReset();
  delete process.env.DRAYMOND_REPAIR_LOCAL_FIRST;
});

describe('localFailureTriage', () => {
  it('refines the classification from a local-model JSON verdict', async () => {
    callLLMMock.mockResolvedValue('{"kind":"service_down","confidence":0.9,"rationale":"connection refused"}');
    const mod = await loadModule('1');
    const r = await mod.localFailureTriage({
      jobName: 'Nightly',
      jobType: 'chain',
      error: 'boom',
      deterministicKind: 'unknown',
    });
    expect(r.source).toBe('local-model');
    expect(r.kind).toBe('service_down');
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it('falls back to the deterministic kind when the model is disabled', async () => {
    const mod = await loadModule('0');
    const r = await mod.localFailureTriage({
      jobName: 'Nightly',
      jobType: 'chain',
      error: 'boom',
      deterministicKind: 'code_error',
    });
    expect(r.source).toBe('deterministic');
    expect(r.kind).toBe('code_error');
    expect(callLLMMock).not.toHaveBeenCalled();
  });

  it('ignores an invalid kind from the model', async () => {
    callLLMMock.mockResolvedValue('{"kind":"nonsense","confidence":0.99,"rationale":"x"}');
    const mod = await loadModule('1');
    const r = await mod.localFailureTriage({
      jobName: 'N',
      jobType: 'chain',
      error: 'e',
      deterministicKind: 'unknown',
    });
    expect(r.kind).toBe('unknown');
  });
});

describe('localJobConfigProposal', () => {
  it('returns the model reply when it proposes a config', async () => {
    callLLMMock.mockResolvedValue('{"handler":"scan_book_library"}');
    const mod = await loadModule('1');
    const r = await mod.localJobConfigProposal({
      jobName: 'N',
      jobType: 'job',
      error: 'missing handler',
      jobConfig: {},
    });
    expect(r?.content).toContain('scan_book_library');
  });

  it('returns null when the model declines with NO_CONFIG_FIX', async () => {
    callLLMMock.mockResolvedValue('NO_CONFIG_FIX');
    const mod = await loadModule('1');
    const r = await mod.localJobConfigProposal({ jobName: 'N', jobType: 'job', error: 'e', jobConfig: {} });
    expect(r).toBeNull();
  });

  it('returns null when local is disabled', async () => {
    const mod = await loadModule('0');
    const r = await mod.localJobConfigProposal({ jobName: 'N', jobType: 'job', error: 'e', jobConfig: {} });
    expect(r).toBeNull();
    expect(callLLMMock).not.toHaveBeenCalled();
  });
});

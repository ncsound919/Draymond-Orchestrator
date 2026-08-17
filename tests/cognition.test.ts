import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-cognition-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

vi.mock('../src/lib/draymond/scheduler', () => ({ listJobs: vi.fn(async () => []) }));
vi.mock('../src/lib/draymond/chains', () => ({ listChains: vi.fn(async () => []) }));
vi.mock('../src/lib/draymond/llm', () => ({
  callLLM: vi.fn(async () => ''),
  hasKey: vi.fn(() => false),
}));

import {
  readJsonState,
  writeJsonState,
  nowIso,
  uid,
  isSystemIdle,
  hasNativeReasoning,
  callDeepLLM,
  deepenLoop,
  parseArtifact,
  type UltraplanArtifact,
} from '../src/lib/draymond/cognition';
import { callLLM, hasKey } from '../src/lib/draymond/llm';

const mockCallLLM = vi.mocked(callLLM);
const mockHasKey = vi.mocked(hasKey);

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  mockCallLLM.mockClear();
  mockHasKey.mockClear();
  vi.useRealTimers();
});

describe('cognition base', () => {
  it('round-trips JSON state and stamps updatedAt on write', async () => {
    await writeJsonState('test-state', { moments: [{ id: 'm1' }] });
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'test-state.json'), 'utf-8'));
    expect(raw.moments).toEqual([{ id: 'm1' }]);
    expect(typeof raw.updatedAt).toBe('string');
    const read = await readJsonState<{ moments: unknown[] }>('test-state', { moments: [] });
    expect(read.moments).toHaveLength(1);
    expect(await readJsonState('missing-file', { fallback: true })).toEqual({ fallback: true });
  });

  it('generates prefixed ids and iso timestamps', () => {
    expect(uid('km')).toMatch(/^km_\d+_/);
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('isSystemIdle returns false during the morning burst even with no running jobs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 9, 7, 30));
    expect(await isSystemIdle()).toBe(false);
    vi.setSystemTime(new Date(2026, 7, 9, 12, 0));
    expect(await isSystemIdle()).toBe(true);
  });

  it('isSystemIdle returns false when a job or chain is running', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 9, 12, 0)); // outside the morning burst
    const { listJobs } = await import('../src/lib/draymond/scheduler');
    const { listChains } = await import('../src/lib/draymond/chains');
    vi.mocked(listJobs).mockResolvedValueOnce([{ id: 'j1' } as never]);
    expect(await isSystemIdle()).toBe(false);
    vi.mocked(listJobs).mockResolvedValueOnce([]);
    vi.mocked(listChains).mockResolvedValueOnce([{ id: 'c1' } as never]);
    expect(await isSystemIdle()).toBe(false);
  });

  it('hasNativeReasoning is true when a reasoning-capable provider key is set', () => {
    mockHasKey.mockImplementation(() => false);
    expect(hasNativeReasoning()).toBe(false);
    mockHasKey.mockImplementation((p: string) => p === 'deepseek');
    expect(hasNativeReasoning()).toBe(true);
  });

  it('callDeepLLM passes reasoning, long timeout and json response format', async () => {
    mockHasKey.mockImplementation((p: string) => p === 'anthropic');
    mockCallLLM.mockResolvedValueOnce('plan text');
    const out = await callDeepLLM({ system: 'sys', userMessage: 'brief' });
    expect(out).toBe('plan text');
    const arg = mockCallLLM.mock.calls[0][0];
    expect(arg).toMatchObject({
      provider: 'anthropic',
      reasoning: true,
      maxTokens: 4096,
      timeoutMs: 120_000,
      responseFormat: { type: 'json_object' },
    });
  });

  it('parseArtifact handles plain and fenced JSON and rejects garbage', () => {
    const good: UltraplanArtifact = {
      goals: ['g'], phases: ['p'], steps: ['s'],
      changes: [{ file: 'src/x.ts', description: 'd', line: '12' }],
      dependencies: [], risks: ['r'], verification: ['npm test'], tokenEstimate: 42,
    };
    expect(parseArtifact(JSON.stringify(good))).toEqual(good);
    const fenced = '```json\n' + JSON.stringify({ ...good, changes: [{ file: 'a.ts', description: 'b' }] }) + '\n```';
    expect(parseArtifact(fenced).changes[0]).toEqual({ file: 'a.ts', description: 'b', line: undefined });
    expect(() => parseArtifact('not json')).toThrow();
  });

  it('deepenLoop runs 3 rounds (draft, critique, revise) and returns a parseable plan', async () => {
    const bad = 'not a plan yet';
    mockCallLLM
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(JSON.stringify({ goals: ['g'], phases: [], steps: [], changes: [], dependencies: [], risks: [], verification: [], tokenEstimate: 1 }));
    const artifact = await deepenLoop({ system: 'sys', userMessage: 'brief' }, 3);
    expect(artifact.goals).toEqual(['g']);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
    // The iterative draft/critique/revise lane is cheap — it should hit the
    // local Ollama tier first via localFirst.
    expect(mockCallLLM.mock.calls[0][0]).toMatchObject({ localFirst: true });
  });

  it('deepenLoop throws when no round produces a parseable plan', async () => {
    mockCallLLM.mockResolvedValue('still not json');
    await expect(deepenLoop({ system: 'sys', userMessage: 'brief' }, 3)).rejects.toThrow();
  });

  it('readJsonState falls back when the file does not contain an object', async () => {
    fs.writeFileSync(path.join(tmp, 'not-an-object.json'), '42');
    expect(await readJsonState('not-an-object', { fallback: true })).toEqual({ fallback: true });
  });

  it('isSystemIdle fails open to idle when job/chain reads error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 9, 12, 0)); // outside the morning burst
    const { listJobs } = await import('../src/lib/draymond/scheduler');
    const { listChains } = await import('../src/lib/draymond/chains');
    vi.mocked(listJobs).mockRejectedValueOnce(new Error('db down'));
    vi.mocked(listChains).mockRejectedValueOnce(new Error('db down'));
    expect(await isSystemIdle()).toBe(true);
  });

  it('callDeepLLM routes with an undefined provider when no reasoning key is set', async () => {
    mockHasKey.mockImplementation(() => false);
    mockCallLLM.mockResolvedValueOnce('x');
    await callDeepLLM({ system: 's', userMessage: 'm' });
    expect(mockCallLLM.mock.calls[0][0].provider).toBeUndefined();
  });
});

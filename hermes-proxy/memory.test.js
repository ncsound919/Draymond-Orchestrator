import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendTurn, getContext } from './memory.js';

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-gw-'));
  process.env.HERMES_MEMORY_DIR = tmpDir;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.HERMES_MEMORY_DIR;
});

describe('memory JSONL', () => {
  it('appends a turn and reads it back', async () => {
    await appendTurn('s1', { role: 'user', content: 'hi' });
    await appendTurn('s1', { role: 'assistant', content: 'hello' });
    const ctx = await getContext('s1');
    expect(ctx.turns.map((t) => t.content)).toEqual(['hi', 'hello']);
  });

  it('isolates sessions', async () => {
    await appendTurn('a', { role: 'user', content: 'from a' });
    await appendTurn('b', { role: 'user', content: 'from b' });
    const ctxA = await getContext('a');
    expect(ctxA.turns.map((t) => t.content)).toEqual(['from a']);
  });

  it('returns empty context for unknown session', async () => {
    const ctx = await getContext('nope');
    expect(ctx.turns).toEqual([]);
    expect(ctx.summary).toBe('');
  });

  it('respects maxTurns limit', async () => {
    for (let i = 0; i < 6; i++) await appendTurn('s', { role: 'user', content: `m${i}` });
    const ctx = await getContext('s', { maxTurns: 3 });
    expect(ctx.turns.length).toBe(3);
  });
});

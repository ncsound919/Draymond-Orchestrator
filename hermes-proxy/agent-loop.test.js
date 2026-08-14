import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./deepseek-client.js', () => ({ complete: vi.fn() }));
const { complete } = vi.mocked(await import('./deepseek-client.js'));

import { runAgent } from './agent-loop.js';
import * as tools from './tools/index.js';
vi.mock('./tools/index.js', async () => {
  const actual = await import('./tools/index.js');
  return { ...actual, executeTool: vi.fn() };
});

describe('agent loop', () => {
  const executeTool = tools.executeTool;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns final content when no tool call is made', async () => {
    complete.mockResolvedValue({ content: 'Hello!', toolCalls: [] });
    const { text, usedTools } = await runAgent([{ role: 'user', content: 'hi' }], 's1');
    expect(text).toBe('Hello!');
    expect(usedTools).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('executes a tool and uses the result in the next LLM call', async () => {
    complete
      .mockResolvedValueOnce({ content: '', toolCalls: [{ name: 'get_time', arguments: '{}' }] })
      .mockResolvedValueOnce({ content: 'It is now.', toolCalls: [] });
    executeTool.mockResolvedValueOnce({ ok: true, now: '2026-01-01' });
    const { text, usedTools } = await runAgent([{ role: 'user', content: 'time' }], 's1');
    expect(text).toBe('It is now.');
    expect(usedTools).toEqual(['get_time']);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('caps at MAX_TOOL_ROUNDS and returns an interrupted note', async () => {
    complete.mockResolvedValue({ content: '', toolCalls: [{ name: 'get_time', arguments: '{}' }] });
    executeTool.mockResolvedValue({ ok: true, now: 'x' });
    const { text } = await runAgent([{ role: 'user', content: 'loop' }], 's1', { maxRounds: 2 });
    expect(text).toContain('interrupted');
  });

  it('lets the model recover from a tool error', async () => {
    complete
      .mockResolvedValueOnce({ content: '', toolCalls: [{ name: 'nope', arguments: '{}' }] })
      .mockResolvedValueOnce({ content: 'No such tool, sorry.', toolCalls: [] });
    executeTool.mockResolvedValueOnce({ ok: false, error: 'unknown tool: nope' });
    const { text } = await runAgent([{ role: 'user', content: 'x' }], 's1');
    expect(text).toBe('No such tool, sorry.');
  });
});

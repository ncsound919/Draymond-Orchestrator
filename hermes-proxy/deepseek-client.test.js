import { describe, it, expect, vi, afterEach } from 'vitest';
import { complete } from './deepseek-client.js';

describe('deepseek client', () => {
  const fetchMock = vi.fn();
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
    fetchMock.mockReset();
  });

  it('calls chat completions with the given messages and model', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await complete('deepseek-v4-flash', [{ role: 'user', content: 'hi' }], []);
    expect(result.content).toBe('hi');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('chat/completions');
    expect(JSON.parse(init.body).model).toBe('deepseek-v4-flash');
  });

  it('returns tool_calls when the model requests them', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    const toolCall = { id: 't1', function: { name: 'get_time', arguments: '{}' } };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await complete('deepseek-v4-flash', [{ role: 'user', content: 'time?' }], [
      { type: 'function', function: { name: 'get_time', description: 'now', parameters: {} } },
    ]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('get_time');
  });

  it('throws when upstream returns an error', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(complete('m', [], [])).rejects.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, resolveLLMProvider } from '../src/lib/draymond/llm';

describe('shared llm helper', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    fetchMock.mockReset();
  });

  it('resolves the preferred provider when its key is set', () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    process.env.ANTHROPIC_API_KEY = 'a';
    expect(resolveLLMProvider('deepseek')).toBe('deepseek');
  });

  it('falls back to the first configured provider when preferred is unconfigured', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    expect(resolveLLMProvider('deepseek')).toBe('anthropic');
  });

  it('throws when no provider has a key', () => {
    expect(() => resolveLLMProvider('deepseek')).toThrow(/No LLM API key/);
  });

  it('calls deepseek with Bearer auth, model, and system+user messages', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'routed' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await callLLM({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      system: 'sys',
      userMessage: 'hello',
      maxTokens: 128,
      temperature: 0.1,
      timeoutMs: 5000,
    });

    expect(text).toBe('routed');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.max_tokens).toBe(128);
    expect(body.messages[0]).toMatchObject({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('uses the Anthropic Messages API shape for the anthropic provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    delete process.env.DEEPSEEK_API_KEY;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'claude reply' }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await callLLM({
      provider: 'anthropic',
      system: 'sys',
      userMessage: 'hi',
    });

    expect(text).toBe('claude reply');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('ak');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('throws with the upstream status on error responses', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    fetchMock.mockResolvedValue(new Response('out of balance', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      callLLM({ provider: 'deepseek', system: 's', userMessage: 'u' }),
    ).rejects.toThrow(/402/);
  });
});

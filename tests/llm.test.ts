import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, resolveLLMProvider } from '../src/lib/draymond/llm';

describe('shared llm helper', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LITELLM_API_KEY;
    fetchMock.mockReset();
  });

  it('resolves the preferred provider when its key is set', () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    process.env.ANTHROPIC_API_KEY = 'a';
    expect(resolveLLMProvider('deepseek')).toBe('deepseek');
  });

  it('falls back to the first configured provider when preferred is unconfigured', () => {
    // ollama is always available (local tier); with ANTHROPIC also set,
    // the first in fallback order that has a key is ollama (local tier).
    process.env.ANTHROPIC_API_KEY = 'a';
    expect(resolveLLMProvider('deepseek')).toBe('ollama');
  });

  it('falls back to ollama even when no remote provider has a key', () => {
    // The local Ollama tier is always available, so the chain never throws
    // for missing keys — it resolves to the on-device model.
    expect(resolveLLMProvider('deepseek')).toBe('ollama');
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

  it('returns the deterministic fallback when every provider fails', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    fetchMock.mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const text = await callLLM({
      provider: 'deepseek',
      system: 's',
      userMessage: 'u',
      deterministicFallback: 'deterministic-plan',
    });
    expect(text).toBe('deterministic-plan');
  });

  it('prefers the local ollama tier when no remote provider key is set', () => {
    // The universal chain defaults to the free→go opencode tier, then deepseek,
    // gemini, and the always-available local ollama tier.
    expect(resolveLLMProvider()).toBe('ollama');
  });

  it('routes litellm to the OpenAI-compatible gateway endpoint', async () => {
    process.env.LITELLM_API_KEY = 'lk';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'via litellm' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await callLLM({
      provider: 'litellm',
      system: 'sys',
      userMessage: 'hi',
      maxTokens: 64,
    });

    expect(text).toBe('via litellm');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:4100/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lk');
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toMatchObject({ role: 'system', content: 'sys' });
    delete process.env.LITELLM_API_KEY;
  });

  it('uses deepseek-reasoner and omits temperature when reasoning with deepseek', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'plan' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await callLLM({
      provider: 'deepseek',
      system: 'sys',
      userMessage: 'plan this',
      reasoning: true,
    });
    expect(text).toBe('plan');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek-reasoner');
    expect(body.temperature).toBeUndefined();
  });

  it('sends the Anthropic thinking block and no temperature when reasoning', async () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    delete process.env.DEEPSEEK_API_KEY;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'plan' }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await callLLM({ provider: 'anthropic', system: 'sys', userMessage: 'plan', reasoning: true });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    expect(body.temperature).toBeUndefined();
  });

  it('adds reasoning_effort high and no temperature for openai when reasoning', async () => {
    process.env.OPENAI_API_KEY = 'ok';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'plan' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await callLLM({ provider: 'openai', system: 'sys', userMessage: 'plan', reasoning: true });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.reasoning_effort).toBe('high');
    expect(body.temperature).toBeUndefined();
  });
});

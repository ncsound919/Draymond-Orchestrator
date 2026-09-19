process.env.DRAYMOND_DB_PATH = ':memory:';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, resolveLLMProvider } from '../src/lib/draymond/llm';

/**
 * Seed a memory row into the DB that `retrieveContext` reads, so the context
 * block is non-empty and LLMLingua-2 compression actually runs. Uses the same
 * `getDb()` singleton the retrieval module uses.
 */
async function seedMemoryRow() {
  const { getDb } = await import('../src/lib/db/connection');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO draymond_memory
      (id, agent_id, user_id, key, value, summary, tier, importance_score, decay_rate,
       last_accessed_at, access_count, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'mem-test-1', 'agent-test', 'user-test', 'test-key', '{}',
    'Important lesson: field-goal efficiency maps to tumor proliferation.', 'core', 0.9, 0.01,
    now, 1, 1, now, now,
  );
}

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

  it('stops before any provider when the fleet budget is exhausted', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    process.env.DRAYMOND_FLEET_DAILY_BUDGET = '10';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'should-not-run' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { consumeTokens, resetBudget } = await import('../src/lib/draymond/workflow-budget');
      resetBudget();
      consumeTokens('deepseek', 20); // exhaust the tiny fleet cap
      const text = await callLLM({
        provider: 'deepseek',
        system: 's',
        userMessage: 'u',
        deterministicFallback: 'fleet-cap-fallback',
      });
      expect(text).toBe('fleet-cap-fallback');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.DRAYMOND_FLEET_DAILY_BUDGET;
      const { resetBudget } = await import('../src/lib/draymond/workflow-budget');
      resetBudget();
    }
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

  it('compresses embedded JSON to TOON before sending when toonify is enabled', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const userMessage =
      '<user_task>route me</user_task>\n<context>' +
      JSON.stringify({
        user_id: 'u1',
        plan: 'pro',
        entities: [
          { slug: 'billing', name: 'Billing Agent', kind: 'agent' },
          { slug: 'crm', name: 'CRM Sync', kind: 'chain' },
        ],
      }) +
      '</context>';

    await callLLM({
      provider: 'deepseek',
      system: 'sys',
      userMessage,
      maxTokens: 128,
      toonify: true,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[1].content).toContain('```toon');
    expect(body.messages[1].content).not.toContain('{"user_id');
    // Plain-text instruction stays intact around the compressed block.
    expect(body.messages[1].content).toContain('<user_task>route me</user_task>');
  });

  it('leaves messages untouched when toonify is not requested', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const userMessage =
      '<context>' +
      JSON.stringify({
        user_id: 'u1',
        plan: 'pro',
        entities: [
          { slug: 'billing', name: 'Billing Agent', kind: 'agent' },
          { slug: 'crm', name: 'CRM Sync', kind: 'chain' },
        ],
      }) +
      '</context>';

    await callLLM({
      provider: 'deepseek',
      system: 'sys',
      userMessage,
      maxTokens: 128,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[1].content).toContain('{"user_id":"u1"');
    expect(body.messages[1].content).not.toContain('```toon');
  });

  it('uses deepseek-reasoner and omits temperature when reasoning with deepseek', async () => {    process.env.DEEPSEEK_API_KEY = 'test-key';
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

  describe('compressContextBlock', () => {
    it('returns the original block when the compressor service is unreachable', async () => {
      delete process.env.LLMLINGUA_DISABLE;
      process.env.LLMLINGUA_URL = 'http://127.0.0.1:1'; // nothing listening
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchMock);
      const { compressContextBlock } = await import('../src/lib/draymond/retrieval');
      const block = '<known_lessons>\n- lesson: X\n</known_lessons>';
      const out = await compressContextBlock(block);
      expect(out).toBe(block);
    });

    it('returns the compressed prompt when the service responds', async () => {
      delete process.env.LLMLINGUA_DISABLE;
      process.env.LLMLINGUA_URL = 'http://example.com';
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            original_tokens: 20,
            compressed_tokens: 10,
            ratio: '2.0x',
            compressed_prompt: '<compressed>',
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const { compressContextBlock } = await import('../src/lib/draymond/retrieval');
      const out = await compressContextBlock('<known_lessons>LONG</known_lessons>');
      expect(out).toBe('<compressed>');
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('http://example.com/compress');
      expect(JSON.parse(init.body as string).text).toContain('<known_lessons>');
    });

    it('falls back to the original block when the service returns a bad response', async () => {
      delete process.env.LLMLINGUA_DISABLE;
      process.env.LLMLINGUA_URL = 'http://example.com';
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);

      const { compressContextBlock } = await import('../src/lib/draymond/retrieval');
      const block = '<system_memory>MEM</system_memory>';
      expect(await compressContextBlock(block)).toBe(block);
    });

    it('is a no-op when disabled via env', async () => {
      process.env.LLMLINGUA_DISABLE = '1';
      const { compressContextBlock } = await import('../src/lib/draymond/retrieval');
      expect(await compressContextBlock('<x>y</x>')).toBe('<x>y</x>');
    });
  });

  describe('retrieveContext compression', () => {
    it('compresses the block when compress=true and the service is available', async () => {
      delete process.env.LLMLINGUA_DISABLE;
      process.env.LLMLINGUA_URL = 'http://example.com';
      await seedMemoryRow();
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            original_tokens: 10,
            compressed_tokens: 5,
            ratio: '2.0x',
            compressed_prompt: '<compressed-ctx>',
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const { retrieveContext } = await import('../src/lib/draymond/retrieval');
      const { block } = await retrieveContext('debug', true);
      expect(block).toContain('<compressed-ctx>');
    });

    it('does not compress the block when compress=false', async () => {
      delete process.env.LLMLINGUA_DISABLE;
      process.env.LLMLINGUA_URL = 'http://example.com';
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            original_tokens: 10,
            compressed_tokens: 5,
            ratio: '2.0x',
            compressed_prompt: '<compressed-ctx>',
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const { retrieveContext } = await import('../src/lib/draymond/retrieval');
      const { block } = await retrieveContext('debug', false);
      expect(block).not.toContain('<compressed-ctx>');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('callLocalModel RAG compression default', () => {
    it('compresses the RAG block by default (compressRag undefined)', async () => {
      delete process.env.LLMLINGUA_DISABLE;
      process.env.LLMLINGUA_URL = 'http://example.com';
      await seedMemoryRow();
      // First fetch = compressor; every later fetch = ollama (fresh Response each call).
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('http://example.com/compress')) {
          return new Response(
            JSON.stringify({
              original_tokens: 10,
              compressed_tokens: 5,
              ratio: '2.0x',
              compressed_prompt: '<compressed-ctx>',
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'local-answer' } }] }),
          { status: 200 },
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const { callLocalModel } = await import('../src/lib/draymond/llm');
      const out = await callLocalModel({
        system: 'sys',
        userMessage: 'status of morning-briefing',
        noRag: false,
        maxTokens: 32,
      });
      expect(out).toBe('local-answer');
      // First fetch call must be to the compressor (compression on by default).
      expect(String(fetchMock.mock.calls[0][0])).toBe('http://example.com/compress');
    });
  });
});

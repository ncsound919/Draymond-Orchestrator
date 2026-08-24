import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('fallbacks registry', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a registered template fallback', async () => {
    const { registerFallback, resolveFallback, template, hasFallback } = await import('../src/lib/draymond/fallbacks');
    registerFallback('test.foo', template('test', 'fixed-output'));
    expect(hasFallback('test.foo')).toBe(true);
    expect(resolveFallback('test.foo', {})).toBe('fixed-output');
  });

  it('resolves a computed fallback from context', async () => {
    const { registerFallback, resolveFallback, computed } = await import('../src/lib/draymond/fallbacks');
    registerFallback('test.ctx', computed('test', (ctx) => `echo:${ctx.userMessage}`));
    expect(resolveFallback('test.ctx', { userMessage: 'hello' })).toBe('echo:hello');
  });

  it('returns null for an unregistered key', async () => {
    const { resolveFallback } = await import('../src/lib/draymond/fallbacks');
    expect(resolveFallback('nope', {})).toBeNull();
  });

  it('declares coverage and reports %', async () => {
    const { declareLlmFunction, registerFallback, template, getFallbackCoverage } = await import('../src/lib/draymond/fallbacks');
    declareLlmFunction('a.one');
    declareLlmFunction('a.two');
    declareLlmFunction('a.three');
    registerFallback('a.one', template('x', '1'));
    registerFallback('a.two', template('y', '2'));
    const cov = getFallbackCoverage();
    expect(cov.total).toBe(3);
    expect(cov.covered).toBe(2);
    expect(cov.pct).toBe(66.7);
    expect(cov.uncovered).toContain('a.three');
  });

  it('forces degraded mode on/off via the operator override', async () => {
    const { setDegraded, isDegraded } = await import('../src/lib/draymond/fallbacks');
    expect(isDegraded()).toBe(false);
    expect(setDegraded(true)).toBe(true);
    expect(isDegraded()).toBe(true);
    expect(setDegraded(false)).toBe(false);
    expect(isDegraded()).toBe(false);
  });

  it('tracks degraded mode and auto-clears after the window', async () => {
    const { recordChainFailure, recordChainSuccess, isDegraded } = await import('../src/lib/draymond/fallbacks');
    expect(isDegraded()).toBe(false);
    recordChainFailure();
    recordChainFailure();
    recordChainFailure();
    expect(isDegraded()).toBe(true);
    // Hysteresis: one success subtracts 2 failures (3 → 1) — still degraded.
    recordChainSuccess();
    expect(isDegraded()).toBe(true);
    // A second success clears it (1 → 0).
    recordChainSuccess();
    expect(isDegraded()).toBe(false);
  });
});

describe('callLLM fallbackKey integration', () => {
  it('returns the registry fallback when every provider fails', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response('{"choices":[]}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENCODE_API_KEY = 'test-key';

    // Register the fallback before importing the module that uses it.
    const { registerFallback, template } = await import('../src/lib/draymond/fallbacks');
    registerFallback('test.chain', template('test', 'deterministic-result'));

    const { callLLM } = await import('../src/lib/draymond/llm');
    const out = await callLLM({
      system: 's',
      userMessage: 'u',
      fallbackKey: 'test.chain',
    });
    expect(out).toBe('deterministic-result');
    delete process.env.OPENCODE_API_KEY;
  });

  it('short-circuits to the registry fallback when degraded mode is active', async () => {
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENCODE_API_KEY = 'test-key';

    const fb = await import('../src/lib/draymond/fallbacks');
    fb.registerFallback('test.degraded', fb.template('test', 'degraded-output'));
    // Trip the breaker so degraded mode is active.
    fb.recordChainFailure();
    fb.recordChainFailure();
    fb.recordChainFailure();
    expect(fb.isDegraded()).toBe(true);

    const { callLLM } = await import('../src/lib/draymond/llm');
    const out = await callLLM({
      system: 's',
      userMessage: 'u',
      fallbackKey: 'test.degraded',
    });
    expect(out).toBe('degraded-output');
    // No network call should have happened.
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.OPENCODE_API_KEY;
  });

  it('uses the registry fallback when no providers are configured', async () => {
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.OPENCODE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.QWEN_API_KEY;
    process.env.OLLAMA_ENABLED = '0';

    const fb = await import('../src/lib/draymond/fallbacks');
    fb.registerFallback('test.no-keys', fb.template('test', 'no-key-output'));

    const { callLLM } = await import('../src/lib/draymond/llm');
    const out = await callLLM({
      system: 's',
      userMessage: 'u',
      fallbackKey: 'test.no-keys',
    });

    expect(out).toBe('no-key-output');
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.OLLAMA_ENABLED;
  });

  it('throws when no fallback is configured', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response('{"choices":[]}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENCODE_API_KEY = 'test-key';

    const { callLLM } = await import('../src/lib/draymond/llm');
    await expect(
      callLLM({ system: 's', userMessage: 'u' }),
    ).rejects.toThrow();
    delete process.env.OPENCODE_API_KEY;
  });
});

describe('deterministic brain escalation', () => {
  it('asks the brain to finish the task when degraded, then falls back to template', async () => {
    vi.resetModules();
    // All LLM providers fail with 500s.
    const fetchMock = vi.fn(async () => new Response('{"choices":[]}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENCODE_API_KEY = 'test-key';
    // Wire the brain so the degraded path escalates to it.
    process.env.BRAIN_URL = 'http://127.0.0.1:3210';

    const fb = await import('../src/lib/draymond/fallbacks');
    const brainFn = vi.fn(async () => '{"tasks":[{"id":"t1","agent":"uplift"}]}');
    fb.registerFallback('test.brain', fb.brainFallback('test', brainFn, () => 'template-output'));
    fb.recordChainFailure();
    fb.recordChainFailure();
    fb.recordChainFailure();

    const { callLLM } = await import('../src/lib/draymond/llm');
    const out = await callLLM({
      system: 's',
      userMessage: 'decompose this goal',
      fallbackKey: 'test.brain',
    });
    // The brain was asked and its output returned (not the template).
    expect(brainFn).toHaveBeenCalledTimes(1);
    expect(out).toBe('{"tasks":[{"id":"t1","agent":"uplift"}]}');

    delete process.env.OPENCODE_API_KEY;
    delete process.env.BRAIN_URL;
  });

  it('falls through to the template when the brain is unreachable', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response('{"choices":[]}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENCODE_API_KEY = 'test-key';
    // No BRAIN_URL → runBrainTask returns null → template is used.
    delete process.env.BRAIN_URL;

    const fb = await import('../src/lib/draymond/fallbacks');
    fb.registerFallback('test.brain2', fb.brainFallback('test', async () => null, () => 'template-output'));
    fb.recordChainFailure();
    fb.recordChainFailure();
    fb.recordChainFailure();

    const { callLLM } = await import('../src/lib/draymond/llm');
    const out = await callLLM({
      system: 's',
      userMessage: 'u',
      fallbackKey: 'test.brain2',
    });
    expect(out).toBe('template-output');
    delete process.env.OPENCODE_API_KEY;
  });
});

describe('brain-task research paper routing', () => {
  it('routes research-paper requests to /research/publish on the brain', async () => {
    vi.resetModules();
    process.env.BRAIN_URL = 'http://127.0.0.1:3210';

    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.includes('/research/publish')) {
        return new Response(JSON.stringify({ ok: true, title: 'Test Paper', body: '# Test Paper\n\ncontent' }), { status: 201 });
      }
      return new Response(JSON.stringify({ final_output: 'general result' }), { status: 200 });
    }));

    const { runBrainTask } = await import('../src/lib/draymond/brain-task');
    const out = await runBrainTask('write a research paper about AI fallbacks');

    expect(out).toContain('# Test Paper');
    expect(calls[0].url).toBe('http://127.0.0.1:3210/research/publish');
    expect(calls[0].body).toMatchObject({ topic: 'write a research paper about AI fallbacks' });

    delete process.env.BRAIN_URL;
    vi.unstubAllGlobals();
  });

  it('falls through to /task for non-research requests', async () => {
    vi.resetModules();
    process.env.BRAIN_URL = 'http://127.0.0.1:3210';

    const calls: Array<{ url: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      return new Response(JSON.stringify({ final_output: 'routed to general lane' }), { status: 200 });
    }));

    const { runBrainTask } = await import('../src/lib/draymond/brain-task');
    const out = await runBrainTask('check system status of morning briefing');
    expect(out).toBe('routed to general lane');
    expect(calls[0].url).toBe('http://127.0.0.1:3210/task');

    delete process.env.BRAIN_URL;
    vi.unstubAllGlobals();
  });
});

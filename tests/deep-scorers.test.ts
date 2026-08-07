import { describe, expect, it, vi, afterEach } from 'vitest';
import { deepScore, scoreWithReporank, scoreWithGrader, scoreWithVibeReality } from '../src/lib/draymond/deep-scorers';

describe('deep scorers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('reporank returns a score when reachable', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ trust: 78, summary: 'ok' }), { status: 200 }));
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.scorer).toBe('reporank');
    expect(r.score).toBe(78);
  });

  it('reporank fails soft when env missing', async () => {
    vi.unstubAllEnvs();
    const r = await scoreWithReporank('a', 'https://github.com/x/y');
    expect(r.error).toBeTruthy();
    expect(r.score).toBeNull();
  });

  it('grader returns a score when reachable', async () => {
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ score: 88, grade: 'A' }), { status: 200 }));
    const r = await scoreWithGrader('megacode', 'https://github.com/x/y');
    expect(r.scorer).toBe('grader');
    expect(r.score).toBe(88);
  });

  it('vibe-reality returns a score when reachable', async () => {
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ vibeScore: 65, feedback: 'decent' }), { status: 200 }));
    const r = await scoreWithVibeReality('social-media-dashboard');
    expect(r.scorer).toBe('vibe-reality');
    expect(r.score).toBe(65);
  });

  it('deepScore returns all three results', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ score: 80 }), { status: 200 }));
    const out = await deepScore('entity', 'uplift-agent', 'Uplift Agent', 'https://github.com/x/y');
    expect(Object.keys(out)).toEqual(['reporank', 'grader', 'vibe-reality']);
  });

  it('reporank fails soft on HTTP 500', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    globalThis.fetch = vi.fn(async () => new Response('oops', { status: 500 }));
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('HTTP 500');
    expect(r.score).toBeNull();
  });

  it('grader fails soft when fetch rejects', async () => {
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await scoreWithGrader('megacode', 'https://github.com/x/y');
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('ECONNREFUSED');
    expect(r.score).toBeNull();
  });

  it('vibe-reality fails soft on invalid JSON', async () => {
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    globalThis.fetch = vi.fn(async () => new Response('not json', { status: 200 }));
    const r = await scoreWithVibeReality('social-media-dashboard');
    expect(r.error).toBeTruthy();
    expect(r.score).toBeNull();
  });

  it('reporank does not coerce string scores', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ trust: '78' }), { status: 200 }));
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.score).toBeNull();
  });

  it('reporank returns null score and fallback summary when score field missing', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ foo: 1 }), { status: 200 }));
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.score).toBeNull();
    expect(r.summary).toBe('reporank trust scored');
  });

  it('deepScore never throws when all envs missing', async () => {
    vi.unstubAllEnvs();
    const out = await deepScore('entity', 'x', 'X');
    expect(out).toBeTruthy();
    expect(Object.values(out).every((r) => r.error)).toBe(true);
  });
});

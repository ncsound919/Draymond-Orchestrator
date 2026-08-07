import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
});

import { describe, expect, it, vi, afterEach } from 'vitest';
import { deepScore, scoreWithReporank, scoreWithGrader, scoreWithVibeReality } from '../src/lib/draymond/deep-scorers';

/** A fetch mock that dispatches on URL path (first match wins). */
function mockFetch(routes: Array<{ match: RegExp; status?: number; body?: unknown; throwOn?: boolean }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const r of routes) {
      if (r.match.test(url)) {
        if (r.throwOn) throw new Error(r.body as string);
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
      }
    }
    return new Response('not found', { status: 404 });
  });
}

describe('deep scorers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('reporank submits a scan and polls until complete, extracting overallScore', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_testkey');
    vi.stubEnv('REPORANK_POLL_INTERVAL_MS', '1');
    globalThis.fetch = mockFetch([
      { match: /\/api\/v1\/scans$/, body: { data: { scanId: 'scan-1', status: 'queued', estimatedDuration: 60 } } },
      { match: /\/api\/v1\/scans\/scan-1$/, body: { data: { status: 'complete', result: { overallScore: 78, gradeCategory: 'B+' } } } },
    ]);
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.scorer).toBe('reporank');
    expect(r.score).toBe(78);
    expect(r.summary).toBe('grade B+');
    expect(r.error).toBeUndefined();
  });

  it('reporank fails soft when the scan errors', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_testkey');
    vi.stubEnv('REPORANK_POLL_INTERVAL_MS', '1');
    globalThis.fetch = mockFetch([
      { match: /\/api\/v1\/scans$/, body: { data: { scanId: 'scan-1', status: 'queued' } } },
      { match: /\/api\/v1\/scans\/scan-1$/, body: { data: { status: 'error', error: 'repo not found' } } },
    ]);
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.error).toContain('repo not found');
    expect(r.score).toBeNull();
  });

  it('reporank fails soft when the API key is missing', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.unstubAllEnvs();
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.error).toContain('REPORANK_API_KEY');
    expect(r.score).toBeNull();
  });

  it('reporank fails soft when there is no GitHub repo URL', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_testkey');
    const r = await scoreWithReporank('uplift-agent', 'repo:Uplift Agent');
    expect(r.error).toContain('no GitHub repo URL');
    expect(r.score).toBeNull();
  });

  it('reporank fails soft when env missing', async () => {
    vi.unstubAllEnvs();
    const r = await scoreWithReporank('a', 'https://github.com/x/y');
    expect(r.error).toBeTruthy();
    expect(r.score).toBeNull();
  });

  it('reporank fails soft on HTTP 500', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_testkey');
    globalThis.fetch = mockFetch([{ match: /\/api\/v1\/scans$/, status: 500 }]);
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.error).toContain('HTTP 500');
    expect(r.score).toBeNull();
  });

  it('reporank fails soft on scan timeout', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_testkey');
    vi.stubEnv('REPORANK_POLL_INTERVAL_MS', '1');
    vi.stubEnv('REPORANK_POLL_TIMEOUT_MS', '2');
    globalThis.fetch = mockFetch([
      { match: /\/api\/v1\/scans$/, body: { data: { scanId: 'scan-1', status: 'queued' } } },
      { match: /\/api\/v1\/scans\/scan-1$/, body: { data: { status: 'queued', progress: 10 } } },
    ]);
    const r = await scoreWithReporank('uplift-agent', 'https://github.com/x/y');
    expect(r.error).toContain('timed out');
    expect(r.score).toBeNull();
  });

  it('grader grades a repo and extracts overallScore + gradeCategory', async () => {
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('GRADER_API_KEY', 'gr_testkey');
    globalThis.fetch = mockFetch([
      { match: /\/api\/grade$/, body: { overallScore: 88, gradeCategory: 'A', summary: 'solid' } },
    ]);
    const r = await scoreWithGrader('megacode', 'https://github.com/x/y');
    expect(r.scorer).toBe('grader');
    expect(r.score).toBe(88);
    expect(r.summary).toBe('grade A');
    expect(r.error).toBeUndefined();
  });

  it('grader fails soft when env missing', async () => {
    vi.unstubAllEnvs();
    const r = await scoreWithGrader('a', 'https://github.com/x/y');
    expect(r.error).toBeTruthy();
    expect(r.score).toBeNull();
  });

  it('grader fails soft when the API key is missing', async () => {
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    const r = await scoreWithGrader('a', 'https://github.com/x/y');
    expect(r.error).toContain('GRADER_API_KEY');
    expect(r.score).toBeNull();
  });

  it('grader fails soft when fetch rejects', async () => {
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('GRADER_API_KEY', 'gr_testkey');
    globalThis.fetch = mockFetch([{ match: /\/api\/grade$/, throwOn: true, body: 'ECONNREFUSED' }]);
    const r = await scoreWithGrader('megacode', 'https://github.com/x/y');
    expect(r.error).toContain('ECONNREFUSED');
    expect(r.score).toBeNull();
  });

  it('vibe-reality analyzes a repo and polls for realityScore', async () => {
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    vi.stubEnv('VIBE_REALITY_ID_TOKEN', 'firebase-token');
    vi.stubEnv('VIBE_POLL_INTERVAL_MS', '1');
    globalThis.fetch = mockFetch([
      { match: /\/api\/analyze$/, body: { jobId: 'job-1' } },
      { match: /\/api\/jobs\/job-1$/, body: { status: 'complete', result: { realityScore: 65, vibeCheck: 'decent shell' } } },
    ]);
    const r = await scoreWithVibeReality('social-media-dashboard', 'https://github.com/x/y');
    expect(r.scorer).toBe('vibe-reality');
    expect(r.score).toBe(65);
    expect(r.summary).toContain('decent shell');
  });

  it('vibe-reality fails soft without an ID token', async () => {
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    const r = await scoreWithVibeReality('social-media-dashboard', 'https://github.com/x/y');
    expect(r.error).toContain('VIBE_REALITY_ID_TOKEN');
    expect(r.score).toBeNull();
  });

  it('vibe-reality fails soft on invalid JSON', async () => {
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    vi.stubEnv('VIBE_REALITY_ID_TOKEN', 'firebase-token');
    vi.stubEnv('VIBE_POLL_INTERVAL_MS', '1');
    vi.stubEnv('VIBE_POLL_TIMEOUT_MS', '2');
    globalThis.fetch = mockFetch([
      { match: /\/api\/analyze$/, body: { jobId: 'job-1' } },
      { match: /\/api\/jobs\/job-1$/, body: { status: 'pending' } },
    ]);
    const r = await scoreWithVibeReality('social-media-dashboard', 'https://github.com/x/y');
    expect(r.error).toContain('timed out');
    expect(r.score).toBeNull();
  });

  it('deepScore returns all three results', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_rr');
    vi.stubEnv('REPORANK_POLL_INTERVAL_MS', '1');
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('GRADER_API_KEY', 'gr_gr');
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    vi.stubEnv('VIBE_REALITY_ID_TOKEN', 'tok');
    vi.stubEnv('VIBE_POLL_INTERVAL_MS', '1');
    globalThis.fetch = mockFetch([
      { match: /\/api\/v1\/scans$/, body: { data: { scanId: 's1', status: 'queued' } } },
      { match: /\/api\/v1\/scans\/s1$/, body: { data: { status: 'complete', result: { overallScore: 80, gradeCategory: 'B' } } } },
      { match: /\/api\/grade$/, body: { overallScore: 80, gradeCategory: 'B' } },
      { match: /\/api\/analyze$/, body: { jobId: 'j1' } },
      { match: /\/api\/jobs\/j1$/, body: { status: 'complete', result: { realityScore: 70 } } },
    ]);
    const out = await deepScore('entity', 'uplift-agent', 'Uplift Agent', 'https://github.com/x/y');
    expect(Object.keys(out)).toEqual(['reporank', 'grader', 'vibe-reality']);
    expect(out.reporank.score).toBe(80);
    expect(out.grader.score).toBe(80);
    expect(out['vibe-reality'].score).toBe(70);
  });

  it('deepScore never throws when all envs missing', async () => {
    vi.unstubAllEnvs();
    const out = await deepScore('entity', 'x', 'X', 'repo:X');
    expect(out).toBeTruthy();
    expect(Object.values(out).every((r) => r.error)).toBe(true);
  });
});

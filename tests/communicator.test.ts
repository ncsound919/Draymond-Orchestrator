import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { PhaseRecap } from '../src/lib/draymond/communicator';

const originalEnv = { ...process.env };

let tempDir = '';

const mocks = vi.hoisted(() => ({
  pipelineSummary: vi.fn(),
  settledRevenueUsd: vi.fn(),
  getLessons: vi.fn(),
  newsDigest: vi.fn(),
  rdNightReport: vi.fn(),
  sendMemo: vi.fn(),
}));

const recap: PhaseRecap = {
  phase: 'morning',
  generatedAt: '2026-08-07T10:00:00.000Z',
  sections: {
    money: 'Pipeline: $100 active',
    issues: '2 lesson(s)',
    insights: 'News: Hello',
    upgrades: 'Dev queue: Ship it',
  },
  summary: 'Morning recap: Pipeline: $100 active',
};

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draymond-comm-'));
  process.env.DRAYMOND_REGISTRY_DIR = tempDir;
  delete process.env.OPENCHAT_WEBHOOK;
  delete process.env.NTFY_URL;
  delete process.env.NTFY_TOPIC_RECAPS;
  delete process.env.NTFY_TOPIC_RESULTS;
  delete process.env.GMAIL_USER;
  delete process.env.DRAYMOND_ALERT_EMAIL;
});

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.resetModules();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

async function loadCommunicator() {
  vi.resetModules();
  vi.doMock('../src/lib/draymond/business-pipeline', () => ({
    pipelineSummary: mocks.pipelineSummary,
  }));
  vi.doMock('../src/lib/draymond/treasury-state', () => ({
    settledRevenueUsd: mocks.settledRevenueUsd,
  }));
  vi.doMock('../src/lib/draymond/self-learning', () => ({
    getLessons: mocks.getLessons,
  }));
  vi.doMock('../src/lib/draymond/news', () => ({
    newsDigest: mocks.newsDigest,
  }));
  vi.doMock('../src/lib/draymond/rd-night', () => ({
    rdNightReport: mocks.rdNightReport,
  }));
  vi.doMock('../src/lib/draymond/notifications', () => ({
    sendMemo: mocks.sendMemo,
  }));
  return await import('../src/lib/draymond/communicator');
}

describe('buildRecap', () => {
  it('builds a recap with every section populated', async () => {
    mocks.settledRevenueUsd.mockResolvedValue(150);
    mocks.pipelineSummary.mockResolvedValue({
      opportunities: { activePipelineValue: 12000, wonMonthlyValue: 3000 },
      monthlyTarget: 33000,
    });
    mocks.getLessons.mockResolvedValue([{ pattern: 'retries' }, { pattern: 'timeouts' }]);
    mocks.newsDigest.mockResolvedValue({ items: [{ title: 'AI news' }, { title: 'Markets' }] });
    mocks.rdNightReport.mockResolvedValue({
      tasks: [
        { kind: 'dev', status: 'queued', title: 'New UI' },
        { kind: 'research', status: 'queued', title: 'Survey' },
      ],
    });

    const mod = await loadCommunicator();
    const r = await mod.buildRecap('morning');

    expect(r.phase).toBe('morning');
    expect(typeof r.generatedAt).toBe('string');
    expect(r.sections.money).toBe(
      'Settled revenue: $150. Pipeline: $12000 active, $3000 won/mo. Target $33000/mo.',
    );
    expect(r.sections.issues).toBe('2 lesson(s): retries; timeouts');
    expect(r.sections.insights).toBe('News: AI news | Markets');
    expect(r.sections.upgrades).toBe('Dev queue: New UI');
    expect(r.summary).toBe('Morning recap: Settled revenue: $150. Pipeline: $12000 active, $3000 won/mo. Target $33000/mo.');
  });

  it('reports no recurring issues and no news/upgrades when they are empty', async () => {
    mocks.settledRevenueUsd.mockResolvedValue(0);
    mocks.pipelineSummary.mockResolvedValue({
      opportunities: { activePipelineValue: 0, wonMonthlyValue: 0 },
      monthlyTarget: 33000,
    });
    mocks.getLessons.mockResolvedValue([]);
    mocks.newsDigest.mockResolvedValue({ items: [] });
    mocks.rdNightReport.mockResolvedValue({ tasks: [] });

    const mod = await loadCommunicator();
    const r = await mod.buildRecap('night');

    expect(r.sections.issues).toBe('No recurring issues.');
    expect(r.sections.insights).toBeUndefined();
    expect(r.sections.upgrades).toBeUndefined();
    expect(r.summary).toBe('Night recap: Settled revenue: $0. Pipeline: $0 active, $0 won/mo. Target $33000/mo.');
  });

  it('falls back to n/a sections when all modules throw', async () => {
    mocks.settledRevenueUsd.mockRejectedValue(new Error('boom'));
    mocks.pipelineSummary.mockRejectedValue(new Error('boom'));
    mocks.getLessons.mockRejectedValue(new Error('boom'));
    mocks.newsDigest.mockRejectedValue(new Error('boom'));
    mocks.rdNightReport.mockRejectedValue(new Error('boom'));

    const mod = await loadCommunicator();
    const r = await mod.buildRecap('evening');

    expect(r.sections.money).toBeUndefined();
    expect(r.sections.issues).toBeUndefined();
    expect(r.sections.insights).toBeUndefined();
    expect(r.sections.upgrades).toBeUndefined();
    expect(r.summary).toBe('Evening recap: money n/a');
  });
});

describe('renderRecap', () => {
  it('renders populated sections as markdown', async () => {
    const mod = await loadCommunicator();
    const out = mod.renderRecap(recap);
    expect(out).toContain('# Morning Recap — 2026-08-07');
    expect(out).toContain('**money:** Pipeline: $100 active');
    expect(out).toContain('**issues:** 2 lesson(s)');
    expect(out).toContain('**upgrades:** Dev queue: Ship it');
  });

  it('renders just the header when no sections have text', async () => {
    const mod = await loadCommunicator();
    const out = mod.renderRecap({ ...recap, sections: {} });
    expect(out).toContain('# Morning Recap — 2026-08-07');
    expect(out).not.toContain('**');
  });
});

describe('saveRecap', () => {
  it('writes a new recap file when none exists', async () => {
    const mod = await loadCommunicator();
    const saved = await mod.saveRecap(recap);

    expect(saved).toHaveLength(1);
    const stored = JSON.parse(
      await fs.readFile(path.join(tempDir, 'recaps.json'), 'utf-8'),
    );
    expect(stored.recaps).toHaveLength(1);
    expect(stored.recaps[0].summary).toBe(recap.summary);
    expect(stored.updatedAt).toBeTruthy();
  });

  it('appends to an existing file and caps the log at 200 entries', async () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ ...recap, summary: `old-${i}` }));
    await fs.writeFile(
      path.join(tempDir, 'recaps.json'),
      JSON.stringify({ recaps: many }),
      'utf-8',
    );

    const mod = await loadCommunicator();
    const ret = await mod.saveRecap(recap);

    expect(ret).toHaveLength(206);
    const stored = JSON.parse(
      await fs.readFile(path.join(tempDir, 'recaps.json'), 'utf-8'),
    );
    expect(stored.recaps).toHaveLength(200);
    expect(stored.recaps[199].summary).toBe(recap.summary);
  });
});

describe('sendRecap', () => {
  it('reports not-configured details when no channels are set', async () => {
    const mod = await loadCommunicator();
    const res = await mod.sendRecap(recap);

    expect(res.channels).toEqual([]);
    expect(res.detail).toEqual([
      'openchat: OPENCHAT_WEBHOOK not configured',
      'ntfy: NTFY_URL/TOPIC not configured',
      'email: GMAIL_USER/ALERT_EMAIL not configured',
    ]);
  });

  it('pushes a recap to the openchat webhook', async () => {
    process.env.OPENCHAT_WEBHOOK = 'https://chat.example.com/hook';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadCommunicator();
    const res = await mod.sendRecap(recap);

    expect(res.channels).toEqual(['openchat']);
    expect(res.detail[0]).toBe('openchat HTTP 200');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://chat.example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.channel).toBe('workplace');
    expect(body.text).toContain('# Morning Recap');
  });

  it('sends to openchat, ntfy, and email when all are configured', async () => {
    process.env.OPENCHAT_WEBHOOK = 'https://chat.example.com/hook';
    process.env.NTFY_URL = 'https://ntfy.example.com/';
    process.env.NTFY_TOPIC_RECAPS = 'recaps';
    process.env.GMAIL_USER = 'me@example.com';
    mocks.sendMemo.mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadCommunicator();
    const res = await mod.sendRecap(recap);

    expect(res.channels).toEqual(['openchat', 'ntfy', 'email']);
    expect(res.detail).toEqual(['openchat HTTP 200', 'ntfy HTTP 200', 'email sent']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // trailing slash on NTFY_URL is stripped
    expect(fetchMock.mock.calls[1][0]).toBe('https://ntfy.example.com');
    const ntfyBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(ntfyBody.topic).toBe('recaps');
    expect(ntfyBody.title).toBe('Draymond morning recap');
    expect(ntfyBody.tags).toEqual(['recap']);
    expect(ntfyBody.priority).toBe(3);
    expect(mocks.sendMemo).toHaveBeenCalledWith(
      'Overlay365 morning recap — 2026-08-07',
      expect.stringContaining('# Morning Recap'),
    );
  });

  it('uses NTFY_TOPIC_RESULTS when NTFY_TOPIC_RECAPS is unset', async () => {
    process.env.NTFY_URL = 'https://ntfy.example.com';
    process.env.NTFY_TOPIC_RESULTS = 'results';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadCommunicator();
    const res = await mod.sendRecap(recap);

    expect(res.channels).toEqual(['ntfy']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).topic).toBe('results');
  });

  it('reports openchat delivery failure when fetch rejects', async () => {
    process.env.OPENCHAT_WEBHOOK = 'https://chat.example.com/hook';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const mod = await loadCommunicator();
    const res = await mod.sendRecap(recap);

    expect(res.channels).toEqual([]);
    expect(res.detail[0]).toBe('openchat: network down');
  });

  it('reports ntfy delivery failure when fetch rejects', async () => {
    process.env.NTFY_URL = 'https://ntfy.example.com';
    process.env.NTFY_TOPIC_RECAPS = 'recaps';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const mod = await loadCommunicator();
    const res = await mod.sendRecap(recap);

    expect(res.channels).toEqual([]);
    expect(res.detail[0]).toBe('openchat: OPENCHAT_WEBHOOK not configured');
    expect(res.detail[1]).toBe('ntfy: boom');
  });

  it('reports email failure when sendMemo throws', async () => {
    process.env.GMAIL_USER = 'me@example.com';
    mocks.sendMemo.mockRejectedValue(new Error('smtp down'));

    const mod = await loadCommunicator();
    const res = await mod.sendRecap(recap);

    expect(res.channels).toEqual([]);
    expect(res.detail[2]).toBe('email: smtp down');
  });
});

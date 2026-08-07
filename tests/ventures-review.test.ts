import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

type ActionRow = {
  session_id: string;
  review_token: string | null;
  review_token_expires_at: string | null;
  [key: string]: unknown;
};

type MockChain = {
  eqs: Record<string, string>;
  select: () => MockChain;
  maybeSingle: () => Promise<{ data: ActionRow | null; error: null }>;
  eq: (col: string, value: string) => MockChain;
};

// In-memory draymond_actions store keyed by session_id (venture-<id>).
const actions = vi.hoisted(() => new Map<string, ActionRow>());

// Point the registry dir at a throwaway temp dir BEFORE the module graph loads
// so readRecords/writeRecords in ventures.ts hit the temp dir, not .draymond.
const TEST_DIR = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/';
  const dir = `${process.cwd()}${sep}.tmp-venture-review-test`;
  process.env.DRAYMOND_REGISTRY_DIR = dir;
  return dir;
});

function buildChain(table: string): MockChain {
  const chain: MockChain = {
    eqs: {},
    select: () => chain,
    maybeSingle: async () => {
      if (table === 'draymond_actions') {
        return { data: actions.get(chain.eqs['session_id']) ?? null, error: null };
      }
      return { data: null, error: null };
    },
    eq: (col, value) => {
      chain.eqs[col] = value;
      return chain;
    },
  };
  return chain;
}

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondClient: vi.fn(() => ({ from: (t: string) => buildChain(t) })),
  createDraymondAdminClient: vi.fn(() => ({ from: (t: string) => buildChain(t) })),
}));

vi.mock('../src/lib/draymond/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/chains')>();
  return {
    ...actual,
    getChain: vi.fn(async (slugOrId: string) => ({
      id: slugOrId,
      slug: 'venture-test-chain',
      name: 'Test Chain',
      is_template: true,
      status: 'draft',
    })),
    instantiateChain: vi.fn(async () => ({ id: 'inst-1', slug: 'venture-test-chain-run-1' })),
    executeChain: vi.fn(async () => ({})),
  };
});

vi.mock('../src/lib/draymond/self-learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/self-learning')>();
  return { ...actual, recordOutcome: vi.fn(async () => ({ id: 'lo_test' })) };
});

import { reviewVenture } from '../src/lib/draymond/ventures';

const RECORDS_FILE = () => path.join(TEST_DIR, 'ventures.json');

function makeRecord(id: string, status: string): Record<string, unknown> {
  return {
    id,
    chain_id: 'chain-1',
    name: 'Test Venture',
    revenue_lane: 'service',
    risk_level: 'high',
    status,
    created_at: new Date().toISOString(),
  };
}

async function seedRecords(records: Array<Record<string, unknown>>): Promise<void> {
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(RECORDS_FILE(), JSON.stringify({ records, updatedAt: new Date().toISOString() }), 'utf-8');
}

const futureIso = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastIso = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function actionFor(id: string, token: string, expiresAt: string): ActionRow {
  return { session_id: `venture-${id}`, review_token: token, review_token_expires_at: expiresAt };
}

describe('reviewVenture auth', () => {
  beforeEach(() => {
    actions.clear();
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects a rejection when no token is supplied and not cron-authorized', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    actions.set('venture-vn_1', actionFor('vn_1', 'tok-secret', futureIso()));
    await expect(reviewVenture('vn_1', '', false, false)).rejects.toThrow('Unauthorized');
  });

  it('rejects a rejection with a wrong token', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    actions.set('venture-vn_1', actionFor('vn_1', 'tok-secret', futureIso()));
    await expect(reviewVenture('vn_1', 'tok-wrong', false, false)).rejects.toThrow('Unauthorized');
  });

  it('throws when the review token has expired', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    actions.set('venture-vn_1', actionFor('vn_1', 'tok-secret', pastIso()));
    await expect(reviewVenture('vn_1', 'tok-secret', false, false)).rejects.toThrow('Review token expired');
  });

  it('allows a rejection when cron-authorized (no token needed)', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    const reviewed = await reviewVenture('vn_1', '', false, true);
    expect(reviewed.status).toBe('rejected');
  });

  it('approves with a valid token, executes the chain, and marks the venture completed', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    actions.set('venture-vn_1', actionFor('vn_1', 'tok-secret', futureIso()));
    const { instantiateChain, executeChain } = await import('../src/lib/draymond/chains');
    const reviewed = await reviewVenture('vn_1', 'tok-secret', true, false);
    expect(reviewed.status).toBe('completed');
    expect(vi.mocked(instantiateChain)).toHaveBeenCalled();
    expect(vi.mocked(executeChain)).toHaveBeenCalled();
  });
});

describe('reviewVenture guards', () => {
  beforeEach(() => {
    actions.clear();
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('throws when the venture is not pending review', async () => {
    await seedRecords([makeRecord('vn_1', 'running')]);
    await expect(reviewVenture('vn_1', '', false, true)).rejects.toThrow('not pending review');
  });

  it('throws when the venture is not found', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    await expect(reviewVenture('missing', '', false, true)).rejects.toThrow('Venture not found');
  });
});

describe('POST /api/ventures/[id]/review status mapping', () => {
  function makeRequest(opts: { headers?: Record<string, string>; body?: string } = {}) {
    const headers = new Map<string, string>();
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k.toLowerCase(), v);
    return {
      headers: {
        get: (name: string) => headers.get(name.toLowerCase()) ?? null,
      },
      text: async () => opts.body ?? '',
    } as unknown as import('next/server').NextRequest;
  }

  beforeAll(() => {
    process.env.CRON_SECRET = 'cron-secret-test';
  });

  beforeEach(() => {
    actions.clear();
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  afterAll(() => {
    delete process.env.CRON_SECRET;
  });

  it('maps an unauthenticated reject to 401', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    actions.set('venture-vn_1', actionFor('vn_1', 'tok-secret', futureIso()));
    const { POST } = await import('../src/app/api/ventures/[id]/review/route');
    const res = await POST(
      makeRequest({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: false }) }),
      { params: Promise.resolve({ id: 'vn_1' }) },
    );
    expect(res.status).toBe(401);
  });

  it('maps an expired token to 410', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    actions.set('venture-vn_1', actionFor('vn_1', 'tok-secret', pastIso()));
    const { POST } = await import('../src/app/api/ventures/[id]/review/route');
    const res = await POST(
      makeRequest({
        headers: { 'content-type': 'application/json', 'x-review-token': 'tok-secret' },
        body: JSON.stringify({ approved: true }),
      }),
      { params: Promise.resolve({ id: 'vn_1' }) },
    );
    expect(res.status).toBe(410);
  });

  it('maps an unknown venture to 404', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    const { POST } = await import('../src/app/api/ventures/[id]/review/route');
    const res = await POST(
      makeRequest({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: false }) }),
      { params: Promise.resolve({ id: 'nope' }) },
    );
    expect(res.status).toBe(404);
  });

  it('maps a non-pending venture to 409', async () => {
    await seedRecords([makeRecord('vn_1', 'completed')]);
    const { POST } = await import('../src/app/api/ventures/[id]/review/route');
    const res = await POST(
      makeRequest({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: false }) }),
      { params: Promise.resolve({ id: 'vn_1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('rejects successfully with a valid token (200)', async () => {
    await seedRecords([makeRecord('vn_1', 'pending_review')]);
    actions.set('venture-vn_1', actionFor('vn_1', 'tok-secret', futureIso()));
    const { POST } = await import('../src/app/api/ventures/[id]/review/route');
    const res = await POST(
      makeRequest({
        headers: { 'content-type': 'application/json', 'x-review-token': 'tok-secret' },
        body: JSON.stringify({ approved: false }),
      }),
      { params: Promise.resolve({ id: 'vn_1' }) },
    );
    expect(res.status).toBe(200);
  });
});

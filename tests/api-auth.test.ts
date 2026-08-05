import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizeRequest,
  parseJsonBody,
  sanitizeError,
  isValidUuid,
  isValidId,
  requireValidIds,
} from '../src/lib/draymond/api-auth';

function makeRequest(opts: { headers?: Record<string, string>; body?: string } = {}) {
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers.set(k.toLowerCase(), v);
  }
  return {
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    text: async () => opts.body ?? '',
  } as unknown as import('next/server').NextRequest;
}

describe('authorizeRequest', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('returns 500 when CRON_SECRET is unset', () => {
    const res = authorizeRequest(makeRequest({ headers: { authorization: 'Bearer x' } }));
    expect(res?.status).toBe(500);
  });

  it('authorizes the correct bearer token', () => {
    process.env.CRON_SECRET = 'secret-123';
    const res = authorizeRequest(makeRequest({ headers: { authorization: 'Bearer secret-123' } }));
    expect(res).toBeNull();
  });

  it('rejects a wrong token', () => {
    process.env.CRON_SECRET = 'secret-123';
    const res = authorizeRequest(makeRequest({ headers: { authorization: 'Bearer wrong' } }));
    expect(res?.status).toBe(401);
  });

  it('rejects missing authorization header', () => {
    process.env.CRON_SECRET = 'secret-123';
    const res = authorizeRequest(makeRequest({}));
    expect(res?.status).toBe(401);
  });

  it('rejects a non-bearer header', () => {
    process.env.CRON_SECRET = 'secret-123';
    const res = authorizeRequest(makeRequest({ headers: { authorization: 'Basic abc' } }));
    expect(res?.status).toBe(401);
  });
});

describe('parseJsonBody', () => {
  it('parses a valid JSON body', async () => {
    const result = await parseJsonBody<{ approved: boolean }>(
      makeRequest({ headers: { 'content-length': '20' }, body: '{"approved":true}' }),
    );
    expect(result.data).toEqual({ approved: true });
  });

  it('rejects malformed JSON', async () => {
    const result = await parseJsonBody(makeRequest({ body: 'not json' }));
    expect(result.error?.status).toBe(400);
  });

  it('rejects bodies over the size limit via content-length', async () => {
    const result = await parseJsonBody(
      makeRequest({ headers: { 'content-length': String(2 * 1024 * 1024) } }),
    );
    expect(result.error?.status).toBe(413);
  });

  it('rejects bodies over the size limit via text length', async () => {
    const result = await parseJsonBody(makeRequest({ body: 'x'.repeat(2 * 1024 * 1024) }));
    expect(result.error?.status).toBe(413);
  });
});

describe('sanitizeError', () => {
  it('maps duplicate-key errors to a friendly message', () => {
    expect(
      sanitizeError(new Error('duplicate key value violates unique constraint "x"')),
    ).toBe('A record with this identifier already exists');
  });

  it('maps foreign-key errors', () => {
    expect(sanitizeError(new Error('violates foreign key constraint "fk"'))).toBe(
      'Referenced record not found',
    );
  });

  it('masks internal relation/column leaks', () => {
    expect(sanitizeError(new Error('relation "draymond_actions" does not exist'))).toBe(
      'Internal database error',
    );
  });

  it('falls back to a generic message', () => {
    expect(sanitizeError(new Error('anything else'))).toBe('An unexpected error occurred');
    expect(sanitizeError('plain string')).toBe('An unexpected error occurred');
  });
});

describe('ID validation', () => {
  it('accepts valid UUIDs', () => {
    expect(isValidUuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });

  it('rejects non-UUIDs', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('123e4567-e89b-42d3-a456-42661417400')).toBe(false);
  });

  it('accepts slugs and short ids', () => {
    expect(isValidId('chain-step-123')).toBe(true);
    expect(isValidId('aetherdesk')).toBe(true);
  });

  it('rejects injection attempts', () => {
    expect(isValidId("'; DROP TABLE --")).toBe(false);
    expect(isValidId('<script>')).toBe(false);
    expect(isValidId('../../etc/passwd')).toBe(false);
  });

  it('requireValidIds returns null when all valid', () => {
    expect(requireValidIds({ action_id: 'abc-123', tenant: 'TENANT-001' })).toBeNull();
  });

  it('requireValidIds skips empty values', () => {
    expect(requireValidIds({ action_id: null, tenant: '' })).toBeNull();
  });

  it('requireValidIds rejects invalid values with the field name', async () => {
    const res = requireValidIds({ action_id: 'drop table;' });
    expect(res?.status).toBe(400);
    expect(JSON.parse(await res!.text()).error).toContain('action_id');
  });
});

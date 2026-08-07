import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockCreateClient, mockCreateServerClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(() => ({ fake: true })),
  mockCreateServerClient: vi.fn(() => ({ fakeServer: true })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [{ name: 'a', value: 'b' }],
    set: vi.fn(),
  }),
}));

import { createDraymondAdminClient, createDraymondClient } from '../src/lib/draymond/client';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('createDraymondAdminClient', () => {
  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    expect(() => createDraymondAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createDraymondAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('creates a supabase client when both env vars are set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockCreateClient.mockClear();
    const client = createDraymondAdminClient();
    expect(mockCreateClient).toHaveBeenCalledWith('https://x.supabase.co', 'k', expect.any(Object));
    expect(client).toEqual({ fake: true });
  });
});

describe('createDraymondClient', () => {
  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    await expect(createDraymondClient()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await expect(createDraymondClient()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('creates an SSR client with the cookie store when both env vars are set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mockCreateServerClient.mockClear();
    const client = await createDraymondClient();
    expect(mockCreateServerClient).toHaveBeenCalledWith('https://x.supabase.co', 'anon', expect.any(Object));
    expect(client).toEqual({ fakeServer: true });
  });

  it('passes a working cookie store to the SSR client', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    await createDraymondClient();
    const opts = mockCreateServerClient.mock.calls[0][2] as {
      cookies: { getAll: () => unknown; setAll: (c: Array<{ name: string; value: string; options?: unknown }>) => void };
    };
    expect(opts.cookies.getAll()).toEqual([{ name: 'a', value: 'b' }]);
    // setAll should write through to the cookie store without throwing.
    expect(() => opts.cookies.setAll([{ name: 'k', value: 'v' }])).not.toThrow();
  });
});

describe('createDraymondAdminClient', () => {
  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    expect(() => createDraymondAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createDraymondAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('creates a supabase client when both env vars are set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockCreateClient.mockClear();
    const client = createDraymondAdminClient();
    expect(mockCreateClient).toHaveBeenCalledWith('https://x.supabase.co', 'k', expect.any(Object));
    expect(client).toEqual({ fake: true });
  });
});

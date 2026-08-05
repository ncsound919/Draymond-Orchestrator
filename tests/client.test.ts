import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(() => ({ fake: true })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

import { createDraymondAdminClient } from '../src/lib/draymond/client';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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

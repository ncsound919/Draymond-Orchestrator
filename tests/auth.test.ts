import { describe, expect, it, vi } from 'vitest';

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

import { requireDraymondAuth } from '../src/lib/draymond/auth';

function stubProfile(data: unknown) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(() => Promise.resolve({ data })),
  });
}

describe('requireDraymondAuth', () => {
  it('returns 401 when there is no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(401);
  });

  it('returns 401 when getUser errors', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('x') });
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(401);
  });

  it('returns 403 for a non-admin profile', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null });
    stubProfile({ role: 'member' });
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(403);
  });

  it('returns 403 when no profile exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    stubProfile(null);
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(403);
  });

  it('returns the admin user on success', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'admin@b.c' } }, error: null });
    stubProfile({ role: 'admin' });
    const result = await requireDraymondAuth();
    expect(result.user?.id).toBe('u1');
    expect(result.user?.email).toBe('admin@b.c');
  });

  it('returns 500 when the flow throws', async () => {
    mockGetUser.mockRejectedValue(new Error('boom'));
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(500);
  });
});

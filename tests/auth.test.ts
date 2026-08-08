import { describe, expect, it, vi } from 'vitest';

const { mockGetCurrentUser } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
}));

vi.mock('@/lib/db/session', () => ({
  getCurrentUser: mockGetCurrentUser,
}));

import { requireDraymondActionAuth, requireDraymondAuth } from '../src/lib/draymond/auth';

describe('requireDraymondAuth', () => {
  it('returns 401 when there is no user', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(401);
  });

  it('returns 403 for a non-admin profile', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' });
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(403);
  });

  it('returns the admin user on success', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'admin@b.c', role: 'admin' });
    const result = await requireDraymondAuth();
    expect(result.user?.id).toBe('u1');
    expect(result.user?.email).toBe('admin@b.c');
  });

  it('returns 500 when the flow throws', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('boom'));
    const result = await requireDraymondAuth();
    expect(result.error?.status).toBe(500);
  });
});

describe('requireDraymondActionAuth', () => {
  it('throws when the underlying auth fails', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    await expect(requireDraymondActionAuth()).rejects.toThrow(/Unauthorized/);
  });

  it('returns the user when authorized', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'admin@b.c', role: 'admin' });
    const user = await requireDraymondActionAuth();
    expect(user.id).toBe('u1');
  });
});

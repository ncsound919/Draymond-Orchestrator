import { describe, expect, it } from 'vitest';

describe('ventures API routes exist', () => {
  it('registers POST /api/ventures', async () => {
    const mod = await import('../src/app/api/ventures/route');
    expect(typeof mod.POST).toBe('function');
    expect(typeof mod.GET).toBe('function');
  });

  it('registers POST /api/ventures/[id]/review', async () => {
    const mod = await import('../src/app/api/ventures/[id]/review/route');
    expect(typeof mod.POST).toBe('function');
  });
});

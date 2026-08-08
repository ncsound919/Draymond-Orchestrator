import { describe, expect, it } from 'vitest';
import { createTestDb } from '../src/lib/db/connection';
import { LocalClient } from '../src/lib/db';

describe('update().select() returning semantics (PostgREST parity)', () => {
  const client = () => new LocalClient(createTestDb());

  it('returns the updated row even when the filter is invalidated by the update', async () => {
    const c = client();
    await c.from('draymond_scheduled_jobs').insert({
      name: 'job-1',
      cron_expression: '0 20 * * *',
      job_type: 'custom',
      last_run_status: 'never',
    });
    // The scheduler's atomic claim pattern:
    const { data, error } = await c
      .from('draymond_scheduled_jobs')
      .update({ last_run_status: 'running' })
      .eq('id', (await c.from('draymond_scheduled_jobs').select('id').single()).data.id)
      .neq('last_run_status', 'running')
      .select('id')
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data.id).toBeTruthy();
  });

  it('update().select() returns only the affected rows for a normal filter', async () => {
    const c = client();
    await c.from('draymond_agents').insert([
      { name: 'A', slug: 'a', status: 'active' },
      { name: 'B', slug: 'b', status: 'active' },
      { name: 'C', slug: 'c', status: 'stalled' },
    ]);
    const { data } = await c
      .from('draymond_agents')
      .update({ status: 'degraded' })
      .eq('status', 'active')
      .select('slug');
    expect(data?.map((r: { slug: string }) => r.slug).sort()).toEqual(['a', 'b']);
  });

  it('delete().select() returns nothing (rows are gone)', async () => {
    const c = client();
    await c.from('draymond_agents').insert({ name: 'A', slug: 'a' });
    const { data, error } = await c
      .from('draymond_agents')
      .delete()
      .eq('slug', 'a')
      .select('slug');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '../src/lib/db/connection';
import { closeDb } from '../src/lib/db/connection';
import {
  addLeadNote,
  createLead,
  deleteLead,
  getLead,
  leadStageCounts,
  listLeads,
  moveLead,
  updateLead,
} from '../src/lib/command-center/crm';
import {
  createSeoTask,
  deleteSeoTask,
  getSeoTask,
  listSeoTasks,
  seoTaskCounts,
  setSeoTaskDone,
  setSeoTaskPriority,
  setSeoTaskStatus,
  updateSeoTask,
} from '../src/lib/command-center/seo';
import { getDeployProvider, LocalDeployProvider } from '../src/lib/command-center/deploy';

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM command_leads; DELETE FROM command_seo_tasks;');
});

afterEach(() => {
  closeDb();
});

describe('command center CRM (command_leads)', () => {
  it('creates a lead with default stage "new" and auto ids', async () => {
    const lead = await createLead({ name: 'Acme Corp', value_cents: 500_00 });
    expect(lead.id).toBeTruthy();
    expect(lead.stage).toBe('new');
    expect(lead.name).toBe('Acme Corp');
    expect(typeof lead.created_at).toBe('string');
  });

  it('lists leads and counts per stage', async () => {
    await createLead({ name: 'A', stage: 'contacted' });
    await createLead({ name: 'B', stage: 'won' });
    await createLead({ name: 'C', stage: 'new' });
    const counts = await leadStageCounts();
    expect(counts.contacted).toBe(1);
    expect(counts.won).toBe(1);
    expect(counts.new).toBe(1);
    const leads = await listLeads();
    expect(leads).toHaveLength(3);
  });

  it('moves a lead between valid stages', async () => {
    const lead = await createLead({ name: 'X' });
    const moved = await moveLead(lead.id, 'proposal');
    expect(moved.stage).toBe('proposal');
  });

  it('rejects an invalid stage on move', async () => {
    const lead = await createLead({ name: 'Y' });
    await expect(moveLead(lead.id, 'spam')).rejects.toThrow(/Invalid stage/);
  });

  it('appends notes', async () => {
    const lead = await createLead({ name: 'Z' });
    const updated = await addLeadNote(lead.id, 'Called them', 'me');
    expect(updated.notes).toHaveLength(1);
    expect(updated.notes[0].text).toBe('Called them');
  });

  it('updates and deletes', async () => {
    const lead = await createLead({ name: 'Q' });
    const patched = await updateLead(lead.id, { value_cents: 999 });
    expect(patched.value_cents).toBe(999);
    const fetched = await getLead(lead.id);
    expect(fetched?.value_cents).toBe(999);
    await deleteLead(lead.id);
    expect(await getLead(lead.id)).toBeNull();
  });
});

describe('command center SEO (command_seo_tasks)', () => {
  it('creates a task with defaults', async () => {
    const task = await createSeoTask({ title: 'Fix meta descriptions' });
    expect(task.priority).toBe('medium');
    expect(task.status).toBe('todo');
    expect(task.is_done).toBe(false);
  });

  it('toggles done and clears on undo', async () => {
    const task = await createSeoTask({ title: 'Add sitemap' });
    const done = await setSeoTaskDone(task.id, true);
    expect(done.is_done).toBe(true);
    expect(done.status).toBe('done');
    expect(done.completed_at).toBeTruthy();
    const undone = await setSeoTaskDone(task.id, false);
    expect(undone.is_done).toBe(false);
    expect(undone.completed_at).toBeNull();
  });

  it('sets status and priority with validation', async () => {
    const task = await createSeoTask({ title: 'Canonical tags' });
    const st = await setSeoTaskStatus(task.id, 'in_progress');
    expect(st.status).toBe('in_progress');
    const pr = await setSeoTaskPriority(task.id, 'urgent');
    expect(pr.priority).toBe('urgent');
    await expect(setSeoTaskStatus(task.id, 'nope')).rejects.toThrow(/Invalid status/);
    await expect(setSeoTaskPriority(task.id, 'nope')).rejects.toThrow(/Invalid priority/);
  });

  it('lists and counts', async () => {
    await createSeoTask({ title: 'One', priority: 'high' });
    await createSeoTask({ title: 'Two' });
    const counts = await seoTaskCounts();
    expect(counts.total).toBe(2);
    expect(counts.byPriority.high).toBe(1);
    const tasks = await listSeoTasks();
    expect(tasks).toHaveLength(2);
  });

  it('updates, fetches, and deletes', async () => {
    const task = await createSeoTask({ title: 'Alt text' });
    const patched = await updateSeoTask(task.id, { owner: 'draymond' });
    expect(patched.owner).toBe('draymond');
    expect((await getSeoTask(task.id))?.owner).toBe('draymond');
    await deleteSeoTask(task.id);
    expect(await getSeoTask(task.id)).toBeNull();
  });
});

describe('command center deploy (DeployProvider)', () => {
  it('resolves the local provider', () => {
    expect(getDeployProvider('local')).toBeInstanceOf(LocalDeployProvider);
  });

  it('throws for unknown providers', () => {
    expect(() => getDeployProvider('vercel')).toThrow(/No deploy provider/);
  });

  it('reports a missing target', async () => {
    const provider = new LocalDeployProvider();
    const result = await provider.deploy({ id: 'x', name: 'x', kind: 'local' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/neither process nor url/);
  });
});

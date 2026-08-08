import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hermetic env: in-memory DB + temp registry dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-metrics-'));
process.env.DRAYMOND_DB_PATH = ':memory:';
process.env.DRAYMOND_REGISTRY_DIR = tmp;

import { renderMetrics } from '../src/lib/draymond/metrics';
import { recordOutcome, distillLessons } from '../src/lib/draymond/self-learning';

describe('prometheus metrics endpoint', () => {
  beforeAll(() => {
    process.env.DRAYMOND_DB_PATH = ':memory:';
    process.env.DRAYMOND_REGISTRY_DIR = tmp;
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('renders Prometheus text with the draymond gauges + node defaults', async () => {
    const text = await renderMetrics();
    expect(text).toContain('draymond_job_fail_rate');
    expect(text).toContain('draymond_agents_total');
    expect(text).toContain('draymond_monitors_total');
    expect(text).toContain('draymond_repair_attempts_total');
    expect(text).toContain('draymond_events_total_24h');
    expect(text).toContain('draymond_lessons_total');
    // collectDefaultMetrics is wired — node process metrics present.
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('publishes distilled lessons as a gauge value', async () => {
    await recordOutcome({ agentId: 'x', kind: 'job', summary: 'repeat failure metric', success: false, detail: 'a' });
    await recordOutcome({ agentId: 'x', kind: 'job', summary: 'repeat failure metric', success: false, detail: 'b' });
    await distillLessons();
    const text = await renderMetrics();
    expect(text).toMatch(/draymond_lessons_total \d+/);
  });
});

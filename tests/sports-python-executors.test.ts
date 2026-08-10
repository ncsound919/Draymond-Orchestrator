import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPythonMetrics, runPythonCoach, runPythonTranslate, runPythonInsights } from '@/lib/sports/pythonExecutors';
import { validateOutput } from '@/lib/sports/validate';

describe('sports python executors', () => {
  const PY_TIMEOUT = 30_000;

  it('maps a stat_crew run on a missing dataset to an error-shaped E1 result', async () => {
    const result = await runPythonMetrics({ dataset: 'nonexistent.json' });
    expect(result).toHaveProperty('success', false);
    expect(result).toHaveProperty('evidence_tier');
    expect(String(result.error)).toContain('dataset not found');
    expect(Array.isArray(result.data.data)).toBe(true);
  }, PY_TIMEOUT);

  it('wraps stat_crew metrics in the { data: [...] } BlackMind contract', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sports-test-'));
    try {
      const file = path.join(dir, 'input.json');
      fs.writeFileSync(
        file,
        JSON.stringify({
          sport: 'basketball',
          performance: { fg: 70.0, tp: 80.0, ast: 60.0, oreb: 50.0, tov: -40.0, pf: -30.0, defensive_attention: 0.7, court_spacing: 0.6 },
          biometrics: { hrv: 52.0, load: 0.85, acute_chronic: 1.3, sleep_hrs: 5.5 },
        }),
      );
      const result = await runPythonMetrics({ dataset: file });
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.data)).toBe(true);
      expect(result.data.data[0]).toHaveProperty('ter');
      expect(result.data.data[0]).toHaveProperty('injury_risk');
      expect(validateOutput(result.data).valid).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, PY_TIMEOUT);

  it('builds a game plan from upstream metrics via CLI args', async () => {
    const plan = await runPythonCoach('basketball', { ter: 12.0, gravity: 0.4, recovery_priority: 'elevated' });
    expect(plan.success).toBe(true);
    expect(Array.isArray(plan.data.data)).toBe(true);
    expect(plan.data.data[0]).toHaveProperty('recovery');
    expect(plan.data.data[0]).toHaveProperty('focus', 'increase spacing pressure');
  }, PY_TIMEOUT);

  it('translates a term through the sports->biotech lexicon (E3 mapping)', async () => {
    const result = await runPythonTranslate('FG_PCT', 45.5, true);
    expect(result.success).toBe(true);
    expect(result.evidence_tier).toBe('E3');
    expect(Array.isArray(result.data.data)).toBe(true);
    expect(validateOutput(result.data).valid).toBe(true);
  }, PY_TIMEOUT);

  it('synthesizes whole-profile insights from a sports profile', async () => {
    const result = await runPythonInsights({
      ter: 1.2,
      four_factors: { proliferation: 70, clearance: 40, resource: 55, metastasis: 45 },
      gravity: 0.6,
      flow: 0.5,
      fatigue: 40,
      injury_risk: 0.3,
      recovery_priority: 'high',
      archetype: 'jordan',
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.data)).toBe(true);
    const report = result.data.data[0];
    expect(report).toHaveProperty('from_domain', 'sports');
    expect(report).toHaveProperty('to_domain', 'biotech');
    expect(report).toHaveProperty('target_read');
    expect(Array.isArray(report.translated_metrics)).toBe(true);
  }, PY_TIMEOUT);
});

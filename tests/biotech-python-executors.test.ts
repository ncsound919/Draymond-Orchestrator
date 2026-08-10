import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPythonAnalysis, runPythonTreatment, runPythonTranslate } from '@/lib/biotech/pythonExecutors';
import { validateOutput } from '@/lib/biotech/validate';

describe('biotech python executors', () => {
  // These tests spawn a real Python subprocess (cold interpreter + numpy/pandas
  // imports). Under full-suite CPU load that can exceed vitest's 5s default
  // timeout, so give them a generous window.
  const PY_TIMEOUT = 30_000;

  it('maps an onco_stat_crew run on a missing dataset to an error-shaped E1 result', async () => {
    const result = await runPythonAnalysis({ dataset: 'nonexistent.json' });
    expect(result).toHaveProperty('success', false);
    expect(result).toHaveProperty('evidence_tier');
    expect(String(result.error)).toContain('dataset not found');
    expect(result.data.data).toEqual([]);
    expect(result.data.error).toBe(String(result.error));
    expect(validateOutput(result.data).valid).toBe(true);
  }, PY_TIMEOUT);

  it('wraps onco_stat_crew metrics in the { data: [...] } BlackMind contract', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biotech-test-'));
    try {
      const file = path.join(dir, 'input.json');
      fs.writeFileSync(
        file,
        JSON.stringify({
          cancer_type: 'breast',
          tumor: { ki67: 70.0, apoptotic_index: 12.0, microvessel_density: 60.0, ctc_count: 8.0 },
          clinical: { tumor_size_cm: 3.5, grade: 3, age: 58, receptor_status: { ER_positive: false, HER2_positive: true } },
          treatment: { ctdna: 0.5, tumor_shrinkage_pct: 25, time_point_months: 6 },
        }),
      );
      const result = await runPythonAnalysis({ dataset: file });
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.data)).toBe(true);
      expect(result.data.data[0]).toHaveProperty('ter');
      expect(result.data.data[0]).toHaveProperty('risk_tier');
      expect(result.data.data[0]).not.toHaveProperty('evidence_tier');
      expect(validateOutput(result.data).valid).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, PY_TIMEOUT);

  it('builds a treatment plan from upstream metrics via CLI args', async () => {
    const plan = await runPythonTreatment({ risk_tier: 'HIGH', malignancy_class: 'ELITE_MALIGNANT', ter: 30.0, composite_score: 80.0 });
    expect(plan.success).toBe(true);
    expect(Array.isArray(plan.data.data)).toBe(true);
    expect(plan.data.data[0]).toHaveProperty('recommendation');
    expect(plan.data.data[0]).not.toHaveProperty('evidence_tier');
  }, PY_TIMEOUT);

  it('translates a term through the sports->biotech lexicon (E3 mapping)', async () => {
    const result = await runPythonTranslate('FG_PCT', 45.5, true);
    expect(result.success).toBe(true);
    expect(result.evidence_tier).toBe('E3');
    expect(Array.isArray(result.data.data)).toBe(true);
    expect(result.data.data[0]).toHaveProperty('target_term');
    expect(result.data.data[0]).toHaveProperty('target_value', 45.5);
    // Inner evidence_tier is redundant with PythonResult.evidence_tier, so it
    // is stripped at the boundary (same contract as the sports executors).
    expect(result.data.data[0]).not.toHaveProperty('evidence_tier');
    expect(validateOutput(result.data).valid).toBe(true);
  }, PY_TIMEOUT);
});

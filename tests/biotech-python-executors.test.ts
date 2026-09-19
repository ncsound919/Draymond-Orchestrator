import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runPythonAnalysis,
  runPythonTreatment,
  runPythonTranslate,
  runPythonHypothesis,
  runPythonVerification,
  runPythonChemlab,
} from '@/lib/biotech/pythonExecutors';
import { validateOutput } from '@/lib/biotech/validate';

describe('biotech python executors', () => {
  // These tests spawn a real Python subprocess (cold interpreter + numpy/pandas
  // imports). Under full-suite CPU load that can exceed vitest's 5s default
  // timeout, so give them a generous window.
  const PY_TIMEOUT = 60_000;

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

  it('generates a hypothesis from a target through the BlackMind engine', async () => {
    const result = await runPythonHypothesis({
      cancer_type: 'breast carcinoma',
      target: 'HER2',
      knowledge_base: 'clinical trial phase 3 efficacy survival',
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.data)).toBe(true);
    expect(result.data.data[0]).toHaveProperty('target', 'HER2');
    expect(result.data.data[0]).toHaveProperty('proposed_intervention');
    expect(result.data.data[0]).toHaveProperty('testable_prediction');
    expect(result.data.data[0]).toHaveProperty('critic_score');
    expect(result.data.data[0]).not.toHaveProperty('evidence_tier');
    expect(validateOutput(result.data).valid).toBe(true);
  }, PY_TIMEOUT);

  it('requires a target or cancer_type for hypothesis', async () => {
    const result = await runPythonHypothesis({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('target');
  });

  it('runs a CureForge Bayesian verification with a grounded prediction gate', async () => {
    const result = await runPythonVerification({
      target: 'HER2',
      prior: 0.55,
      is_success: true,
      claim: '(2+3)*4',
      expected: 20,
      hypothesis: {
        testable_prediction: 'Reduced proliferation index and increased apoptosis in tumor biopsy within 4 weeks.',
        mechanism: 'Inhibitory targeting of the dominant oncogenic driver.',
        confidence: 0.74,
      },
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.data)).toBe(true);
    const row = result.data.data[0];
    expect(row).toHaveProperty('posterior');
    expect(row).toHaveProperty('verification');
    expect(row.verification).toHaveProperty('verified', true);
    expect(row).toHaveProperty('prediction_gate');
    expect(row.prediction_gate).toHaveProperty('grounded', true);
    expect(row).not.toHaveProperty('evidence_tier');
    expect(validateOutput(result.data).valid).toBe(true);
  }, PY_TIMEOUT);

  it('requires a target for verification', async () => {
    const result = await runPythonVerification({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('target');
  });

  it('scores molecular risk through the Chemlab engine', async () => {
    const result = await runPythonChemlab({ smiles: 'CC(=O)Oc1ccccc1C(=O)O', k: 3 });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.data)).toBe(true);
    const row = result.data.data[0] as Record<string, unknown> & {
      analogues?: Array<{ name?: string }>;
    };
    expect(row).toHaveProperty('valid', true);
    expect(row).toHaveProperty('posterior_risk');
    expect(typeof row.posterior_risk).toBe('number');
    expect(row).toHaveProperty('analogues');
    expect(row.analogues?.[0]).toHaveProperty('name', 'aspirin');
    expect(row).not.toHaveProperty('evidence_tier');
    expect(validateOutput(result.data).valid).toBe(true);
  }, PY_TIMEOUT);

  it('requires smiles for chemlab', async () => {
    const result = await runPythonChemlab({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('smiles');
  });
});

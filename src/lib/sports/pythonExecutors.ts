import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { EvidenceTier } from './types';

const runFile = promisify(execFile);

function pythonCommand(): string {
  return process.env.SPORTS_PYTHON ?? 'python';
}

function repoRoot(): string {
  if (process.env.SPORTS_ROOT) return process.env.SPORTS_ROOT;
  // Next.js sets cwd to the project root; prefer it over __dirname, which
  // under bundling resolves inside .next/server chunks.
  return path.resolve(process.cwd());
}

async function runCli(script: string, args: string[]): Promise<{ stdout: string }> {
  const scriptPath = path.join(repoRoot(), 'sports_science', script);
  const { stdout } = await runFile(pythonCommand(), [scriptPath, ...args], {
    cwd: repoRoot(),
    env: { ...process.env, PYTHONPATH: repoRoot() },
    timeout: 60_000,
  });
  return { stdout };
}

// promisified execFile rejects on non-zero exit and discards stdout; the Python
// runners print a machine-readable {"error": ...} line to stdout, so recover it.
function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const raw = (err as { stdout?: string }).stdout;
  if (!raw) return message;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const candidate = (parsed as { error: unknown }).error;
      if (typeof candidate === 'string') return candidate;
    }
  } catch {
    // stdout was not JSON; keep the original message
  }
  return message;
}

export interface WrappedOutput<T = Record<string, unknown>> {
  /** Rows wrapped per the BlackMind ScienceEngine { data: [...] } contract. */
  data: T[];
  /**
   * Present on failure paths only — mirrors PythonResult.error so persisted
   * output is self-describing without breaking the gate's row-level checks.
   */
  error?: string;
}

export interface PythonResult {
  success: boolean;
  // Executor output always carries the { data: [...] } contract that the
  // validate gate's row-level checks run against; failed runs use an empty
  // rows array so a runtime failure is never mislabeled as malformed output.
  data: WrappedOutput;
  error: string | null;
  evidence_tier: EvidenceTier;
}

// BlackMind's ScienceEngine contract is { data: [...] } — every executor output
// is wrapped in an array at the boundary so the validateOutput gate produces
// real signal (a flat dict would always trip the 'missing data field' branch).
function wrap(data: Record<string, unknown>): WrappedOutput {
  // The Python CLIs print a flat dict (never the wrapped shape); guard anyway
  // so a future CLI change that emits { data: [...] } can't be double-wrapped.
  if ('data' in data) return data as unknown as WrappedOutput;
  return { data: [data] };
}

// The Python runners embed evidence_tier in their payloads, but the
// orchestration layer already tags results via PythonResult.evidence_tier and
// nothing downstream reads the inner copy, so strip it from the wrapped rows.
function stripInnerEvidenceTier(data: Record<string, unknown>): Record<string, unknown> {
  if ('evidence_tier' in data) {
    const copy = { ...data };
    delete copy.evidence_tier;
    return copy;
  }
  return data;
}

function failureData(message: string): WrappedOutput {
  return { data: [], error: message };
}

export async function runPythonMetrics(inputs?: Record<string, unknown>): Promise<PythonResult> {
  const dataset = String(inputs?.dataset ?? '');
  if (!dataset) {
    return {
      success: false,
      data: failureData('dataset required'),
      error: 'dataset required',
      evidence_tier: 'E1',
    };
  }
  try {
    const { stdout } = await runCli('run_metrics.py', ['session', 'basketball', dataset]);
    const data = JSON.parse(stdout);
    if (data.error) {
      return {
        success: false,
        data: failureData(data.error),
        error: data.error,
        evidence_tier: 'E1',
      };
    }
    return { success: true, data: wrap(stripInnerEvidenceTier(data)), error: null, evidence_tier: 'E1' };
  } catch (err) {
    const message = errorMessage(err);
    return { success: false, data: failureData(message), error: message, evidence_tier: 'E1' };
  }
}

export async function runPythonCoach(
  sport: string,
  metrics: Record<string, unknown>,
): Promise<PythonResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sports-'));
  const file = path.join(dir, 'dataset.json');
  try {
    fs.writeFileSync(file, JSON.stringify(metrics));
    const { stdout } = await runCli('run_coach.py', ['session', sport, file]);
    const data = JSON.parse(stdout);
    return {
      success: data.status === 'ok',
      data: wrap(stripInnerEvidenceTier(data)),
      error: data.message ?? null,
      evidence_tier: 'E1',
    };
  } catch (err) {
    const message = errorMessage(err);
    return { success: false, data: failureData(message), error: message, evidence_tier: 'E1' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runPythonTranslate(
  term: string,
  value?: number,
  fromSports = true,
): Promise<PythonResult> {
  if (!term) {
    return {
      success: false,
      data: failureData('term required'),
      error: 'term required',
      evidence_tier: 'E3',
    };
  }
  const args = ['session', term];
  if (value !== undefined) args.push('--value', String(value));
  if (!fromSports) args.push('--from_biotech');
  try {
    const { stdout } = await runCli('run_translate.py', args);
    const data = JSON.parse(stdout);
    return { success: true, data: wrap(stripInnerEvidenceTier(data)), error: null, evidence_tier: 'E3' };
  } catch (err) {
    const message = errorMessage(err);
    return { success: false, data: failureData(message), error: message, evidence_tier: 'E3' };
  }
}

export async function runPythonInsights(
  profile: Record<string, unknown>,
  fromBiotech = false,
): Promise<PythonResult> {
  if (!profile || Object.keys(profile).length === 0) {
    return {
      success: false,
      data: failureData('profile required'),
      error: 'profile required',
      evidence_tier: 'E3',
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sports-insights-'));
  const file = path.join(dir, 'profile.json');
  try {
    fs.writeFileSync(file, JSON.stringify(profile));
    const args = ['session', file];
    if (fromBiotech) args.push('--from_biotech');
    const { stdout } = await runCli('run_insights.py', args);
    const data = JSON.parse(stdout);
    if (data.error) {
      return { success: false, data: failureData(data.error), error: data.error, evidence_tier: 'E3' };
    }
    return { success: true, data: wrap(stripInnerEvidenceTier(data)), error: null, evidence_tier: 'E3' };
  } catch (err) {
    const message = errorMessage(err);
    return { success: false, data: failureData(message), error: message, evidence_tier: 'E3' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runPythonFormula(
  box: Record<string, unknown>,
  stat?: string,
): Promise<PythonResult> {
  if (!box || Object.keys(box).length === 0) {
    return {
      success: false,
      data: failureData('box score required'),
      error: 'box score required',
      evidence_tier: 'E1',
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formula-'));
  const file = path.join(dir, 'box.json');
  try {
    fs.writeFileSync(file, JSON.stringify(box));
    const args = ['session', file];
    if (stat) args.push('--stat', stat);
    const { stdout } = await runCli('../science_bridge/run_formula.py', args);
    const data = JSON.parse(stdout);
    if (data.error) {
      return { success: false, data: failureData(data.error), error: data.error, evidence_tier: 'E1' };
    }
    return { success: true, data: wrap(stripInnerEvidenceTier(data)), error: null, evidence_tier: 'E1' };
  } catch (err) {
    const message = errorMessage(err);
    return { success: false, data: failureData(message), error: message, evidence_tier: 'E1' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runPythonLayers(
  terms: string[],
  layer: string,
  fromSports = true,
): Promise<PythonResult> {
  if (!terms || terms.length === 0) {
    return {
      success: false,
      data: failureData('terms required'),
      error: 'terms required',
      evidence_tier: 'E3',
    };
  }
  const args = ['session', terms.join(',')];
  if (layer && layer !== 'all') args.push('--layer', layer);
  if (!fromSports) args.push('--from_biotech');
  try {
    const { stdout } = await runCli('../science_bridge/run_layers.py', args);
    const data = JSON.parse(stdout);
    if (data.error) {
      return { success: false, data: failureData(data.error), error: data.error, evidence_tier: 'E3' };
    }
    return { success: true, data: wrap(stripInnerEvidenceTier(data)), error: null, evidence_tier: 'E3' };
  } catch (err) {
    const message = errorMessage(err);
    return { success: false, data: failureData(message), error: message, evidence_tier: 'E3' };
  }
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { EvidenceTier } from './types';

const runFile = promisify(execFile);

function pythonCommand(): string {
  return process.env.BIOTECH_PYTHON ?? 'python';
}

function repoRoot(): string {
  if (process.env.BIOTECH_ROOT) return process.env.BIOTECH_ROOT;
  // Next.js sets cwd to the project root; prefer it over __dirname, which
  // under bundling resolves inside .next/server chunks.
  return path.resolve(process.cwd());
}

async function runCli(script: string, args: string[]): Promise<{ stdout: string }> {
  const scriptPath = path.join(repoRoot(), 'biotech_science', script);
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
  error?: string;
}

export interface PythonResult {
  success: boolean;
  data: WrappedOutput;
  error: string | null;
  evidence_tier: EvidenceTier;
}

// BlackMind's ScienceEngine contract is { data: [...] } — every executor output
// is wrapped in an array at the boundary so the validateOutput gate produces
// real signal (a flat dict would always trip the 'missing data field' branch).
function wrap(data: Record<string, unknown>): WrappedOutput {
  if ('data' in data) return data as unknown as WrappedOutput;
  return { data: [data] };
}

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

export async function runPythonAnalysis(inputs?: Record<string, unknown>): Promise<PythonResult> {
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
    const { stdout } = await runCli('run_analysis.py', ['session', dataset]);
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

export async function runPythonTreatment(metrics: Record<string, unknown>): Promise<PythonResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biotech-'));
  const file = path.join(dir, 'metrics.json');
  try {
    fs.writeFileSync(file, JSON.stringify(metrics));
    const { stdout } = await runCli('run_treatment.py', ['session', file]);
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
  if (value !== undefined) {
    args.push('--value', String(value));
  }
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

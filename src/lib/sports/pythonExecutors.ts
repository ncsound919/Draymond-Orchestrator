import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { EvidenceTier } from './types';
import type { PersistResult } from '@/lib/science/trendsFeed';

const runFile = promisify(execFile);

function pythonCommand(): string {
  return process.env.SPORTS_PYTHON ?? 'python';
}

function repoRoot(): string {
  if (process.env.SPORTS_ROOT) return process.env.SPORTS_ROOT;
  // Next.js sets cwd to the project root; prefer it over __dirname, which
  // under bundling resolves inside .next/server chunks.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd());
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
  /**
   * Present on successful insight runs only — the automatic trends-store
   * persistence of the bbtech InsightReport (single choke point, see
   * persistInsightReport). Undefined when persistence is skipped or failed.
   */
  persisted?: PersistResult;
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

// Single choke point for bbtech insight persistence: every successful
// runPythonInsights report lands in the science_insights trends store. The
// Python runner's graded evidence tier is captured BEFORE stripInnerEvidenceTier
// removes the inner copy, so the tier survives end-to-end into the stored row.
// Best-effort: a storage failure degrades to a warning, never a failed run.
async function persistBbtechReport(
  report: unknown,
  fromBiotech: boolean,
  gradedTier: string | null,
): Promise<PersistResult | undefined> {
  try {
    const { persistInsightReport } = await import('@/lib/science/trendsFeed');
    return await persistInsightReport(report, {
      source: 'bbtech',
      domain: fromBiotech ? 'biotech' : 'sports',
      ...(gradedTier ? { evidenceTier: gradedTier } : {}),
    });
  } catch (err) {
    try {
      console.warn(
        '[sports] bbtech insight persistence degraded',
        err instanceof Error ? err.message : err,
      );
    } catch {
      // logging itself must never throw
    }
    return undefined;
  }
}

// Research-gap escalation rides the SAME choke point: after a successful
// insight persist, run_gaps.py scans the persisted report deterministically
// and findings are escalated into draymond.db + the research brain.
// Fail-soft end-to-end — an unavailable python runtime or storage is recorded
// as a warning, never a failed run.
async function detectAndEscalateGaps(report: Record<string, unknown>): Promise<void> {
  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-scan-'));
    const file = path.join(dir, 'report.json');
    fs.writeFileSync(file, JSON.stringify(report));
    const { stdout } = await runCli('run_gaps.py', [file]);
    const parsed = JSON.parse(stdout) as { ok?: boolean; gaps?: unknown[] };
    if (parsed.ok !== true || !Array.isArray(parsed.gaps) || parsed.gaps.length === 0) return;
    const { escalateGaps } = await import('@/lib/science/researchEscalation');
    const escalated = await escalateGaps(parsed.gaps);
    if (!escalated.ok) {
      console.warn('[sports] gap escalation degraded', escalated.errors.slice(0, 3));
    }
  } catch (err) {
    try {
      console.warn(
        '[sports] gap detection degraded',
        err instanceof Error ? err.message : err,
      );
    } catch {
      // logging itself must never throw
    }
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
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
    // Capture the Python-graded tier before the inner copy is stripped, then
    // auto-persist the report into the trends store (bbtech feed).
    const gradedTier = typeof data.evidence_tier === 'string' ? data.evidence_tier : null;
    const wrapped = wrap(stripInnerEvidenceTier(data));
    const persisted = await persistBbtechReport(wrapped.data[0], fromBiotech, gradedTier);
    if (persisted?.ok) {
      await detectAndEscalateGaps(wrapped.data[0] as Record<string, unknown>);
    }
    return {
      success: true,
      data: wrapped,
      error: null,
      evidence_tier: 'E3',
      ...(persisted ? { persisted } : {}),
    };
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

// Metrics Lab: the most conservative per-metric tier becomes the row tier so a
// single E4 unavailable composite is never persisted as if it were measured.
function worstEvidenceTier(metrics: unknown): EvidenceTier | null {
  const order: EvidenceTier[] = ['E1', 'E2', 'E3', 'E4'];
  let worst: EvidenceTier | null = null;
  if (!Array.isArray(metrics)) return worst;
  for (const metric of metrics) {
    const tier = (metric as { evidence_tier?: unknown })?.evidence_tier;
    if (typeof tier === 'string' && order.includes(tier as EvidenceTier)) {
      if (!worst || order.indexOf(tier as EvidenceTier) > order.indexOf(worst)) {
        worst = tier as EvidenceTier;
      }
    }
  }
  return worst;
}

// Metrics Lab persistence rides the SAME trends-store choke point as insights,
// tagged source='bbtech_metrics_lab' + metricKind='derived' so trend queries
// can separate raw vs lab-generated stats. Best-effort like persistBbtechReport.
async function persistDerivedMetrics(
  report: Record<string, unknown>,
  sessionId: string,
  domain: string | undefined,
  gradedTier: string | null,
): Promise<PersistResult | undefined> {
  try {
    const { persistInsightReport } = await import('@/lib/science/trendsFeed');
    return await persistInsightReport(report, {
      source: 'bbtech_metrics_lab',
      sessionId,
      ...(domain ? { domain } : {}),
      ...(gradedTier ? { evidenceTier: gradedTier } : {}),
      metricKind: 'derived',
    });
  } catch (err) {
    try {
      console.warn(
        '[sports] metrics lab persistence degraded',
        err instanceof Error ? err.message : err,
      );
    } catch {
      // logging itself must never throw
    }
    return undefined;
  }
}

export async function runPythonDerive(
  sessionId: string,
  profile?: string | Record<string, unknown>,
  domain?: string,
): Promise<PythonResult> {
  if (!sessionId || !sessionId.trim()) {
    return {
      success: false,
      data: failureData('session_id required'),
      error: 'session_id required',
      evidence_tier: 'E4',
    };
  }
  let profilePath: string | null = null;
  let dir: string | null = null;
  try {
    if (typeof profile === 'string') {
      profilePath = profile;
    } else if (profile && Object.keys(profile).length > 0) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-lab-'));
      profilePath = path.join(dir, 'profile.json');
      fs.writeFileSync(profilePath, JSON.stringify(profile));
    } else {
      // No inline profile: fall back to the shared NBA dataset profiles dir
      // keyed by session id (same source syncBbtechInsights drains).
      profilePath = path.join(repoRoot(), 'datasets', 'sports', 'nba', 'profiles', `${sessionId}.json`);
    }
    const args = [sessionId, profilePath];
    if (domain === 'sports' || domain === 'biotech') args.push('--domain', domain);
    const { stdout } = await runCli('run_derive.py', args);
    const data = JSON.parse(stdout);
    if (data.error) {
      return { success: false, data: failureData(data.error), error: data.error, evidence_tier: 'E4' };
    }
    if (!Array.isArray(data.metrics) || data.metrics.length === 0) {
      const message = 'runner produced no metrics';
      return { success: false, data: failureData(message), error: message, evidence_tier: 'E4' };
    }
    const gradedTier = worstEvidenceTier(data.metrics);
    const wrapped = wrap(stripInnerEvidenceTier(data));
    const persisted = await persistDerivedMetrics(
      wrapped.data[0],
      sessionId,
      typeof data.domain === 'string' ? data.domain : domain,
      gradedTier,
    );
    return {
      success: true,
      data: wrapped,
      error: null,
      evidence_tier: gradedTier ?? 'E4',
      ...(persisted ? { persisted } : {}),
    };
  } catch (err) {
    const message = errorMessage(err);
    return { success: false, data: failureData(message), error: message, evidence_tier: 'E4' };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * science/sim.ts â€” TS shell-out to the Python simulation runtime.
 *
 * Runs `python -m science_engine.cli <model> [ticks] [--params '...']` from the
 * repo root. Mirrors the sports/biotech pythonExecutor pattern: spawns a
 * subprocess, parses machine-readable JSON stdout, and degrades to an
 * error-shaped result on non-zero exit.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runFile = promisify(execFile);

export interface SimTick {
  tick: number;
  [stateVar: string]: number | string;
}

export interface SimulationOutput {
  model_id: string;
  ticks: number;
  series: SimTick[];
  events_triggered: Array<{ tick: number; action: string }>;
  final_state: Record<string, number>;
  outputs: Record<string, number>;
  evidence_tier: string;
  error?: string;
}

function repoRoot(): string {
  if (process.env.SCIENCE_ROOT) return process.env.SCIENCE_ROOT;
  // Next.js sets cwd to the project root; prefer it over __dirname, which
  // under bundling resolves inside .next/server chunks.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd());
}

function pythonCommand(): string {
  return process.env.SCIENCE_PYTHON ?? 'python';
}

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

/** Run a model by model_id from the science_engine/models directory. */
export async function runModelById(modelId: string, ticks?: number, params?: Record<string, number>): Promise<SimulationOutput> {
  const modelPath = path.join(repoRoot(), 'science_engine', 'models', `${modelId}.json`);
  if (!fs.existsSync(modelPath)) {
    return {
      model_id: modelId,
      ticks: 0,
      series: [],
      events_triggered: [],
      final_state: {},
      outputs: {},
      evidence_tier: 'E4',
      error: `model not found: ${modelId}`,
    };
  }
  const args = [modelPath];
  if (ticks !== undefined) args.push(String(ticks));
  if (params && Object.keys(params).length > 0) {
    args.push('--params', JSON.stringify(params));
  }
  try {
    const { stdout } = await runFile(pythonCommand(), ['-m', 'science_engine.cli', ...args], {
      cwd: repoRoot(),
      env: { ...process.env, PYTHONPATH: repoRoot() },
      timeout: 60_000,
    });
    const data = JSON.parse(stdout) as SimulationOutput;
    if (data.error) return { ...data, error: data.error };
    const clean: SimulationOutput = {
      model_id: data.model_id,
      ticks: data.ticks,
      series: data.series,
      events_triggered: data.events_triggered,
      final_state: data.final_state,
      outputs: data.outputs,
      evidence_tier: data.evidence_tier,
    };
    return clean;
  } catch (err) {
    const message = errorMessage(err);
    return {
      model_id: modelId,
      ticks: 0,
      series: [],
      events_triggered: [],
      final_state: {},
      outputs: {},
      evidence_tier: 'E4',
      error: message,
    };
  }
}

/** Run a model from an explicit JSON file path. */
export async function runModelFile(modelPath: string, ticks?: number, params?: Record<string, number>): Promise<SimulationOutput> {
  if (!fs.existsSync(modelPath)) {
    return {
      model_id: path.basename(modelPath, '.json'),
      ticks: 0,
      series: [],
      events_triggered: [],
      final_state: {},
      outputs: {},
      evidence_tier: 'E4',
      error: `model file not found: ${modelPath}`,
    };
  }
  const args = [modelPath];
  if (ticks !== undefined) args.push(String(ticks));
  if (params && Object.keys(params).length > 0) {
    args.push('--params', JSON.stringify(params));
  }
  try {
    const { stdout } = await runFile(pythonCommand(), ['-m', 'science_engine.cli', ...args], {
      cwd: repoRoot(),
      env: { ...process.env, PYTHONPATH: repoRoot() },
      timeout: 60_000,
    });
    const data = JSON.parse(stdout) as SimulationOutput;
    if (data.error) return { ...data, error: data.error };
    const clean: SimulationOutput = {
      model_id: data.model_id,
      ticks: data.ticks,
      series: data.series,
      events_triggered: data.events_triggered,
      final_state: data.final_state,
      outputs: data.outputs,
      evidence_tier: data.evidence_tier,
    };
    return clean;
  } catch (err) {
    const message = errorMessage(err);
    return {
      model_id: path.basename(modelPath, '.json'),
      ticks: 0,
      series: [],
      events_triggered: [],
      final_state: {},
      outputs: {},
      evidence_tier: 'E4',
      error: message,
    };
  }
}

/** Write a model JSON to a temp file and run it. */
export async function runModelSpec(spec: Record<string, unknown>, ticks?: number): Promise<SimulationOutput> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'science-sim-'));
  const file = path.join(dir, 'model.json');
  try {
    fs.writeFileSync(file, JSON.stringify(spec));
    const params = spec.params && typeof spec.params === 'object' ? (spec.params as Record<string, number>) : undefined;
    return await runModelFile(file, ticks, params);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

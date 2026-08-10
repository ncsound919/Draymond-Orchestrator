// ============================================================================
// DRAYMOND BIOTECH ENGINE — output validation gate
// ============================================================================
// Validates executor results against the BlackMind { data: [...] } contract
// before persisting. Deterministic: same result → same verdict.
//
// Accepts EITHER the full PythonResult ({ success, data: { data: [...] } })
// OR a bare WrappedOutput ({ data: [...] }) — both call sites in the codebase
// use one of these shapes (api.ts passes task.result; the executors test passes
// result.data).
// ============================================================================

import type { PythonResult, WrappedOutput } from './pythonExecutors';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type MaybeResult = Partial<PythonResult> | Partial<WrappedOutput>;

/** Extract the { data: [...] } payload whether given a PythonResult or WrappedOutput. */
function unwrapData(result: MaybeResult): unknown {
  if (result && typeof result === 'object' && 'data' in result) {
    const d = (result as { data: unknown }).data;
    // PythonResult.data is a WrappedOutput -> recurse one level.
    if (d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data)) {
      return (d as { data: unknown }).data;
    }
    return d;
  }
  return undefined;
}

export function validateOutput(result: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof result !== 'object' || result === null) {
    return { valid: false, errors: ['result must be an object'] };
  }
  const r = result as MaybeResult;

  // PythonResult failure flag (if present).
  if ((r as Partial<PythonResult>).success === false) {
    const err = (r as Partial<PythonResult>).error;
    errors.push(err ? `executor reported failure: ${err}` : 'executor reported failure');
  }

  const dataArr = unwrapData(r);
  if (dataArr === undefined) {
    errors.push('missing data field');
  } else if (!Array.isArray(dataArr)) {
    errors.push('data must be an array (BlackMind contract)');
  } else if (dataArr.length === 0 && !(r as Partial<WrappedOutput>).error) {
    errors.push('data array is empty');
  }

  return { valid: errors.length === 0, errors };
}

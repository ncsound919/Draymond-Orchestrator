/**
 * useSymPyVerifier — derivation verification via /api/math/verify +
 * local SymPy execution in the shared Pyodide worker.
 * Adapted from @mathx/web to Draymond's /api/math/* contract.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPyodideManager } from './PyodideWorkerManager';

export type VerificationStatus = 'pending' | 'verifying' | 'VERIFIED' | 'UNVERIFIED' | 'ERROR' | 'skipped';

export interface VerifyResult {
  id: string;
  status: VerificationStatus;
  error?: string;
  sympy_code?: string;
}

export interface VerifyDerivationResult {
  steps: Array<{
    step: number;
    description: string;
    from_expr: string;
    to_expr: string;
    operation: string;
    verifiable: boolean;
    verification: { verified: boolean | null; method: string; error?: string };
  }>;
  summary: { total: number; verified: number; failed: number; not_verifiable: number; trust_score: number };
}

export function useSymPyVerifier() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const manager = getPyodideManager();
    // Route readiness through the async channel (avoids setState-in-effect).
    manager
      .run('from sympy import symbols; pass')
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        /* will surface as ERROR on first verify call */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Execute a SymPy verification script locally; returns stdout or ERROR:. */
  const verifyCode = useCallback(
    async (id: string, code: string): Promise<string> => {
      if (!ready) return 'ERROR: verifier not ready';
      try {
        return await getPyodideManager().run(code);
      } catch (err) {
        return `ERROR: ${String(err)}`;
      }
    },
    [ready],
  );

  /** Full pipeline: extract steps via API, verify each locally, merge verdicts. */
  const verifyDerivation = useCallback(
    async (expression: string): Promise<VerifyDerivationResult> => {
      const empty: VerifyDerivationResult = {
        steps: [],
        summary: { total: 0, verified: 0, failed: 0, not_verifiable: 0, trust_score: 0 },
      };
      if (!ready) return empty;

      const extractRes = await fetch('/api/math/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression }),
      });
      if (!extractRes.ok) return empty;
      const extracted = (await extractRes.json()) as {
        steps: VerifyDerivationResult['steps'];
        sympyCode: string;
        numVerifiable: number;
        numTotal: number;
      };
      if (!extracted.steps?.length) return empty;

      const stdout = await verifyCode('verify', extracted.sympyCode);
      let sympyResults: Array<{ step: number; verified: boolean; method: string }> = [];
      try {
        const parsed = JSON.parse(stdout) as { results?: Array<{ step: number; verified: boolean; method: string }> };
        sympyResults = parsed.results ?? [];
      } catch {
        sympyResults = [];
      }

      const mergeRes = await fetch('/api/math/verify/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: extracted.steps, sympyResults }),
      });
      if (!mergeRes.ok) return empty;
      const merged = (await mergeRes.json()) as { steps: VerifyDerivationResult['steps']; summary: VerifyDerivationResult['summary'] };
      return merged;
    },
    [ready, verifyCode],
  );

  return { ready, verifyDerivation, verifyCode };
}

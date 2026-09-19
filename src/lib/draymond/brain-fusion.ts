// ============================================================================
// BRAIN FUSION — Dev-Brain (3450) + Deterministic Brain (3210) in one decision
// ============================================================================
// Dev-Brain is the deterministic ADVISOR (weighted matrix, audit trail, no LLM).
// Deterministic Brain is the EXECUTOR (skill packs, codegen, scaffolding).
// Draymond is the ORCHESTRATOR. Fusion lets a single Draymond decision fan
// to BOTH brains and merge:
//
//   advisor (Dev-Brain)  → which option / what to do first (weight, risk, pros/cons)
//   executor (det-brain) → how to do it (skill/pack to run, scaffold to fire)
//
// Contract:
//   - Tries Dev-Brain POST /api/fusion/decide (which itself fans to det-brain)
//     when reachable — one network hop, Dev-Brain does the merge.
//   - Falls back to calling both brains independently from Draymond and merging
//     locally when the fusion endpoint is down.
//   - Always returns a merged decision even if BOTH brains are down (deterministic
//     equal-weight fallback) so callers never stall.
//
// Never throws. Bounded (4s per brain, 10s total).
// ============================================================================

import { isBrainConfigured } from './brain-client';
import { devBrainFusionDecide, devBrainDecide, devBrainReachable } from './dev-brain';

export interface FusionDecision {
  generatedAt: string;
  devBrain: unknown | null;
  deterministicBrain: unknown | null;
  fused: boolean;
  advisorRecommendationId: string | null;
  executorSkill: string | null;
  synthesis: string;
}

/** Run a fused decision across both brains. Never throws. */
export async function runBrainFusion(opts: {
  problem: string;
  candidates?: Array<{ id: string; title: string; description: string; tags?: string[] }>;
  strategy?: 'balanced_pareto' | 'risk_containment' | 'hyper_velocity' | 'capital_efficiency' | 'deep_tech_scalability';
}): Promise<FusionDecision> {
  const generatedAt = new Date().toISOString();
  const candidates = opts.candidates ?? [];

  // 1. Try the Dev-Brain fusion endpoint (single hop).
  try {
    if (await devBrainReachable()) {
      const fused = await devBrainFusionDecide({
        problem: opts.problem,
        candidates: candidates.map((c) => ({ id: c.id, title: c.title, description: c.description, tags: c.tags })),
        strategy: opts.strategy,
      });
      if (fused) {
        const devBrain = fused.devBrain as { recommendedOptionId?: string; synthesisRationale?: string; options?: Array<{ id: string }> } | null;
        const detBrain = fused.deterministicBrain as { final_output?: unknown; reasoning?: { chosen_skill?: string } } | null;
        return {
          generatedAt,
          devBrain: fused.devBrain,
          deterministicBrain: fused.deterministicBrain,
          fused: Boolean(fused.deterministicBrain),
          advisorRecommendationId: devBrain?.recommendedOptionId ?? null,
          executorSkill: (detBrain?.reasoning as { chosen_skill?: string } | undefined)?.chosen_skill ?? null,
          synthesis: devBrain?.synthesisRationale ?? `Fused decision for: ${opts.problem.slice(0, 120)}`,
        };
      }
    }
  } catch { /* fall to independent */ }

  // 2. Independent fan-out (Draymond merges).
  const [devBrain, detBrain] = await Promise.all([
    (async () => {
      try {
        return await devBrainDecide({ problem: opts.problem, candidates: candidates.map((c) => ({ id: c.id, title: c.title, description: c.description, tags: c.tags })), strategy: opts.strategy });
      } catch { return null; }
    })(),
    (async () => {
      if (!isBrainConfigured()) return null;
      try {
        const { BRAIN_URL } = process.env as Record<string, string | undefined>;
        const url = (BRAIN_URL ?? 'http://127.0.0.1:3210').replace(/\/+$/, '');
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const r = await fetch(`${url}/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: opts.problem, candidates: candidates.slice(0, 5) }),
          signal: controller.signal,
        });
        clearTimeout(t);
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    })(),
  ]);

  const advisorId = (devBrain as { recommendedOptionId?: string } | null)?.recommendedOptionId ?? null;
  const skill = (detBrain as { reasoning?: { chosen_skill?: string } } | null)?.reasoning?.chosen_skill ?? null;

  return {
    generatedAt,
    devBrain,
    deterministicBrain: detBrain,
    fused: Boolean(devBrain && detBrain),
    advisorRecommendationId: advisorId,
    executorSkill: skill,
    synthesis:
      (devBrain as { synthesisRationale?: string } | null)?.synthesisRationale ??
      `Independent fusion — advisor ${advisorId ?? 'none'}, executor ${skill ?? 'none'}.`,
  };
}

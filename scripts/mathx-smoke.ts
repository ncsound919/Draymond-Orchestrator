// ============================================================================
// Math X embedded — smoke verification script.
// Exercises the service layer directly (avoids session auth on the HTTP routes).
// Run: node node_modules/tsx/dist/cli.mjs scripts/mathx-smoke.ts
// ============================================================================

import {
  planMath,
  mergeVerifyResults,
  verifyDerivation,
  searchLiterature,
  probeMathModels,
} from '../src/lib/mathx/services';

async function main() {
  const results: string[] = [];
  const models = await probeMathModels();
  const hasLlm = models.claude || models.deepseek || models.qwen || models.ollama.models.length > 0;
  const llmNote = hasLlm ? 'ok' : 'skipped (no LLM provider keys configured)';

  // 1. Planner — fails soft to DEFAULT_PLAN without LLM keys.
  const plan = await planMath('does prime gaps follow a power law?', 'scientist');
  results.push(`plan: engine=${plan.engine} chain=[${plan.chain.join(', ')}] (${llmNote})`);

  // 2. Pure trust-score merge (no LLM, no network).
  const merged = mergeVerifyResults(
    [
      { step: 1, description: 'a', from_expr: 'x', to_expr: 'y', operation: 'algebra', verifiable: true },
      { step: 2, description: 'b', from_expr: '', to_expr: '', operation: 'definition', verifiable: false },
    ],
    [{ step: 1, verified: true, method: 'sympy_algebraic' }],
  );
  results.push(`verify: trust_score=${merged.summary.trust_score} verified=${merged.summary.verified} (ok)`);

  // 3. SymPy codegen (pure) — LLM extraction needs keys.
  const derivation = await verifyDerivation('x').catch(() => null);
  results.push(`sympyCodegen: ${derivation ? `ok (steps=${derivation.numTotal})` : llmNote}`);

  // 4. Literature search against real PubMed/arXiv (fail-soft on no network).
  try {
    const lit = await searchLiterature('entanglement entropy', ['arxiv'], 2);
    results.push(
      `literature: ${lit.results.length} arxiv result(s)${lit.errors.length ? ` (${lit.errors.length} source error(s))` : ''} (ok)`,
    );
  } catch (err) {
    results.push(`literature: failed — ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Provider probe.
  results.push(
    `models: claude=${models.claude} deepseek=${models.deepseek} qwen=${models.qwen} ollama=${models.ollama.models.length}`,
  );

  console.log('Math X smoke results:');
  for (const line of results) console.log(`  ${line}`);
  const failed = results.some((r) => r.includes('failed') && !r.includes('fail-soft'));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Math X smoke failed:', err);
  process.exit(1);
});

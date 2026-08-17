/**
 * Print the deterministic-fallback coverage report for the Draymond core.
 * Run from Draymond-Orchestrator/:
 *   npx tsx scripts/fallback-coverage.ts
 *
 * Shows how many of the fleet's LLM functions have a registered deterministic
 * fallback (the "stays productive when every LLM is down" metric), the current
 * degraded-mode state, and the list of still-uncovered functions.
 */
async function main() {
  // Install the registry entries (same as bootstrap does at boot).
  const { installFallbackRegistry } = await import('../src/lib/draymond/fallback-registry');
  installFallbackRegistry();

  const { getFallbackCoverage, printFallbackCoverage } = await import('../src/lib/draymond/fallbacks');
  printFallbackCoverage();
  const cov = getFallbackCoverage();
  console.log('');
  console.log(`Known LLM functions:        ${cov.total}`);
  console.log(`With deterministic fallback: ${cov.covered}`);
  console.log(`Coverage:                    ${cov.pct}%`);
  console.log(`Degraded mode:               ${cov.degraded ? 'ON' : 'OFF'}`);
}

main().catch((err) => {
  console.error('[fallback-coverage] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

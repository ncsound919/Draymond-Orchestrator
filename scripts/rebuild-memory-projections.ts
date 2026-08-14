// Rebuild the memory search projections from the canonical .draymond brain state.
// The .draymond/*.json files are the single writable store; this re-indexes them
// into draymond_memory with source_event provenance so every projection can be
// dropped and rebuilt losslessly. Idempotent.
//
// Usage: npm run memory:rebuild
import { rebuildProjectionsFromBrainState } from '../src/lib/draymond/memory-intelligence';

async function main() {
  const result = await rebuildProjectionsFromBrainState();
  console.log(
    `Memory projections rebuilt: ${result.indexed} rows indexed, ${result.skipped} skipped.`
  );
}

main().catch((err) => {
  console.error('Rebuild failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

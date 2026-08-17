#!/usr/bin/env node
// ============================================================================
// Prune .next build output before a build.
// ============================================================================
// The .next directory accumulates tens of thousands of stale traced files
// (43k+ after a few builds in this repo). A stale .next forces Turbopack's
// file tracer to walk the whole ecosystem workspace and bloats the standalone
// output, which is what makes `next build` hang. Run as `npm run clean` or
// automatically before every build via `prebuild`.
//
// Keeps the Turbopack incremental cache out of scope: the cache lives under
// node_modules/.cache, not .next, so pruning .next is always safe.
// ============================================================================

import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), '.next');

// Allow `npm run clean -- --keep 0` style future flags; keep it dead simple.
const dryRun = process.argv.includes('--dry-run');

if (!existsSync(root)) {
  console.log('[prune-next] no .next directory — nothing to do.');
  process.exit(0);
}

let count = 0;
try {
  if (dryRun) {
    count = readdirSync(root).length;
  } else {
    rmSync(root, { recursive: true, force: true });
  }
} catch (err) {
  // EBUSY/EPERM: a running dev server or a live service holds open handles
  // on traced files. Fail loudly so the build doesn't proceed half-pruned.
  console.error('[prune-next] failed to remove .next:', err instanceof Error ? err.message : err);
  process.exit(1);
}

if (dryRun) {
  console.log(`[prune-next] dry-run: would remove ${join('.', '.next')} (${count} top-level entries).`);
} else {
  console.log(`[prune-next] removed ${join('.', '.next')}.`);
}

#!/usr/bin/env node
// ============================================================================
// Copy client assets into the standalone output after a build.
// ============================================================================
// `next build` with `output: 'standalone'` does NOT copy `.next/static` or
// `public` into `.next/standalone`. Without them the server renders the HTML
// shell but every /_next/static chunk 404s, so the UI never hydrates.
// Run automatically after every build via the npm `postbuild` hook.
// ============================================================================

import { cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const standaloneRoot = join(root, '.next', 'standalone');

if (!existsSync(standaloneRoot)) {
  console.error('[postbuild] .next/standalone missing — was the build standalone?');
  process.exit(1);
}

// When TURBOPACK_ROOT is a parent directory (pnpm-store junction layout), the
// standalone server nests at .next/standalone/<relative-app-path>/server.js.
const nested = join(standaloneRoot, root.split(/[\\/]/).pop() ?? '');
const standalone = existsSync(join(nested, 'server.js')) ? nested : standaloneRoot;

const copies = [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
];

for (const [src, dest] of copies) {
  if (!existsSync(src)) {
    console.log(`[postbuild] skip (no source): ${src}`);
    continue;
  }
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`[postbuild] copied ${src} -> ${dest}`);
}

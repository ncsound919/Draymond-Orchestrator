#!/usr/bin/env node
// Dry-run the free catalog sync — probes endpoints, prints result, NO file writes.
// Usage: node scripts/freeCatalogDryRun.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Load env from .env.local
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const modulePath = pathToFileURL(resolve(process.cwd(), 'src/lib/draymond/freeCatalogSync.ts')).href;

try {
  const { runFreeCatalogSync } = await import(modulePath);
  console.log('Running free catalog dry-run...');
  const result = await runFreeCatalogSync({ dryRun: true });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Dry-run failed:', err);
  process.exit(1);
}

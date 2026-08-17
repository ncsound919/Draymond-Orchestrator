#!/usr/bin/env node
// ============================================================================
// Verify build determinism + artifact integrity for the Draymond standalone
// build. Mirrors the kernel's -INCREMENTAL:NO / reproducible-build posture:
//   1. Assert the artifacts pm2 actually starts exist
//      (.next/standalone/server.js, package.json, .next/BUILD_ID).
//   2. Record a build manifest (git sha, artifact hashes, timestamp) to
//      data/build-manifest.json so the running fleet can be matched to a build
//      and rebuilds are auditable.
//   3. In --verify mode, compare current artifacts against the recorded
//      manifest and fail on mismatch (stale/drifted build detection).
//
// A build that produced no server must never be treated as success.
//
// Env knobs:
//   DRAYMOND_BUILD_VERIFY=0  — skip entirely (partial builds only)
//   DRAYMOND_BUILD_STRICT=1  — fail when the manifest cannot be written
// ============================================================================

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(process.cwd());

const REQUIRED_ARTIFACTS = [
  '.next/standalone/server.js',
  '.next/standalone/package.json',
  '.next/BUILD_ID',
];

const HASHED_ARTIFACTS = [
  '.next/standalone/server.js',
  '.next/BUILD_ID',
];

const MANIFEST_PATH = join(ROOT, 'data', 'build-manifest.json');

function sha256(filePath) {
  const abs = join(ROOT, filePath);
  if (!existsSync(abs)) return null;
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function collectArtifacts() {
  const artifacts = {};
  for (const rel of HASHED_ARTIFACTS) artifacts[rel] = sha256(rel);
  return artifacts;
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function assertRequired() {
  const missing = REQUIRED_ARTIFACTS.filter((rel) => !existsSync(join(ROOT, rel)));
  if (missing.length > 0) {
    console.error(`[verify-build] MISSING required artifacts:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
}

if (process.env.DRAYMOND_BUILD_VERIFY === '0') {
  console.log('[verify-build] skipped (DRAYMOND_BUILD_VERIFY=0)');
  process.exit(0);
}

const mode = process.argv.includes('--verify') ? 'verify' : 'record';

if (mode === 'record') {
  assertRequired();
  const manifest = {
    buildId: sha256('.next/BUILD_ID'),
    gitSha: gitSha(),
    artifacts: collectArtifacts(),
    recordedAt: new Date().toISOString(),
  };
  try {
    // data/ may not exist on a fresh checkout — the manifest needs a home.
    mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    console.log(`[verify-build] recorded manifest (git ${manifest.gitSha ?? 'n/a'}, ${REQUIRED_ARTIFACTS.length} artifacts checked)`);
  } catch (err) {
    if (process.env.DRAYMOND_BUILD_STRICT === '1') {
      console.error(`[verify-build] failed to write manifest: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    console.warn(`[verify-build] manifest write skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
} else {
  assertRequired();
  const recorded = readManifest();
  if (!recorded) {
    console.error('[verify-build] no recorded manifest — run a build first (or build-draymond.bat)');
    process.exit(1);
  }
  const current = collectArtifacts();
  const drifted = Object.keys(current).filter(
    (rel) => recorded.artifacts?.[rel] && recorded.artifacts[rel] !== current[rel],
  );
  if (drifted.length > 0) {
    console.error(`[verify-build] DRIFT detected vs manifest (git ${recorded.gitSha ?? 'n/a'}):\n  ${drifted.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`[verify-build] artifacts match manifest (git ${recorded.gitSha ?? 'n/a'}, recorded ${recorded.recordedAt})`);
}

#!/usr/bin/env tsx
/**
 * OSS tool setup for the expanded code-review suite.
 *
 * Installs/verifies the open-source tools the new suite runners depend on:
 *   - Semgrep    (SAST / dataflow)        pip install semgrep
 *   - gitleaks   (secrets)                winget Gitleaks.Gitleaks
 *   - trivy      (container/IaC/secret)   winget AquaSecurity.Trivy
 *   - checkov    (IaC)                    pip install checkov
 *   - hadolint   (Dockerfile)             download binary (already bundled in scripts/tools)
 *   - osv-scanner (supply chain)          download binary (already bundled in scripts/tools)
 *   - ruff, bandit (Python)               pip install ruff bandit
 *
 * Run: npx tsx scripts/setup-suite-tools.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOLS_DIR = path.join(__dirname, 'tools');

function have(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[]): void {
  console.log(`\n>> ${cmd} ${args.join(' ')}`);
  try {
    const out = execFileSync(process.platform === 'win32' ? 'cmd.exe' : cmd, process.platform === 'win32' ? ['/c', cmd, ...args] : args, { encoding: 'utf8', stdio: 'inherit' });
    console.log(out);
  } catch (e) {
    console.error(`   FAILED: ${(e as Error).message}`);
  }
}

function download(url: string, dest: string): void {
  if (fs.existsSync(dest)) {
    console.log(`   already present: ${dest}`);
    return;
  }
  console.log(`>> download ${url}`);
  try {
    execFileSync('curl.exe', ['-L', '-s', '-o', dest, url, '--max-time', '180'], { stdio: 'inherit' });
    console.log(`   → ${dest} (${fs.statSync(dest).size} bytes)`);
  } catch (e) {
    console.error(`   FAILED: ${(e as Error).message}`);
  }
}

async function main() {
  console.log('=== Code Review Suite — OSS tool setup ===\n');
  fs.mkdirSync(TOOLS_DIR, { recursive: true });

  // Python tools (pip)
  if (!have('semgrep')) run('pip', ['install', 'semgrep']);
  if (!have('checkov')) run('pip', ['install', 'checkov']);
  if (!have('ruff')) run('pip', ['install', 'ruff']);
  if (!have('bandit')) run('pip', ['install', 'bandit']);

  // Go tools (winget)
  if (!have('gitleaks')) run('winget', ['install', '--id', 'Gitleaks.Gitleaks', '-e', '--accept-source-agreements', '--accept-package-agreements']);
  if (!have('trivy')) run('winget', ['install', '--id', 'AquaSecurity.Trivy', '-e', '--accept-source-agreements', '--accept-package-agreements']);

  // Bundled binaries (already copied into scripts/tools)
  download('https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Windows-x86_64.exe', path.join(TOOLS_DIR, 'hadolint.exe'));
  download('https://github.com/google/osv-scanner/releases/download/v2.5.0/osv-scanner_windows_amd64.exe', path.join(TOOLS_DIR, 'osv-scanner.exe'));

  console.log('\n=== Verification ===');
  for (const t of ['semgrep', 'gitleaks', 'trivy', 'checkov', 'ruff', 'bandit', 'cargo', 'go']) {
    console.log(`  ${have(t) ? 'OK ' : 'MISSING'} ${t}`);
  }
  for (const t of ['hadolint.exe', 'osv-scanner.exe']) {
    console.log(`  ${fs.existsSync(path.join(TOOLS_DIR, t)) ? 'OK ' : 'MISSING'} scripts/tools/${t}`);
  }
  console.log('\nDone. Re-run the suite to pick up new tools.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

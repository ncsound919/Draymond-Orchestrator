#!/usr/bin/env tsx
/**
 * Local Grader scorer (directory mode) — grades a local repository directory
 * via Grader's GradingService using the OpenCode Go LLM chain. No GitHub API,
 * no server, no DB required. Prints
 * { overallScore, gradeCategory, summary, mainLanguage, quickWins, security }
 * as JSON on stdout.
 *
 * Usage: npx tsx scripts/local-grader-dir.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { GradingService } from '../agents/Grader-main/src/server/services/gradingService.ts';
import { loadDotEnvLocal } from './lib/load-dotenv-local.ts';

const EXCLUDE = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.vite',
  'src-tauri', 'e2e', 'test-results', 'playwright-report', '.verification-sandbox',
  'test-docs', 'reports', 'docs', '.turbo', '.cache', '.github', 'public', 'assets',
]);

function collectFileList(root: string, limit = 80): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (EXCLUDE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|rb|php|json|md)$/.test(e.name)) {
        out.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return out;
}

async function main() {
  loadDotEnvLocal();
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-grader-dir.ts <localDir>');
    process.exit(1);
  }

  const root = path.resolve(target);
  const repoName = path.basename(root);

  let readmeStr = '';
  let packageJsonStr = '';
  for (const name of ['README.md', 'readme.md', 'README', 'Readme.md']) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      readmeStr = fs.readFileSync(p, 'utf8').slice(0, 20000);
      break;
    }
  }
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      packageJsonStr = fs.readFileSync(pkgPath, 'utf8').slice(0, 10000);
    } catch {
      /* ignore */
    }
  }

  const fileList = collectFileList(root);

  const report = await GradingService.gradeRepo(
    { repoUrl: root, owner: repoName, repo: repoName },
    { repoMeta: { name: repoName, language: guessLanguage(root) }, packageJsonStr, readmeStr, fileList }
  );

  console.log(
    JSON.stringify({
      overallScore: report.overallScore,
      gradeCategory: report.gradeCategory,
      summary: report.summary,
      mainLanguage: report.mainLanguage,
      quickWins: report.quickWins?.slice?.(0, 10) ?? [],
      security: report.security,
    })
  );
}

function guessLanguage(root: string): string {
  for (const name of ['tsconfig.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'pom.xml', 'package.json']) {
    if (fs.existsSync(path.join(root, name))) {
      if (name === 'go.mod') return 'Go';
      if (name === 'Cargo.toml') return 'Rust';
      if (name === 'pyproject.toml') return 'Python';
      if (name === 'pom.xml') return 'Java';
      if (name === 'tsconfig.json') return 'TypeScript';
      if (name === 'package.json') return 'TypeScript';
    }
  }
  return 'Unknown';
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

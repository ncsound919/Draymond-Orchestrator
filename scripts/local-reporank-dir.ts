#!/usr/bin/env tsx
/**
 * Local RepoRank scorer (directory mode) — grades a local repository directory
 * via RepoRank's GradingService (GoogleGenAI). No GitHub API, no server, no DB
 * required. Prints { overallScore, gradeCategory, summary, mainLanguage,
 * recommendations } as JSON on stdout.
 *
 * Usage: npx tsx scripts/local-reporank-dir.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { GradingService } from '../agents/reporank/packages/grading-engine/src/index.ts';
import { loadDotEnvLocal } from './lib/load-dotenv-local.ts';

const EXCLUDE = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.vite',
  'src-tauri', 'e2e', 'test-results', 'playwright-report', '.verification-sandbox',
  'test-docs', 'reports', 'docs', '.turbo', '.cache', '.github', 'public', 'assets',
]);

function collectFiles(root: string, limit = 120): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
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
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|rb|php)$/.test(e.name)) {
        try {
          const stat = fs.statSync(full);
          if (stat.size <= 0 || stat.size >= 300_000) continue;
          out.push({ path: path.relative(root, full).replace(/\\/g, '/'), content: fs.readFileSync(full, 'utf8') });
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(root);
  return out;
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

async function main() {
  loadDotEnvLocal();
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-reporank-dir.ts <localDir>');
    process.exit(1);
  }

  const root = path.resolve(target);
  const repoName = path.basename(root);

  let readmeContent = '';
  for (const name of ['README.md', 'readme.md', 'README', 'Readme.md']) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      readmeContent = fs.readFileSync(p, 'utf8').slice(0, 20000);
      break;
    }
  }
  let packageJson = '';
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      packageJson = fs.readFileSync(pkgPath, 'utf8').slice(0, 10000);
    } catch {
      /* ignore */
    }
  }

  const sourceFiles = collectFiles(root);
  const fileTree = sourceFiles.map((f) => f.path);

  const svc = new GradingService(process.env.GEMINI_API_KEY || '', process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const report = await svc.gradeRepo({
    repoUrl: root,
    repoName,
    repoOwner: repoName,
    mainLanguage: guessLanguage(root),
    starsCount: 0,
    forksCount: 0,
    openIssuesCount: 0,
    lastPushedAt: new Date().toISOString(),
    readmeContent,
    packageJson,
    fileTree,
    sourceFiles,
  });

  console.log(
    JSON.stringify({
      overallScore: report.overallScore,
      gradeCategory: report.gradeCategory,
      summary: report.summary,
      mainLanguage: report.mainLanguage,
      recommendations: (report as unknown as { topRecommendations?: string[] }).topRecommendations ?? [],
      byCategory: (report as unknown as { categoryScores?: Record<string, number> }).categoryScores,
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

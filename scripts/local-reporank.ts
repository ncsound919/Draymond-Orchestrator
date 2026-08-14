#!/usr/bin/env tsx
/**
 * Local RepoRank scorer — grades a GitHub repo via RepoRank's GradingService
 * using the OpenCode Zen key (no RepoRank server required). Prints
 * { overallScore, gradeCategory } as JSON on stdout.
 *
 * Usage: npx tsx scripts/local-reporank.ts <owner/repo|https://github.com/owner/repo>
 */
import fs from 'node:fs';
import path from 'node:path';
import { GradingService } from '../agents/reporank/packages/grading-engine/src/index.ts';

function loadDotEnvLocal() {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseRepo(raw: string): { owner: string; repo: string } {
  const m = raw.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/) || raw.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) throw new Error(`Invalid repo URL: ${raw}`);
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

async function main() {
  loadDotEnvLocal();
  const repoUrl = process.argv[2];
  if (!repoUrl) throw new Error('Usage: local-reporank.ts <owner/repo>');
  const { owner, repo } = parseRepo(repoUrl);

  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let meta: Record<string, unknown> | null = null;
  let readme = '';
  let packageJson = '';
  try {
    const [metaRes, readmeRes, pkgRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/contents/package.json`, { headers }),
    ]);
    if (metaRes.ok) meta = (await metaRes.json()) as Record<string, unknown>;
    if (readmeRes.ok) {
      const d = (await readmeRes.json()) as { content?: string };
      if (d.content) readme = Buffer.from(d.content, 'base64').toString('utf8');
    }
    if (pkgRes.ok) {
      const d = (await pkgRes.json()) as { content?: string };
      if (d.content) packageJson = Buffer.from(d.content, 'base64').toString('utf8');
    }
  } catch {
    // fall through with whatever we got
  }

  const svc = new GradingService(process.env.GEMINI_API_KEY || '', process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const report = await svc.gradeRepo({
    repoUrl,
    repoName: repo,
    repoOwner: owner,
    mainLanguage: String(meta?.language ?? 'Unknown'),
    starsCount: Number(meta?.stargazers_count ?? 0),
    forksCount: Number(meta?.forks_count ?? 0),
    openIssuesCount: Number(meta?.open_issues_count ?? 0),
    lastPushedAt: String(meta?.pushed_at ?? new Date().toISOString()),
    readmeContent: readme.slice(0, 30000),
    packageJson: packageJson.slice(0, 10000),
    fileTree: [],
    sourceFiles: [],
  });

  console.log(
    JSON.stringify({
      overallScore: report.overallScore,
      gradeCategory: report.gradeCategory,
      summary: report.summary,
      mainLanguage: report.mainLanguage,
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

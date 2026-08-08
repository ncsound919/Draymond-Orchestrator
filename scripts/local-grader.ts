#!/usr/bin/env tsx
/**
 * Local Grader scorer — grades a GitHub repo via Grader's GradingService using
 * the OpenCode Zen key (no Grader server required). Prints
 * { overallScore, gradeCategory, summary } as JSON on stdout.
 *
 * Usage: npx tsx scripts/local-grader.ts <owner/repo|https://github.com/owner/repo>
 */
import fs from 'node:fs';
import path from 'node:path';
import { GradingService } from '../agents/Grader-main/src/server/services/gradingService.ts';

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
  if (!repoUrl) throw new Error('Usage: local-grader.ts <owner/repo>');
  const { owner, repo } = parseRepo(repoUrl);

  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let repoMeta: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (res.ok) repoMeta = (await res.json()) as Record<string, unknown>;
  } catch {
    repoMeta = null;
  }

  const report = await GradingService.gradeRepo(
    { repoUrl, owner, repo },
    { repoMeta, packageJsonStr: undefined, readmeStr: undefined, fileList: undefined }
  );

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

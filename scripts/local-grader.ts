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
  let readmeStr = '';
  let packageJsonStr = '';
  const fileList: string[] = [];
  try {
    const [metaRes, readmeRes, pkgRes, treeRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/contents/package.json`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers }),
    ]);
    if (metaRes.ok) repoMeta = (await metaRes.json()) as Record<string, unknown>;
    if (readmeRes.ok) {
      const d = (await readmeRes.json()) as { content?: string };
      if (d.content) readmeStr = Buffer.from(d.content, 'base64').toString('utf8');
    }
    if (pkgRes.ok) {
      const d = (await pkgRes.json()) as { content?: string };
      if (d.content) packageJsonStr = Buffer.from(d.content, 'base64').toString('utf8');
    }
    if (treeRes.ok) {
      const d = (await treeRes.json()) as { tree?: Array<{ path: string; type: string }> };
      if (Array.isArray(d.tree)) {
        for (const t of d.tree) {
          if (t.type === 'blob') fileList.push(t.path);
        }
      }
    }
  } catch {
    // fall through with whatever we got
  }

  const report = await GradingService.gradeRepo(
    { repoUrl, owner, repo },
    { repoMeta, packageJsonStr, readmeStr: readmeStr.slice(0, 20000), fileList: fileList.slice(0, 200) }
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

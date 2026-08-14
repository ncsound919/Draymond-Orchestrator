// Audit every fleet SKILL.md for valid frontmatter + description quality.
// "Description is the router": descriptions should be ≤160 chars and say what
// the skill does + when to use it. Exits non-zero when issues are found.
//
// Usage: npm run audit:skills
import fs from 'node:fs';
import path from 'node:path';

interface SkillReport {
  file: string;
  hasFrontmatter: boolean;
  name: string | null;
  description: string | null;
  descriptionLength: number;
  ok: boolean;
  issues: string[];
}

/** Parse the YAML frontmatter block (`---` … `---`) into flat string fields. */
function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (val) out[key] = val;
  }
  return out;
}

const SKILL_DIRS = [
  path.join(process.cwd(), 'agents', 'skills'),
  path.join(process.cwd(), 'agents', 'everything-claude-code-main', 'skills'),
];

function findSkillFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // dir absent/unreadable — skip
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findSkillFiles(full, out);
    else if (e.name === 'SKILL.md') out.push(full);
  }
}

function audit(): SkillReport[] {
  const files = new Set<string>();
  for (const dir of SKILL_DIRS) {
    const found: string[] = [];
    findSkillFiles(dir, found);
    for (const f of found) files.add(f);
  }

  const reports: SkillReport[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    const issues: string[] = [];
    if (!fm.name) issues.push('missing name');
    const desc = fm.description ?? null;
    if (!desc) issues.push('missing description');
    if (desc && desc.length > 160) issues.push(`description ${desc.length} chars (>160)`);
    reports.push({
      file: path.relative(process.cwd(), file),
      hasFrontmatter: Object.keys(fm).length > 0,
      name: fm.name ?? null,
      description: desc,
      descriptionLength: desc?.length ?? 0,
      ok: issues.length === 0,
      issues,
    });
  }
  return reports;
}

function main(): void {
  const reports = audit().sort((a, b) => a.file.localeCompare(b.file));
  const problems = reports.filter((r) => !r.ok);
  const ok = reports.length - problems.length;

  console.log(`Skill frontmatter audit: ${reports.length} SKILL.md files — ${ok} OK, ${problems.length} with issues.`);
  console.log('');
  for (const r of problems) {
    console.log(`- ${r.file}: ${r.issues.join(', ')}`);
  }
  console.log('');
  if (problems.length > 0) {
    console.log(`Fix: every SKILL.md needs a name + a ≤160-char description that states what it does and when to use it.`);
  }
  process.exitCode = problems.length > 0 ? 1 : 0;
}

main();

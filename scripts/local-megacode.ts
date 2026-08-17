#!/usr/bin/env tsx
/**
 * Local Megacode (OverCoat) reviewer — runs an LLM code review over a local
 * repository directory using the shared fleet-client LLM chain. Mirrors how
 * Megacode/OverCoat performs multi-LLM review, but runs locally with no server.
 *
 * Prints findings JSON on stdout:
 *   { engine: 'megacode', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-megacode.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { callLLM } from '@overlay365/fleet-client';
import { loadDotEnvLocal } from './lib/load-dotenv-local.ts';

const EXCLUDE = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.vite',
  'src-tauri', 'e2e', 'test-results', 'playwright-report', '.verification-sandbox',
  'test-docs', 'reports', 'docs', '.turbo', '.cache', '.github', 'public', 'assets',
]);

function collectSource(root: string, limit = 40): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
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
          if (stat.size <= 0 || stat.size >= 150_000) continue;
          out.push({ file: full, content: fs.readFileSync(full, 'utf8') });
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(root);
  return out;
}

function parseFindings(text: string, files: { file: string }[]): Record<string, unknown>[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr)) return arr.filter((f) => f && typeof f === 'object');
    } catch {
      /* fall through to text parsing */
    }
  }
  // Fallback: extract `- title: ...` style bullets
  const findings: Record<string, unknown>[] = [];
  const lines = text.split('\n');
  let current: Record<string, unknown> | null = null;
  for (const line of lines) {
    const titleMatch = line.match(/^\s*(?:[-*]|\d+[.)])\s*(.+)$/);
    const labelMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (titleMatch || labelMatch) {
      current = {
        title: (titleMatch?.[1] ?? labelMatch?.[1] ?? '').trim(),
        severity: /critical|blocker|fatal/i.test(line) ? 'critical' : /high|major/i.test(line) ? 'high' : /medium|warn/i.test(line) ? 'medium' : 'low',
        description: '',
        file: files[0]?.file,
        line: 1,
      };
      findings.push(current);
    } else if (current && line.trim()) {
      current.description += ` ${line.trim()}`;
    }
  }
  return findings;
}

async function main() {
  loadDotEnvLocal();
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-megacode.ts <localDir>');
    process.exit(1);
  }

  const root = path.resolve(target);
  const files = collectSource(root);
  if (files.length === 0) {
    console.log(JSON.stringify({ engine: 'megacode', findings: [], summary: { filesScanned: 0 } }));
    return;
  }

  const started = Date.now();
  const repoName = path.basename(root);

  // Review a representative subset: prefer non-test source files, cap at 4
  // batches (16 files) to stay within LLM rate limits.
  const source: { file: string; content: string }[] = files
    .filter((f) => !/\.(test|spec)\./.test(f.file))
    .slice(0, 12);
  if (source.length === 0) source.push(...files.slice(0, 4));

  const batches: { file: string; content: string }[][] = [];
  for (let i = 0; i < source.length; i += 4) batches.push(source.slice(i, i + 4));

  const allFindings: Record<string, unknown>[] = [];

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    // Stagger LLM calls to reduce rate-limit bursts.
    if (bi > 0) await new Promise((r) => setTimeout(r, 8_000));
    const codeBlock = batch
      .map((f) => `\n=== FILE: ${path.relative(root, f.file)} ===\n${f.content.slice(0, 3000)}`)
      .join('\n')
      .slice(0, 12_000);

    const prompt = `You are an expert senior code reviewer for the repository "${repoName}".

Review the following files for genuine, high-signal issues only. Flag ONLY:
1. Bugs that will cause incorrect behavior or crashes
2. Security vulnerabilities (injection, secrets, unsafe deserialization, auth flaws)
3. Concurrency / race conditions
4. Resource leaks (memory, handles, listeners)
5. Clear performance pathologies

Do NOT flag style nits, subjective preferences, or speculative issues.
For each finding return JSON array of objects with EXACTLY these fields:
[{ "title": "short title", "severity": "critical|high|medium|low", "description": "what & why", "file": "relative path", "line": 1, "fixSuggestion": "concrete fix" }]

Return ONLY the JSON array, no prose.

${codeBlock}`;

    try {
      const text = await callLLM({
        provider: 'opencode',
        system: 'You are a precise senior code reviewer. Return only valid JSON arrays.',
        userMessage: prompt,
        maxTokens: 6000,
        timeoutMs: 180_000,
      });
      const parsed = parseFindings(text, batch);
      // Normalize paths + engine
      for (const f of parsed) {
        f.engine = 'megacode';
        const file = String(f.file ?? '');
        f.file = path.isAbsolute(file) ? file : path.join(root, file);
      }
      allFindings.push(...parsed);
    } catch (err) {
      // One batch failing shouldn't kill the whole engine
      console.error(`[local-megacode] batch failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
      continue;
    }
  }

  const bySeverity: Record<string, number> = {};
  for (const f of allFindings) {
    const s = String(f.severity ?? 'low').toLowerCase();
    bySeverity[s] = (bySeverity[s] ?? 0) + 1;
  }

  console.log(JSON.stringify({
    engine: 'megacode',
    findings: allFindings,
    summary: {
      filesScanned: files.length,
      findings: allFindings.length,
      bySeverity,
      durationMs: Date.now() - started,
    },
  }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

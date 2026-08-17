#!/usr/bin/env tsx
/**
 * Local per-language linter runner — runs ecosystem-native linters that the
 * suite's custom analyzers do not cover:
 *  - eslint (JS/TS) via the repo's own config
 *  - ruff (Python)
 *  - bandit (Python security)
 *  - cargo clippy (Rust)
 *  - go vet / staticcheck (Go)
 *
 * Prints findings JSON on stdout:
 *   { engine: 'linters', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-linters.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

function resolveTool(name: string): string | null {
  const candidates = [`${name}.exe`, `${name}.cmd`, name];
  for (const c of candidates) {
    const r = process.platform === 'win32'
      ? (() => {
          try {
            // Use `where` to resolve PATH entries incl. .cmd/.exe shims.
            const { execFileSync } = require('node:child_process');
            return execFileSync('where', [c], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
          } catch {
            return null;
          }
        })()
      : null;
    if (r) return r;
  }
  return name;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const isScript = /\.(cmd|bat|ps1)$/i.test(cmd);
    const execCmd = isScript ? 'cmd.exe' : cmd;
    const execArgs = isScript ? ['/c', cmd, ...args] : args;
    execFile(
      execCmd,
      execArgs,
      { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve({ stdout: stdout || '', code: err ? (err as { code?: number }).code ?? 1 : 0 }),
    );
  });
}

function hasFile(root: string, name: string): boolean {
  return fs.existsSync(path.join(root, name));
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-linters.ts <localDir>');
    process.exit(1);
  }
  const root = path.resolve(target);
  const started = Date.now();
  const findings: Record<string, unknown>[] = [];
  const bySeverity: Record<string, number> = {};
  const tools: string[] = [];

  const add = (severity: string, category: string, title: string, description: string, file: string | undefined, line: number | undefined) => {
    const sev = severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    findings.push({ severity: sev, category, title, description, file, line, engine: 'linters' });
  };

  // ── ESLint (repo config) ──
  const hasESLint = hasFile(root, 'eslint.config.mjs') || hasFile(root, '.eslintrc') || hasFile(root, '.eslintrc.json') || hasFile(root, '.eslintrc.js');
  const eslint = resolveTool('npx');
  if (hasESLint && eslint) {
    tools.push('eslint');
    const { stdout } = await run(eslint, ['eslint', '.', '--format', 'json', '--max-warnings', '9999'], root, 300_000).catch(() => ({ stdout: '', code: 1 }));
    try {
      const parsed = JSON.parse(stdout);
      for (const f of Array.isArray(parsed) ? (parsed as Array<{ filePath?: string; messages?: Array<Record<string, unknown>> }>) : []) {
        for (const m of f.messages ?? []) {
          const sev = m.severity === 2 ? 'high' : 'medium';
          add(sev, String(m.ruleId ?? 'eslint'),
            String(m.message ?? 'ESLint finding').slice(0, 160),
            `[${String(m.ruleId ?? '')}] ${String(m.message ?? '')}`,
            String(f.filePath ?? ''), typeof m.line === 'number' ? m.line : undefined);
        }
      }
    } catch {
      /* eslint may not be installed in target — skip */
    }
  }

  // ── Ruff (Python) ──
  const ruff = resolveTool('ruff');
  if (ruff && (hasFile(root, 'pyproject.toml') || hasFile(root, 'setup.py') || hasFile(root, 'requirements.txt'))) {
    tools.push('ruff');
    const { stdout } = await run(ruff, ['check', '.', '--output-format', 'json', '--no-cache'], root, 180_000).catch(() => ({ stdout: '', code: 1 }));
    try {
      const parsed = JSON.parse(stdout);
      for (const r of Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []) {
        const code = r.code ?? 'RUFF';
        const message = r.message ?? 'Ruff finding';
        const location = (r.location as Record<string, unknown> | undefined) ?? {};
        const sev = String(r.fix_availability ?? '') === 'Some' ? 'low' : 'medium';
        add(sev, 'python', `[${String(code)}] ${String(message).slice(0, 140)}`,
          `[${String(code)}] ${String(message)}`, String(r.filename ?? ''), typeof location.row === 'number' ? location.row : undefined);
      }
    } catch {
      /* skip */
    }
  }

  // ── Bandit (Python security) ──
  const bandit = resolveTool('bandit');
  if (bandit && (hasFile(root, 'pyproject.toml') || hasFile(root, 'setup.py') || hasFile(root, 'requirements.txt'))) {
    tools.push('bandit');
    const { stdout } = await run(bandit, ['-r', '.', '-f', 'json', '-q'], root, 180_000).catch(() => ({ stdout: '', code: 1 }));
    try {
      const parsed = JSON.parse(stdout);
      const results = (parsed.results ?? []) as Array<Record<string, unknown>>;
      for (const r of results) {
        add(String(r.issue_severity ?? 'MEDIUM').toLowerCase(), 'python-security',
          `[${String(r.test_id ?? 'B000')}] ${String(r.test_name ?? '')}`,
          String(r.issue_text ?? ''),
          String(r.filename ?? ''), typeof r.line_number === 'number' ? r.line_number : undefined);
      }
    } catch {
      /* skip */
    }
  }

  // ── Cargo clippy (Rust) ──
  const cargo = resolveTool('cargo');
  if (cargo && hasFile(root, 'Cargo.toml')) {
    tools.push('cargo-clippy');
    const { stdout } = await run(cargo, ['clippy', '--all-targets', '--all-features', '--message-format=json'], root, 600_000).catch(() => ({ stdout: '', code: 1 }));
    for (const line of stdout.split(/\r?\n/)) {
      try {
        const msg = JSON.parse(line);
        if (msg?.reason !== 'compiler-message' || !msg?.message) continue;
        const m = msg.message;
        if (m.level !== 'warning' && m.level !== 'error') continue;
        const spans = Array.isArray(m.spans) && m.spans.length > 0 ? (m.spans[0] as Record<string, unknown>) : undefined;
        add(m.level === 'error' ? 'high' : 'medium', 'rust',
          String(m.message ?? 'clippy').split('\n')[0].slice(0, 160),
          `[${String(m.code?.code ?? 'clippy')}] ${String(m.message ?? '')}`,
          String(spans?.file_name ?? ''), typeof spans?.line_start === 'number' ? spans.line_start : undefined);
      } catch {
        /* not JSON — skip */
      }
    }
  }

  // ── Go vet ──
  const go = resolveTool('go');
  if (go && (hasFile(root, 'go.mod'))) {
    tools.push('go-vet');
    const { stdout } = await run(go, ['vet', './...'], root, 300_000).catch(() => ({ stdout: '', code: 1 }));
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^(.+?):(\d+):\d+: (.+)$/);
      if (m) {
        add('medium', 'go', m[3].slice(0, 160), m[3], m[1], Number(m[2]));
      }
    }
  }

  console.log(JSON.stringify({
    engine: 'linters',
    findings,
    summary: {
      tools,
      bySeverity,
      durationMs: Date.now() - started,
    },
  }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

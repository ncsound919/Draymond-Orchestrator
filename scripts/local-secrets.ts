#!/usr/bin/env tsx
/**
 * Local secrets runner — gitleaks secret scanning across the repo (and git
 * history). Closes the "no real secret detection" gap.
 *
 * Prints findings JSON on stdout:
 *   { engine: 'secrets', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-secrets.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const TOOLS_DIR = path.join(__dirname, 'tools');

function resolveTool(name: string): string | null {
  const candidates = [path.join(TOOLS_DIR, `${name}.exe`), path.join(TOOLS_DIR, name), `${name}.exe`, name];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'cmd.exe' : cmd,
      process.platform === 'win32' ? ['/c', cmd, ...args] : args,
      { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve({ stdout: stdout || '', code: err ? 1 : 0 }),
    );
  });
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-secrets.ts <localDir>');
    process.exit(1);
  }
  const root = path.resolve(target);
  const started = Date.now();
  const findings: Record<string, unknown>[] = [];
  const bySeverity: Record<string, number> = {};
  const tools: string[] = [];
  const reportPath = path.join(process.cwd(), `.gitleaks-${Date.now()}.json`);

  const gitleaks = resolveTool('gitleaks');
  if (gitleaks) {
    tools.push('gitleaks');
    const { stdout } = await run(gitleaks, ['detect', '--source', root, '--report-format', 'json', '--report-path', reportPath, '--no-banner'], root, 180_000).catch(() => ({ stdout: '', code: 1 }));
    if (fs.existsSync(reportPath)) {
      try {
        const leaks = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        if (Array.isArray(leaks)) {
          for (const l of leaks as Array<{ RuleID?: string; File?: string; StartLine?: number; Secret?: string; Description?: string }>) {
            const sev = /key|token|password|secret|credential|api/i.test(String(l.RuleID ?? '')) ? 'critical' : 'high';
            bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
            findings.push({
              severity: sev,
              category: 'secret',
              title: `Committed secret: ${String(l.RuleID ?? 'secret')}`,
              description: String(l.Description ?? '') || `Detected ${String(l.RuleID ?? '')} in ${String(l.File ?? '')}.`,
              file: l.File,
              line: l.StartLine,
              fixSuggestion: 'Rotate the credential and remove it from history (git filter-repo / BFG).',
              engine: 'secrets',
            });
          }
        }
      } catch {
        /* ignore */
      }
      try { fs.unlinkSync(reportPath); } catch { /* ignore */ }
    }
  }

  // Fallback: trivy secret scanner over the working tree when gitleaks finds nothing
  // (cheap, no git history needed).
  const trivy = resolveTool('trivy');
  if (trivy && findings.length === 0) {
    tools.push('trivy-secrets');
    const { stdout } = await run(trivy, ['fs', '--scanners', 'secret', '--format', 'json', '--no-progress', '--severity', 'CRITICAL,HIGH', '--exit-code', '0', root], root, 300_000).catch(() => ({ stdout: '', code: 1 }));
    try {
      const parsed = JSON.parse(stdout);
      for (const res of Array.isArray(parsed.Results) ? (parsed.Results as Array<{ Secrets?: Array<Record<string, unknown>>; Target?: string }>) : []) {
        for (const s of res.Secrets ?? []) {
          bySeverity.critical = (bySeverity.critical ?? 0) + 1;
          findings.push({
            severity: 'critical',
            category: 'secret',
            title: `Secret: ${String(s.RuleID ?? '')}`,
            description: String(s.Match ?? ''),
            file: String(res.Target ?? ''),
            line: typeof s.StartLine === 'number' ? s.StartLine : undefined,
            fixSuggestion: 'Rotate the credential and remove it from the repo.',
            engine: 'secrets',
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  console.log(JSON.stringify({
    engine: 'secrets',
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

#!/usr/bin/env tsx
/**
 * Local IaC runner — checkov (Terraform/K8s/CloudFormation/GHA) + hadolint
 * (Dockerfile) + trivy misconfig. Closes the "no infrastructure review" gap.
 *
 * Prints findings JSON on stdout:
 *   { engine: 'iac', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-iac.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const TOOLS_DIR = path.join(__dirname, 'tools');

function resolveTool(name: string): string | null {
  const candidates = [
    path.join(TOOLS_DIR, `${name}.exe`),
    path.join(TOOLS_DIR, name),
    `${name}.exe`,
    `${name}.cmd`,
    name,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    // checkov (and other Python tools) ship as .cmd shims on Windows, which
    // execFile cannot run directly — wrap those in cmd /c.
    const isScript = /\.(cmd|bat|ps1)$/i.test(cmd);
    const execCmd = isScript ? 'cmd.exe' : cmd;
    const execArgs = isScript ? ['/c', cmd, ...args] : args;
    execFile(
      execCmd,
      execArgs,
      { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(stdout || ''),
    );
  });
}

function findDockerfiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'target') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/^Dockerfile(\.\w+)?$/i.test(e.name)) out.push(full);
    }
  };
  walk(root);
  return out.slice(0, 5);
}

function hasIaCFiles(root: string): boolean {
  const patterns = /\.(tf|tfvars|bicep|yaml|yml)$/;
  const names = /(docker-compose|compose|cloudformation|template\.yaml|Chart\.yaml|values\.yaml|\.github\/workflows)/i;
  let found = false;
  const walk = (dir: string) => {
    if (found) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found) return;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'target' || e.name === 'src-tauri') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (patterns.test(e.name) || names.test(full)) found = true;
    }
  };
  walk(root);
  return found;
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-iac.ts <localDir>');
    process.exit(1);
  }
  const root = path.resolve(target);
  const started = Date.now();
  const findings: Record<string, unknown>[] = [];
  const bySeverity: Record<string, number> = {};
  const tools: string[] = [];

  const add = (severity: string, category: string, title: string, description: string, file: string | undefined, line: number | undefined, fixSuggestion?: string) => {
    const sev = severity === 'CRITICAL' || severity === 'critical' ? 'critical' : severity === 'HIGH' || severity === 'high' ? 'high' : severity === 'MEDIUM' || severity === 'medium' ? 'medium' : 'low';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    findings.push({ severity: sev, category, title, description, file, line, fixSuggestion, engine: 'iac' });
  };

  // ── 1. checkov (Terraform / K8s / CloudFormation / GHA) ──
  const checkov = resolveTool('checkov');
  if (checkov && hasIaCFiles(root)) {
    tools.push('checkov');
    const output = await run(checkov, ['-d', root, '--output', 'json', '--quiet'], root, 300_000).catch(() => '');
    try {
      const parsed = JSON.parse(output);
      for (const res of Array.isArray(parsed.results?.failed_checks) ? (parsed.results.failed_checks as Array<Record<string, unknown>>) : []) {
        const range = res.file_line_range as unknown;
        const lineNum = Array.isArray(range) ? Number((range as Array<unknown>)[0]) : undefined;
        add(String(res.check_severity ?? 'HIGH'), String(res.check_id ?? 'iac'),
          String(res.check_name ?? res.check_id ?? 'IaC check'),
          String(res.file_path ?? ''),
          String(res.file_path ?? ''),
          Number.isFinite(lineNum as number) ? (lineNum as number) : undefined,
          String(res.check_name ?? '') + ' — see checkov docs');
      }
    } catch {
      /* parse failure */
    }
  }

  // ── 2. hadolint (Dockerfile) ──
  const hadolint = resolveTool('hadolint');
  const dockerfiles = findDockerfiles(root);
  if (hadolint && dockerfiles.length > 0) {
    tools.push('hadolint');
    for (const df of dockerfiles) {
      const output = await run(hadolint, ['-f', 'json', df], root, 120_000).catch(() => '');
      try {
        const parsed = JSON.parse(output);
        for (const l of Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []) {
          add(String(l.level ?? 'warning'), 'dockerfile',
            `${String(l.code ?? 'DL0000')}: ${String(l.message ?? '').slice(0, 120)}`,
            String(l.message ?? ''),
            df, typeof l.line === 'number' ? l.line : undefined,
            'See https://github.com/hadolint/hadolint/wiki');
        }
      } catch {
        /* parse failure */
      }
    }
  }

  // ── 3. trivy misconfig (K8s / Docker compose) ──
  const trivy = resolveTool('trivy');
  if (trivy && (hasIaCFiles(root) || dockerfiles.length > 0)) {
    tools.push('trivy-misconfig');
    const output = await run(trivy, ['fs', '--scanners', 'misconfig', '--format', 'json', '--no-progress', '--severity', 'CRITICAL,HIGH,MEDIUM', '--exit-code', '0', root], root, 300_000).catch(() => '');
    try {
      const parsed = JSON.parse(output);
      for (const res of Array.isArray(parsed.Results) ? (parsed.Results as Array<{ Misconfigurations?: Array<Record<string, unknown>>; Target?: string }>) : []) {
        for (const m of res.Misconfigurations ?? []) {
          add(String(m.Severity ?? 'medium'), 'misconfig',
            String(m.Title ?? 'IaC misconfiguration'),
            String(m.Description ?? ''),
            String(res.Target ?? ''),
            undefined, String(m.Resolution ?? ''));
        }
      }
    } catch {
      /* ignore */
    }
  }

  console.log(JSON.stringify({
    engine: 'iac',
    findings,
    summary: {
      dockerfiles: dockerfiles.length,
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

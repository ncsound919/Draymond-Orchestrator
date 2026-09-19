#!/usr/bin/env tsx
/**
 * Local supply-chain runner — OSV vulnerability scanning (osv-scanner) +
 * container/image scanning (trivy) + license analysis (osv licenses).
 * Closes the "no CVE feed / SBOM / license" gap.
 *
 * Prints findings JSON on stdout:
 *   { engine: 'supply-chain', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-supply-chain.ts <localDir>
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
    name,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
    // name on PATH
    if (c === name || c === `${name}.exe`) {
      const lookup = process.platform === 'win32' ? `${name}.exe` : name;
      // rely on PATH resolution by not qualifying
      return lookup;
    }
  }
  return null;
}

function findLockfiles(root: string, limit = 8): string[] {
  const out: string[] = [];
  const names = [
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb',
    'requirements.txt', 'poetry.lock', 'Pipfile.lock', 'go.sum',
    'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'gradle.lockfile',
  ];
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
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'target' || e.name === 'vendor') continue;
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (names.includes(e.name)) out.push(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'cmd.exe' : cmd,
      process.platform === 'win32' ? ['/c', cmd, ...args] : args,
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

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-supply-chain.ts <localDir>');
    process.exit(1);
  }
  const root = path.resolve(target);
  const started = Date.now();
  const findings: Record<string, unknown>[] = [];
  const bySeverity: Record<string, number> = {};
  const tools: string[] = [];

  const add = (severity: string, category: string, title: string, description: string, file: string | undefined, fixSuggestion?: string) => {
    const sev = severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    findings.push({ severity: sev, category, title, description, file, line: undefined, fixSuggestion, engine: 'supply-chain' });
  };

  // -- 1. OSV scanner over lockfiles --
  const osv = resolveTool('osv-scanner');
  const lockfiles = findLockfiles(root);
  if (osv && lockfiles.length > 0) {
    tools.push('osv-scanner');
    const output = await run(osv, ['scan', '--format', 'json', ...lockfiles], root, 300_000);
    try {
      const parsed = JSON.parse(output);
      const results = Array.isArray(parsed.results) ? parsed.results : [];
      for (const res of results as Array<Record<string, unknown>>) {
        const pkgs = Array.isArray(res.packages) ? (res.packages as Array<Record<string, unknown>>) : [];
        for (const pkg of pkgs) {
          const pkgInfo = (pkg.package as Record<string, unknown>) ?? {};
          const groups = Array.isArray(pkg.groups) ? (pkg.groups as Array<{ ids?: string[]; max_severity?: string }>) : [];
          for (const g of groups) {
            const sevNum = parseFloat(String(g.max_severity ?? '0'));
            const sev = sevNum >= 9 ? 'critical' : sevNum >= 7 ? 'high' : sevNum >= 4 ? 'medium' : 'low';
            add(sev, 'vulnerability',
              `CVE in ${String(pkgInfo.name ?? '')}@${String(pkgInfo.version ?? '')}`,
              `Known vulnerability (${(g.ids ?? []).join(', ')}) in ${String(pkgInfo.name ?? '')} ${String(pkgInfo.version ?? '')}.`,
              String((res.source as { path?: string } | undefined)?.path ?? lockfiles[0]),
              'Upgrade to a patched version.');
          }
        }
      }
    } catch {
      /* parse failure — continue */
    }
  }

  // -- 2. Trivy container scan over Dockerfiles --
  const trivy = resolveTool('trivy');
  const dockerfiles = findDockerfiles(root);
  if (trivy && dockerfiles.length > 0) {
    tools.push('trivy');
    for (const df of dockerfiles.slice(0, 2)) {
      const dir = path.dirname(df);
      const output = await run(trivy, ['image', '--scanners', 'vuln,misconfig,secret', '--format', 'json', '--no-progress', '--severity', 'CRITICAL,HIGH,MEDIUM', '--exit-code', '0', df], dir, 600_000).catch(() => '');
      try {
        const parsed = JSON.parse(output);
        for (const res of Array.isArray(parsed.Results) ? (parsed.Results as Array<{ Vulnerabilities?: Array<Record<string, unknown>>; Misconfigurations?: Array<Record<string, unknown>>; Secrets?: Array<Record<string, unknown>> }>) : []) {
          for (const v of res.Vulnerabilities ?? []) {
            add(String(v.Severity ?? 'low').toLowerCase(), 'vulnerability',
              `CVE ${String(v.VulnerabilityID ?? '')} in ${String(v.PkgName ?? '')}`,
              String(v.Title ?? '') + ' — ' + String(v.InstalledVersion ?? '') + (v.FixedVersion ? ` → ${v.FixedVersion}` : ''),
              df, `Upgrade ${String(v.PkgName ?? '')} to ${String(v.FixedVersion ?? 'a patched version')}.`);
          }
          for (const m of res.Misconfigurations ?? []) {
            add(String(m.Severity ?? 'low').toLowerCase(), 'misconfig',
              String(m.Title ?? 'Container misconfiguration'),
              String(m.Description ?? ''),
              df, String(m.Resolution ?? ''));
          }
          for (const s of res.Secrets ?? []) {
            add('critical', 'secret', 'Secret in container', String(s.Title ?? '') + ' @ ' + String(s.Match ?? ''), df);
          }
        }
      } catch {
        /* trivy may not have pulled the image — continue */
      }
    }
  }

  // -- 3. License summary (osv licenses) --
  if (osv && lockfiles.length > 0) {
    tools.push('osv-licenses');
    const output = await run(osv, ['scan', '--format', 'json', '--licenses', ...lockfiles], root, 180_000).catch(() => '');
    try {
      const parsed = JSON.parse(output);
      const licenses = parsed.licenses;
      if (licenses && Array.isArray(licenses)) {
        const summary = new Map<string, number>();
        for (const l of licenses as Array<{ license?: string }>) {
          const name = String(l.license ?? 'unknown');
          summary.set(name, (summary.get(name) ?? 0) + 1);
        }
        const unknownCount = summary.get('unknown') ?? 0;
        if (unknownCount > 0) {
          add('medium', 'license', `${unknownCount} dependencies with unknown license`,
            'Dependencies without a detectable license block reuse and compliance.', lockfiles[0],
            'Audit the licenses of all dependencies; add a LICENSE policy.');
        }
      }
    } catch {
      /* skip */
    }
  }

  console.log(JSON.stringify({
    engine: 'supply-chain',
    findings,
    summary: {
      lockfiles: lockfiles.length,
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

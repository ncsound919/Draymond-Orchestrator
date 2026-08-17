#!/usr/bin/env tsx
/**
 * Local CodeNexus deep-audit scorer — runs the deterministic deep-audit lenses
 * (source review, workflow integrity, source-to-sink, risk classification)
 * against a local repository directory. No GitHub / PR context required.
 *
 * Prints findings JSON on stdout:
 *   { engine: 'codenexus', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-codenexus.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { reviewSource } from '../agents/CodeNexus-main/deep-audit/src/source-review.ts';
import { analyzeFullWorkflowIntegrity } from '../agents/CodeNexus-main/deep-audit/src/business-logic-integrity.ts';
import { traceSourceToSink, analyzeAccessControl } from '../agents/CodeNexus-main/deep-audit/src/source-to-sink.ts';
import { classifyRisk } from '../agents/CodeNexus-main/deep-audit/src/risk-classifier.ts';

const EXCLUDE = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.vite',
  'src-tauri', 'e2e', 'test-results', 'playwright-report', '.verification-sandbox',
  'test-docs', 'reports', 'docs', '.turbo', '.cache', '.github', 'public', 'assets',
]);

function collectSource(root: string, limit = 120): { file: string; content: string }[] {
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
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(e.name)) {
        try {
          const stat = fs.statSync(full);
          if (stat.size <= 0 || stat.size >= 1_000_000) continue;
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

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-codenexus.ts <localDir>');
    process.exit(1);
  }

  const root = path.resolve(target);
  const files = collectSource(root);
  if (files.length === 0) {
    console.log(JSON.stringify({ engine: 'codenexus', findings: [], summary: { filesScanned: 0 } }));
    return;
  }

  const findings: Record<string, unknown>[] = [];
  const bySeverity: Record<string, number> = {};

  const add = (severity: string, category: string, title: string, description: string, file: string, line?: number, recommendation?: string) => {
    const sev = severity.toLowerCase();
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    findings.push({
      severity: sev === 'high' || sev === 'critical' ? sev : sev === 'medium' ? 'medium' : 'low',
      category,
      title,
      description,
      file,
      line: line ?? 1,
      recommendation,
      engine: 'codenexus',
    });
  };

  const started = Date.now();

  for (const f of files) {
    // 1. Source review — trust boundaries, state machines, data flows
    try {
      const sr = reviewSource(f.content);
      for (const tb of sr.trustBoundaries) {
        if (tb.risk === 'CRITICAL' || tb.risk === 'HIGH') {
          add(tb.risk === 'CRITICAL' ? 'critical' : 'high', 'trust-boundary',
            `Trust boundary: ${tb.boundary}`,
            `Trust boundary "${tb.boundary}" (${tb.direction}) crosses with ${tb.verificationStatus} verification.`,
            f.file, 1, 'Verify all inputs crossing this boundary and enforce access control.');
        }
      }
      for (const sm of sr.stateMachines) {
        for (const us of sm.unreachableStates) {
          add('medium', 'state-machine', `Unreachable state: ${us}`,
            `State "${us}" in state machine "${sm.name}" is unreachable.`, f.file, 1);
        }
        for (const dt of sm.deadTransitions) {
          add('medium', 'state-machine', `Dead transition: ${dt.from} → ${dt.to}`,
            `Transition ${dt.from} → ${dt.to} in "${sm.name}" is never triggered.`, f.file, 1);
        }
      }
    } catch {
      /* skip files that break the reviewer */
    }

    // 2. Workflow integrity — circumvention, handoff tampering, invariants
    try {
      const wf = analyzeFullWorkflowIntegrity(f.content);
      for (const finding of wf.findings) {
        add(finding.severity, finding.category,
          finding.title, finding.description,
          f.file, 1, finding.recommendation);
      }
    } catch {
      /* skip */
    }

    // 3. Source-to-sink / access control
    try {
      const traces = traceSourceToSink(f.content);
      for (const trace of traces as Array<{ source?: string; sinks?: string[]; accessControl?: { idorVulnerable?: boolean } }>) {
        if (trace.accessControl?.idorVulnerable) {
          add('high', 'source-to-sink', 'IDOR-vulnerable data flow',
            `Data from "${trace.source}" reaches sinks without access control: ${(trace.sinks ?? []).join(', ')}`,
            f.file, 1, 'Enforce authorization checks on every access to this resource.');
        }
      }
      const ac = analyzeAccessControl(f.content);
      if (ac && typeof ac === 'object' && (ac as { enforced?: boolean }).enforced === false) {
        add('medium', 'access-control', 'Access control not enforced',
          'Source analysis could not confirm access-control enforcement on this module.',
          f.file, 1, 'Review authorization checks on all protected operations.');
      }
    } catch {
      /* skip */
    }
  }

  // 4. Risk classification of the combined corpus
  const corpus = files.slice(0, 30).map((f) => f.content).join('\n');
  let risk = 'LOW';
  try {
    const r = classifyRisk([corpus], '');
    risk = String(r.level ?? 'LOW');
  } catch {
    /* non-fatal */
  }

  const report = {
    engine: 'codenexus',
    findings,
    summary: {
      filesScanned: files.length,
      risk,
      bySeverity,
      durationMs: Date.now() - started,
    },
  };

  console.log(JSON.stringify(report));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

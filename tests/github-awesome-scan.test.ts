import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IntakeScanResult } from '../src/lib/draymond/github-awesome-scan';

const SNIPPET = [
  'LatticeDB is an embedded graph database in a single file written in Zig.',
  'Buzz is a self-hosted team workspace where humans and AI agents join the same rooms.',
  'Workout Guide packages 302 exercise illustrations for apps that need consistent visuals.',
  'This is just a filler sentence that should not become a tool.',
  'CarWatch puts a Raspberry Pi 5 in the car running a 35 billion parameter model locally.',
  'Welcome back to GitHub awesome, this is the weekly roundup.',
].join('\n');

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-scan-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('extractToolCandidates', () => {
  it('extracts tool-name introductions and drops filler/greeting sentences', async () => {
    const { extractToolCandidates } = await import('../src/lib/draymond/github-awesome-scan');
    const candidates = extractToolCandidates(SNIPPET);
    const names = candidates.map((c) => c.name);
    expect(names).toContain('LatticeDB');
    expect(names).toContain('Buzz');
    expect(names).toContain('Workout Guide');
    expect(names).toContain('CarWatch');
    expect(names.some((n) => /welcome|github awesome/i.test(n))).toBe(false);
    expect(names.some((n) => n === 'This')).toBe(false);
  });

  it('dedupes identical names', async () => {
    const { extractToolCandidates } = await import('../src/lib/draymond/github-awesome-scan');
    const dup = `LatticeDB is one.\nLatticeDB is two.\n`;
    expect(extractToolCandidates(dup)).toHaveLength(1);
  });
});

describe('appendIntakeLedger', () => {
  it('appends entries and never duplicates the same id', async () => {
    vi.resetModules();
    process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
    const mod = await import('../src/lib/draymond/github-awesome-scan');
    const base: IntakeScanResult = {
      episode: { title: 'GitHub Trending Weekly #46', videoId: 'abc' },
      transcript: SNIPPET,
      candidates: mod.extractToolCandidates(SNIPPET),
      ranked: [],
      topPicks: [],
      pruned: [],
      pulled: ['LatticeDB'],
      handoff: { kairos: false, hypotheses: false, appended: false },
    };
    mod.appendIntakeLedger(base);
    mod.appendIntakeLedger(base);
    const ledger = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tool-intake.json'), 'utf8'));
    const lattice = ledger.entries.filter((e: { tool: string }) => e.tool === 'LatticeDB');
    expect(lattice).toHaveLength(1);
    expect(lattice[0].verdict).toBe('pull');
  });
});

describe('scoreCandidates', () => {
  it('maps a fake Dev-Brain intake response to ranked/pulled', async () => {
    const mod = await import('../src/lib/draymond/github-awesome-scan');
    const fake = {
      ranked: [{ title: 'LatticeDB', compositeTriageScore: 86.2, status: 'shortlisted_top_5' }],
      topPicks: [{ title: 'LatticeDB', compositeTriageScore: 86.2 }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fake), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const scored = await mod.scoreCandidates([{ name: 'LatticeDB', description: 'x' }]);
    expect(scored.ranked).toHaveLength(1);
    expect(scored.pulled).toContain('LatticeDB');
    vi.unstubAllGlobals();
  });
});
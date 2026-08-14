import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-loop-runner-'));
const prevRoot = process.env.BENCHMARK_OLYMPICS_ROOT;

afterAll(() => {
  if (prevRoot === undefined) delete process.env.BENCHMARK_OLYMPICS_ROOT;
  else process.env.BENCHMARK_OLYMPICS_ROOT = prevRoot;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('discovery loop runner — path resolution', () => {
  it('resolves the script and a local tsx CLI under BENCHMARK_OLYMPICS_ROOT', async () => {
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'node_modules', 'tsx', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts', 'discovery-loop-run.ts'), 'export {};\n');
    fs.writeFileSync(path.join(tmp, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'export {};\n');
    process.env.BENCHMARK_OLYMPICS_ROOT = tmp;

    const runner = await import('../src/lib/draymond/discovery-loop-runner');
    const script = runner.resolveDiscoveryLoopScript();
    expect(script).toBe(path.join(tmp, 'scripts', 'discovery-loop-run.ts'));
    const tsx = runner.resolveTsxCli(script!);
    expect(tsx).toBe(path.join(tmp, 'node_modules', 'tsx', 'dist', 'cli.mjs'));
  });

  it('reports a clear error when the discovery-loop script is absent', async () => {
    const runner = await import('../src/lib/draymond/discovery-loop-runner');
    const res = await runner.runDiscoveryLoopScript({ script: path.join(tmp, 'missing', 'discovery-loop-run.ts') });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not found');
  });
});

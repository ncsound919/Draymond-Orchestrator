import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readStrategy,
  writeStrategy,
  getService,
  serviceTargets,
  totalMonthlyTarget,
  unitEconomics,
  DEFAULT_STRATEGY,
} from '../src/lib/draymond/mission-strategy';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-mission-strategy-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

beforeEach(() => {
  const f = path.join(tmp, 'mission-strategy.json');
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('mission strategy', () => {
  it('defaults to the 4-service catalog', async () => {
    const s = await readStrategy();
    expect(s.services.map((x) => x.id).sort()).toEqual(['aetherdesk', 'audit', 'maas', 'research']);
    expect(totalMonthlyTarget(s)).toBe(5000);
  });

  it('persists and reloads a strategy', async () => {
    await writeStrategy({ ...DEFAULT_STRATEGY, services: DEFAULT_STRATEGY.services.map((x) => x.id === 'maas' ? { ...x, targetMonthly: 3000 } : x) });
    const s = await readStrategy();
    expect(getService(s, 'maas')!.targetMonthly).toBe(3000);
  });

  it('computes unit economics gross margin per service', async () => {
    const s = await readStrategy();
    for (const svc of s.services) {
      const ue = unitEconomics(svc);
      expect(ue.marginPct).toBeGreaterThan(0);
      expect(ue.marginPct).toBeLessThan(100);
      expect(ue.tier).toBe(svc.tiers[0]!.id);
    }
  });

  it('sums service targets', async () => {
    const s = await readStrategy();
    expect(serviceTargets(s)).toEqual({
      aetherdesk: 1000, maas: 2000, audit: 1000, research: 1000,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { buildBuildings, DISTRICT_LABELS } from '../../src/components/visualizer/state/layout';
import type { SnapshotPayload } from '../../src/components/visualizer/state/types';

const mkSnapshot = (services: SnapshotPayload['services']): SnapshotPayload => ({
  services,
  agents: [],
  jobs: [],
  moments: [],
  revenueUsd: 0,
  degraded: false,
  servicesUp: 0,
  servicesTotal: services.length,
  checkedAt: new Date().toISOString(),
});

describe('city layout', () => {
  it('produces a deterministic city for identical input', () => {
    const svc = [
      { slug: 'litellm', name: 'LiteLLM', category: 'coding', port: 4100, up: true },
      { slug: 'claw-protect', name: 'Claw-Protect', category: 'security', port: 3300, up: true },
    ];
    const a = buildBuildings(mkSnapshot(svc), {});
    const b = buildBuildings(mkSnapshot(svc), {});
    expect(a).toEqual(b);
  });

  it('groups services by district and never collides grid cells', () => {
    const services: SnapshotPayload['services'] = [
      { slug: 'litellm', name: 'LiteLLM', category: 'coding', port: 4100, up: true },
      { slug: 'dsh', name: 'DSH', category: 'coding', port: 3080, up: true },
      { slug: 'claw-protect', name: 'Claw-Protect', category: 'security', port: 3300, up: true },
      { slug: 'keywire', name: 'Keywire', category: 'security', port: 3000, up: true },
      { slug: 'draymond', name: 'Draymond', category: 'control', port: 3444, up: true },
    ];
    const buildings = buildBuildings(mkSnapshot(services), {});
    const keys = Object.keys(buildings);
    const cells = new Set(keys.map((k) => `${buildings[k].gridX},${buildings[k].gridY}`));
    expect(cells.size).toBe(keys.length);
    expect(Object.values(buildings).every((b) => DISTRICT_LABELS[b.district] || b.district === 'Agent Row')).toBe(true);
  });

  it('maps health from service up flag', () => {
    const services: SnapshotPayload['services'] = [
      { slug: 'litellm', name: 'LiteLLM', category: 'coding', port: 4100, up: true },
      { slug: 'claw-protect', name: 'Claw-Protect', category: 'security', port: 3300, up: false },
    ];
    const buildings = buildBuildings(mkSnapshot(services), {});
    expect(buildings.litellm.health).toBe('healthy');
    expect(buildings['claw-protect'].health).toBe('down');
  });
});
// src/components/visualizer/state/layout.ts
import type { Building, HealthState, SnapshotPayload } from './types';

/** ToolCategory -> district label (mirrors src/lib/draymond/ports.ts ToolCategory). */
export const DISTRICT_LABELS: Record<string, string> = {
  control: 'City Hall',
  coding: 'LLM Quarter',
  review: 'Review Row',
  knowledge: 'Knowledge Plaza',
  security: 'Ops & Security',
  orchestration: 'Scheduler Quarter',
  service: 'Platform District',
  mcp: 'Peripherals',
  agent: 'Agent Row',
};

const DISTRICT_ANCHOR: Record<string, { cx: number; cy: number }> = {
  control: { cx: 0, cy: 0 },
  coding: { cx: 0, cy: -5 },
  review: { cx: 5, cy: 0 },
  knowledge: { cx: 0, cy: 5 },
  security: { cx: -5, cy: 0 },
  orchestration: { cx: -5, cy: -5 },
  service: { cx: 5, cy: 5 },
  mcp: { cx: 5, cy: -5 },
};

export function categoryHeight(category: string): number {
  switch (category) {
    case 'control': return 6;
    case 'coding': return 4;
    case 'security': return 4;
    case 'service': return 3;
    default: return 2;
  }
}

export function buildBuildings(
  snapshot: SnapshotPayload,
  extra: { degraded?: boolean } = {},
): Record<string, Building> {
  const buildings: Record<string, Building> = {};
  const taken = new Set<string>();
  // synthetic Scheduler Tower (job vehicles spawn here)
  buildings.scheduler = {
    slug: 'scheduler',
    name: 'Scheduler Tower',
    category: 'orchestration',
    port: null,
    health: 'healthy',
    district: 'orchestration',
    gridX: -1,
    gridY: -1,
    height: 3,
  };
  taken.add('-1,-1');
  // district slot cursors; city hall takes the center
  const cursor: Record<string, number> = {};
  for (const svc of snapshot.services) {
    const district = DISTRICT_LABELS[svc.category] ? svc.category : 'mcp';
    const anchor = DISTRICT_ANCHOR[svc.category] ?? DISTRICT_ANCHOR.service;
    const idx = cursor[svc.category] ?? 0;
    cursor[svc.category] = idx + 1;
    const col = Math.floor(idx / 2); // buildings arranged 2-wide per district ring
    const row = idx % 2;
    const gx = anchor.cx + col;
    const gy = anchor.cy + row;
    const cell = `${gx},${gy}`;
    const finalGx = taken.has(cell) ? gx + 2 : gx;
    const finalCell = `${finalGx},${gy}`;
    taken.add(finalCell);
    buildings[svc.slug] = {
      slug: svc.slug,
      name: svc.name,
      category: svc.category,
      port: svc.port,
      health: svc.up ? 'healthy' : 'down',
      district,
      gridX: finalGx,
      gridY: gy,
      height: categoryHeight(svc.category),
    };
  }
  // agent row: small buildings in a dedicated band below city hall
  const agents = Object.values(snapshot.agents ?? {});
  agents.forEach((agent, i) => {
    const gx = (i % 6) - 2;
    const gy = 6 + Math.floor(i / 6);
    buildings[`agent:${agent.slug}`] = {
      slug: agent.slug,
      name: agent.name,
      category: 'agent',
      port: null,
      health: agent.up ? 'healthy' : 'down',
      district: 'Agent Row',
      gridX: gx,
      gridY: gy,
      height: 1,
    };
  });
  return buildings;
}

export function healthOf(b: Building, up: boolean): HealthState {
  return up ? 'healthy' : 'down';
}
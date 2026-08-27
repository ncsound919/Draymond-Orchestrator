// src/components/visualizer/render/drawRoads.ts
import { Graphics } from 'pixi.js';
import type { Building } from '../state/types';
import { projectToScreen } from './projection';

export function drawRoads(g: Graphics, buildings: Building[]): void {
  g.clear();
  g.lineStyle(3, 0x1a1a2e, 0.9);
  const hub = projectToScreen(0, 0, 0);
  for (const b of buildings) {
    const a = projectToScreen(b.gridX, b.gridY, 0);
    g.moveTo(hub.x, hub.y);
    g.lineTo(a.x, a.y);
  }
}
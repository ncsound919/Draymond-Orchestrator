// src/components/visualizer/render/drawBuilding.ts
import { Container, Graphics } from 'pixi.js';
import type { Building } from '../state/types';
import { TILE_W, TILE_H } from './projection';

const COLORS: Record<Building['health'], { base: number; glow: number }> = {
  healthy: { base: 0x22dd88, glow: 0x44ffaa },
  degraded: { base: 0xddaa22, glow: 0xffcc44 },
  down: { base: 0xdd2222, glow: 0xff4444 },
};

export function drawBuilding(b: Building): Container {
  const g = new Container();
  const prism = new Graphics();
  const half = TILE_W / 2;
  const { base } = COLORS[b.health];
  const topY = -b.height * TILE_H;
  // front-left face
  prism.beginFill(base, 0.95);
  prism.moveTo(-half, 0);
  prism.lineTo(0, TILE_H / 2);
  prism.lineTo(0, topY + TILE_H / 2);
  prism.lineTo(-half, topY);
  prism.closePath();
  prism.endFill();
  // front-right face
  prism.beginFill(base, 0.75);
  prism.moveTo(half, 0);
  prism.lineTo(0, TILE_H / 2);
  prism.lineTo(0, topY + TILE_H / 2);
  prism.lineTo(half, topY);
  prism.closePath();
  prism.endFill();
  // roof
  prism.beginFill(0xffffff, 0.25);
  prism.moveTo(-half, topY);
  prism.lineTo(0, topY + TILE_H / 2);
  prism.lineTo(half, topY);
  prism.lineTo(0, topY - TILE_H / 2);
  prism.closePath();
  prism.endFill();
  // roof beacon for tall buildings
  if (b.height >= 4) {
    prism.beginFill(0xffffff, 0.85);
    prism.drawCircle(0, topY - TILE_H / 2, 1.8);
    prism.endFill();
  }
  g.addChild(prism);
  return g;
}
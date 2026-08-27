// src/components/visualizer/render/drawVehicle.ts
import { Container, Graphics } from 'pixi.js';
import type { Vehicle } from '../state/types';

export function drawVehicle(v: Vehicle): Container {
  const g = new Container();
  const body = new Graphics();
  const color = v.status === 'failed' ? 0xff4444 : v.status === 'arrived' ? 0x44ffaa : 0x88ccff;
  body.beginFill(color, 0.95);
  body.drawRect(-6, -4, 12, 8);
  body.endFill();
  body.beginFill(0xffffff, 0.5);
  body.drawCircle(0, 0, 2);
  body.endFill();
  g.addChild(body);
  return g;
}
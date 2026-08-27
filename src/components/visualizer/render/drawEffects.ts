// src/components/visualizer/render/drawEffects.ts
import { Container, Graphics } from 'pixi.js';
import type { Effect } from '../state/types';
import type { ScreenPoint } from './projection';

export function drawEffects(
  container: Container,
  effects: Array<{ effect: Effect; origin: ScreenPoint }>,
  now: number,
): void {
  for (const { effect, origin } of effects) {
    if (now - effect.bornAt > effect.ttl) continue;
    const age = (now - effect.bornAt) / effect.ttl;
    const fx = new Graphics();
    if (effect.kind === 'pulse') {
      fx.lineStyle(2, 0x44ffaa, 1 - age);
      fx.drawCircle(origin.x, origin.y - age * 40, 6 + age * 26);
    } else if (effect.kind === 'smoke') {
      fx.beginFill(0x555555, Math.max(0, 0.6 - age * 0.5));
      fx.drawCircle(origin.x + Math.sin(now / 300) * 6, origin.y - 20 - age * 30, 8 + age * 14);
      fx.endFill();
    } else {
      // explosion / beacon: expanding ring in red
      fx.lineStyle(3, 0xff4444, 1 - age);
      fx.drawCircle(origin.x, origin.y - 10, 4 + age * 30);
    }
    container.addChild(fx);
  }
}
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
      fx.lineStyle(3, 0x44ffaa, Math.max(0, 1 - age));
      fx.drawCircle(origin.x, origin.y - age * 46, 6 + age * 34);
      fx.lineStyle(2, 0xaaffcc, Math.max(0, 0.6 * (1 - age)));
      fx.drawCircle(origin.x, origin.y - age * 46, 4 + age * 50);
    } else if (effect.kind === 'smoke') {
      // three rising puffs, staggered
      for (let i = 0; i < 3; i += 1) {
        const puffAge = Math.max(0, age * 1.4 - i * 0.15);
        const off = (i - 1) * 7;
        fx.beginFill(0x666666, Math.max(0, 0.5 - puffAge * 0.6));
        fx.drawCircle(
          origin.x + off + Math.sin(now / 240 + i) * 4,
          origin.y - 24 - puffAge * 46,
          7 + puffAge * 16 + i * 2,
        );
        fx.endFill();
      }
    } else {
      // explosion / beacon: bright expanding ring
      fx.lineStyle(3, 0xff6644, Math.max(0, 1 - age));
      fx.drawCircle(origin.x, origin.y - 12, 6 + age * 42);
      fx.lineStyle(2, 0xffcc88, Math.max(0, 0.6 * (1 - age)));
      fx.drawCircle(origin.x, origin.y - 12, 4 + age * 54);
      // ember sparks radiating outward
      for (let i = 0; i < 10; i += 1) {
        const ang = (i / 10) * Math.PI * 2 + age * 0.8;
        const rad = 12 + age * 34 + (i % 3) * 6;
        fx.beginFill(0xffaa44, Math.max(0, 0.8 * (1 - age)));
        fx.drawCircle(origin.x + Math.cos(ang) * rad, origin.y - 12 + Math.sin(ang) * rad * 0.6, 2);
        fx.endFill();
      }
    }
    container.addChild(fx);
  }
}
// src/components/visualizer/render/scene.ts
import { Container, Graphics, Ticker } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import type { SimState, Building, Effect } from '../state/types';
import { projectToScreen } from './projection';
import { vehicleProgress } from './motion';
import { drawBuilding } from './drawBuilding';
import { drawRoads } from './drawRoads';
import { drawVehicle } from './drawVehicle';
import { drawEffects } from './drawEffects';

export interface SceneHandle {
  root: Container;
  update(state: SimState, now: number): void;
  destroy(): void;
  onBuildingClick(cb: (slug: string) => void): void;
}

export interface AppLike {
  stage: Container;
  screen: { width: number; height: number };
}

export function createScene(app: AppLike): SceneHandle {
  const root = new Container();
  const roads = new Graphics();
  const buildings = new Container();
  const effects = new Container();
  const vehicles = new Container();
  const ambient = new Container();
  root.addChild(roads);
  root.addChild(buildings);
  root.addChild(effects);
  root.addChild(vehicles);
  root.addChild(ambient);
  app.stage.addChild(root);

  // center the iso world (city hall at canvas center)
  root.position.set(app.screen.width / 2, app.screen.height / 2);

  // neon bloom on buildings + vehicles
  const bloom = new AdvancedBloomFilter({ blur: 0.8, brightness: 1.15, quality: 3 });
  buildings.filters = [bloom];
  vehicles.filters = [bloom];

  let clickCb: (slug: string) => void = () => {};
  let lastBuildings: Record<string, Building> | null = null;

  function syncBuildings(state: SimState): void {
    if (lastBuildings === state.buildings) return;
    lastBuildings = state.buildings;
    buildings.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const b of Object.values(state.buildings)) {
      const g = drawBuilding(b);
      const p = projectToScreen(b.gridX, b.gridY, 0);
      g.position.set(p.x, p.y);
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.on('pointertap', () => clickCb(b.slug));
      buildings.addChild(g);
    }
    drawRoads(roads, Object.values(state.buildings));
  }

  function syncAmbient(now: number): void {
    ambient.removeChildren().forEach((c) => c.destroy({ children: true }));
    const count = 14;
    for (let i = 0; i < count; i += 1) {
      const speed = 0.0003 + ((i * 37) % 10) * 0.00002;
      const r = 90 + (i % 5) * 44;
      const a = now * speed + i * 1.7;
      const x = Math.cos(a) * r;
      const y = Math.sin(a * 1.3) * r * 0.5 + Math.sin(a) * 8;
      const dot = new Graphics();
      dot.beginFill(0x66ccff, 0.35);
      dot.drawCircle(0, 0, 1.6 + Math.sin(now / 500 + i) * 0.6);
      dot.endFill();
      dot.position.set(x, y);
      ambient.addChild(dot);
    }
  }

  const ticker = new Ticker();
  ticker.start();

  const handle = {
    root,
    update(state: SimState, now: number) {
      syncBuildings(state);
      syncAmbient(now);
      // vehicles
      vehicles.removeChildren().forEach((c) => c.destroy({ children: true }));
      for (const v of Object.values(state.vehicles)) {
        if (v.status !== 'transit') continue;
        const from = state.buildings[v.from];
        const to = state.buildings[v.to];
        if (!from || !to) continue;
        const p = vehicleProgress(v, now);
        const sx = from.gridX + (to.gridX - from.gridX) * p;
        const sy = from.gridY + (to.gridY - from.gridY) * p;
        const sp = projectToScreen(sx, sy, 1);
        const g = drawVehicle(v);
        g.position.set(sp.x, sp.y);
        vehicles.addChild(g);
      }
      // effects
      effects.removeChildren().forEach((c) => c.destroy({ children: true }));
      const resolvedEffects: Array<{ effect: Effect; origin: ReturnType<typeof projectToScreen> }> = [];
      for (const e of Object.values(state.effects)) {
        const b = state.buildings[e.slug];
        if (!b) continue;
        resolvedEffects.push({ effect: e, origin: projectToScreen(b.gridX, b.gridY, b.height) });
      }
      drawEffects(effects, resolvedEffects, now);
    },
    destroy() {
      ticker.destroy();
      root.destroy({ children: true });
    },
    onBuildingClick(cb: (slug: string) => void) { clickCb = cb; },
  };
  return handle;
}
// src/components/visualizer/render/scene.ts
import { Container, Graphics, Ticker } from 'pixi.js';
import type { SimState, Building, Effect } from '../state/types';
import { projectToScreen } from './projection';
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
  const vehicles = new Container();
  const effects = new Container();
  root.addChild(roads);
  root.addChild(buildings);
  root.addChild(effects);
  root.addChild(vehicles);
  app.stage.addChild(root);

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

  const ticker = new Ticker();
  ticker.start();

  const handle = {
    root,
    update(state: SimState, now: number) {
      syncBuildings(state);
      // vehicles
      vehicles.removeChildren().forEach((c) => c.destroy({ children: true }));
      for (const v of Object.values(state.vehicles)) {
        if (v.status !== 'transit') continue;
        const from = state.buildings[v.from];
        const to = state.buildings[v.to];
        if (!from || !to) continue;
        const sx = from.gridX + (to.gridX - from.gridX) * v.progress;
        const sy = from.gridY + (to.gridY - from.gridY) * v.progress;
        const p = projectToScreen(sx, sy, 1);
        const g = drawVehicle(v);
        g.position.set(p.x, p.y);
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
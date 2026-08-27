import { describe, expect, it } from 'vitest';
import { projectToScreen, screenToGrid, TILE_W, TILE_H } from '../../src/components/visualizer/render/projection';

describe('iso projection', () => {
  it('exports sane tile constants', () => {
    expect(TILE_W).toBe(64);
    expect(TILE_H).toBe(32);
  });
  it('projects city hall center to origin', () => {
    const p = projectToScreen(0, 0, 0);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });
  it('projects a building above the ground higher on screen', () => {
    const base = projectToScreen(1, 1, 0);
    const tall = projectToScreen(1, 1, 4);
    expect(tall.y).toBeLessThan(base.y);
  });
  it('round-trips screen -> grid for integer coords', () => {
    for (const [x, y] of [[0, 0], [3, 2], [-2, 4]] as const) {
      const p = projectToScreen(x, y, 0);
      const g = screenToGrid(p.x, p.y);
      expect(Math.round(g.x)).toBe(x);
      expect(Math.round(g.y)).toBe(y);
    }
  });
});
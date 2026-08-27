// src/components/visualizer/render/projection.ts
export const TILE_W = 64;
export const TILE_H = 32;

export interface ScreenPoint { x: number; y: number }
export interface GridPoint { x: number; y: number; z: number }

/** Grid (x,y) with height z -> screen pixel (origin = center of world at z=0). */
export function projectToScreen(x: number, y: number, z = 0): ScreenPoint {
  return {
    x: ((x - y) * TILE_W) / 2,
    y: ((x + y) * TILE_H) / 2 - z * TILE_H,
  };
}

/** Inverse projection (assumes z=0 plane) -> grid coords. */
export function screenToGrid(sx: number, sy: number): GridPoint {
  const a = (2 * sx) / TILE_W;
  const b = (2 * sy) / TILE_H;
  return {
    x: (a + b) / 2,
    y: (b - a) / 2,
    z: 0,
  };
}
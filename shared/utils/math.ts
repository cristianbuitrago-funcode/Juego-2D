import type { Cost, Resources, Vec2 } from '../types/game';
import { RESOURCE_TYPES } from '../types/game';

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distancia de un punto a un rectángulo (0 si está dentro). */
export function distToRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): number {
  const cx = clamp(px, rx, rx + rw);
  const cy = clamp(py, ry, ry + rh);
  return dist(px, py, cx, cy);
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emptyResources(): Resources {
  return { gold: 0, wood: 0, stone: 0, food: 0 };
}

export function costEntries(cost: Cost): [keyof Resources, number][] {
  return RESOURCE_TYPES.filter((r) => (cost[r] ?? 0) > 0).map((r) => [r, cost[r] as number]);
}

export function canAffordCost(res: Resources, cost: Cost): boolean {
  return RESOURCE_TYPES.every((r) => res[r] >= (cost[r] ?? 0));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

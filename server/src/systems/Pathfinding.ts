import { terrainDef } from '@shared/constants/terrain';
import type { Vec2 } from '@shared/types/game';
import { distToRect } from '@shared/utils/math';
import type { GameMap } from '../game/GameMap';

/** Objetivo de búsqueda: llegar a `range` casillas de un punto o de un rectángulo. */
export interface PathGoal {
  x: number;
  y: number;
  range: number;
  rect?: { x: number; y: number; w: number; h: number };
}

const MAX_NODES = 7000;
const SQRT2 = Math.SQRT2;
const MAX_SPEED = 1.4;

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    const a = this.items;
    const pr = this.prio;
    a.push(item);
    pr.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      [pr[parent], pr[i]] = [pr[i], pr[parent]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const pr = this.prio;
    const top = a[0];
    const lastI = a.pop()!;
    const lastP = pr.pop()!;
    if (a.length > 0) {
      a[0] = lastI;
      pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && pr[l] < pr[m]) m = l;
        if (r < a.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [pr[m], pr[i]] = [pr[i], pr[m]];
        i = m;
      }
    }
    return top;
  }
}

function goalDistance(goal: PathGoal, x: number, y: number): number {
  if (goal.rect) return distToRect(x, y, goal.rect.x, goal.rect.y, goal.rect.w, goal.rect.h);
  return Math.hypot(x - goal.x, y - goal.y);
}

/**
 * A* sobre la rejilla de casillas (8 direcciones, sin cortar esquinas).
 * El coste de cada paso depende de la velocidad del terreno (caminos rápidos, bosques/montañas lentos).
 * Si el objetivo es inalcanzable devuelve el camino hasta la casilla alcanzable más cercana.
 */
export function findPath(map: GameMap, sx: number, sy: number, goal: PathGoal): Vec2[] {
  const W = map.width;
  const start = Math.floor(sy) * W + Math.floor(sx);
  const startTx = Math.floor(sx);
  const startTy = Math.floor(sy);
  if (!map.inBounds(startTx, startTy)) return [];

  if (goalDistance(goal, sx, sy) <= goal.range) return [];

  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  const h = (tx: number, ty: number) => Math.max(0, goalDistance(goal, tx + 0.5, ty + 0.5) - goal.range) / MAX_SPEED;

  g.set(start, 0);
  open.push(start, h(startTx, startTy));
  let bestNode = start;
  let bestH = h(startTx, startTy);
  let found = -1;
  let expanded = 0;

  while (open.size > 0 && expanded < MAX_NODES) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    expanded++;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    const hc = h(cx, cy);
    if (goalDistance(goal, cx + 0.5, cy + 0.5) <= goal.range) {
      found = cur;
      break;
    }
    if (hc < bestH) {
      bestH = hc;
      bestNode = cur;
    }
    const gc = g.get(cur)!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!map.isWalkable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!map.isWalkable(cx + dx, cy) || !map.isWalkable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (closed.has(ni)) continue;
        const speed = terrainDef(map.terrain(nx, ny)).speed;
        const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) / speed;
        const ng = gc + step;
        if (ng < (g.get(ni) ?? Infinity)) {
          g.set(ni, ng);
          came.set(ni, cur);
          open.push(ni, ng + h(nx, ny));
        }
      }
    }
  }

  const end = found >= 0 ? found : bestNode;
  if (end === start) return [];
  const tiles: number[] = [];
  for (let n: number | undefined = end; n !== undefined && n !== start; n = came.get(n)) tiles.push(n);
  tiles.reverse();
  const pts = tiles.map((t) => ({ x: (t % W) + 0.5, y: Math.floor(t / W) + 0.5 }));

  // Si el destino exacto es transitable y está en la última casilla, terminar en el punto exacto.
  if (found >= 0 && !goal.rect && goal.range < 0.75) {
    const last = pts[pts.length - 1];
    if (Math.floor(goal.x) === Math.floor(last.x) && Math.floor(goal.y) === Math.floor(last.y)) {
      last.x = goal.x;
      last.y = goal.y;
    }
  }
  return smoothPath(map, sx, sy, pts);
}

/** Elimina puntos intermedios innecesarios cuando hay línea recta transitable. */
function smoothPath(map: GameMap, sx: number, sy: number, pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !map.hasClearLine(ax, ay, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}

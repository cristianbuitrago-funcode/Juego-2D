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

const MAX_NODES = 4500;
const SQRT2 = Math.SQRT2;
// Heurística ligeramente inflada (A* ponderado): rutas casi óptimas explorando muchas menos casillas.
const MAX_SPEED = 0.9;

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
// Búferes reutilizables (evitan crear Map/Set en cada búsqueda). `stamp` marca qué celdas son de la búsqueda actual.
let bufSize = 0;
let gScore = new Float32Array(0);
let cameFrom = new Int32Array(0);
let stamp = new Uint32Array(0);
let closedStamp = new Uint32Array(0);
let search = 0;

function ensureBuffers(n: number) {
  if (n <= bufSize) return;
  bufSize = n;
  gScore = new Float32Array(n);
  cameFrom = new Int32Array(n);
  stamp = new Uint32Array(n);
  closedStamp = new Uint32Array(n);
}

export function findPath(map: GameMap, sx: number, sy: number, goal: PathGoal): Vec2[] {
  const W = map.width;
  const startTx = Math.floor(sx);
  const startTy = Math.floor(sy);
  if (!map.inBounds(startTx, startTy)) return [];
  const start = startTy * W + startTx;

  if (goalDistance(goal, sx, sy) <= goal.range) return [];

  ensureBuffers(W * map.height);
  search++;
  const cur0 = search;
  const open = new MinHeap();
  const h = (tx: number, ty: number) => Math.max(0, goalDistance(goal, tx + 0.5, ty + 0.5) - goal.range) / MAX_SPEED;

  gScore[start] = 0;
  stamp[start] = cur0;
  cameFrom[start] = -1;
  open.push(start, h(startTx, startTy));
  let bestNode = start;
  let bestH = h(startTx, startTy);
  let found = -1;
  let expanded = 0;

  while (open.size > 0 && expanded < MAX_NODES) {
    const cur = open.pop();
    if (closedStamp[cur] === cur0) continue;
    closedStamp[cur] = cur0;
    expanded++;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    if (goalDistance(goal, cx + 0.5, cy + 0.5) <= goal.range) {
      found = cur;
      break;
    }
    const hc = h(cx, cy);
    if (hc < bestH) {
      bestH = hc;
      bestNode = cur;
    }
    const gc = gScore[cur];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!map.isWalkable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!map.isWalkable(cx + dx, cy) || !map.isWalkable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (closedStamp[ni] === cur0) continue;
        const speed = terrainDef(map.tiles[ni]).speed;
        const ng = gc + (dx !== 0 && dy !== 0 ? SQRT2 : 1) / speed;
        if (stamp[ni] !== cur0 || ng < gScore[ni]) {
          stamp[ni] = cur0;
          gScore[ni] = ng;
          cameFrom[ni] = cur;
          open.push(ni, ng + h(nx, ny));
        }
      }
    }
  }

  const end = found >= 0 ? found : bestNode;
  if (end === start) return [];
  const tiles: number[] = [];
  for (let n = end; n !== -1 && n !== start; n = cameFrom[n]) tiles.push(n);
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

/**
 * Elimina puntos intermedios innecesarios cuando hay línea recta transitable.
 * Versión voraz hacia delante: O(n) comprobaciones de línea en vez de O(n²).
 */
function smoothPath(map: GameMap, sx: number, sy: number, pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < pts.length) {
    let j = i;
    // Avanzar mientras haya línea directa (con un máximo para limitar el coste de cada comprobación).
    while (j + 1 < pts.length && j - i < 24 && map.hasClearLine(ax, ay, pts[j + 1].x, pts[j + 1].y)) j++;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}

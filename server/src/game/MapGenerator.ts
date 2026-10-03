import { Terrain } from '@shared/constants/terrain';
import type { MapData, ResourceType, Vec2 } from '@shared/types/game';
import { createRng } from '@shared/utils/math';

/**
 * Generador procedural de mapas simétricos (justos para 2-4 jugadores).
 * Se genera un cuadrante y se refleja en ambos ejes. Para ampliar:
 *  - nuevos tamaños: MAP_SIZES en shared/config/gameConfig.ts
 *  - mapas hechos a mano: construir un MapData a mano y pasarlo a Game (no requiere tocar el resto del código).
 */
export interface MapGenOptions {
  size: number;
  seed: number;
  controlPoints: number;
}

function valueNoise(rng: () => number, w: number, h: number, cell: number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh).map(() => rng());
  const out = new Float32Array(w * h);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const a = grid[y0 * gw + x0];
      const b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0];
      const d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

export function generateMap(opts: MapGenOptions): MapData {
  const N = opts.size - (opts.size % 2);
  const h = N / 2;
  const rng = createRng(opts.seed);
  const q = new Uint8Array(h * h).fill(Terrain.Grass);
  const qi = (x: number, y: number) => y * h + x;
  const inQ = (x: number, y: number) => x >= 0 && y >= 0 && x < h && y < h;

  const nDirt = valueNoise(rng, h, h, 5);
  const nForest = valueNoise(rng, h, h, 4);
  const nWater = valueNoise(rng, h, h, 7);
  const nMount = valueNoise(rng, h, h, 6);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const i = qi(x, y);
      if (nDirt[i] > 0.62) q[i] = Terrain.Dirt;
      if (nForest[i] > 0.66) q[i] = Terrain.Forest;
      if (nMount[i] > 0.76) q[i] = Terrain.Mountain;
      if (nWater[i] > 0.74) q[i] = Terrain.Water;
    }
  }

  const margin = Math.max(6, Math.round(N * 0.12));
  const spawn = { x: margin, y: margin };

  const paint = (cx: number, cy: number, r: number, t: Terrain, onlyIf?: (cur: number) => boolean) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!inQ(x, y)) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        if (onlyIf && !onlyIf(q[qi(x, y)])) continue;
        q[qi(x, y)] = t;
      }
    }
  };

  // Zona de inicio despejada.
  paint(spawn.x, spawn.y, 7.5, Terrain.Grass);
  paint(spawn.x, spawn.y, 2.5, Terrain.Dirt);

  // Bosque garantizado cerca de la base.
  const forestC = { x: spawn.x - 3, y: spawn.y + 8 };
  paint(forestC.x, forestC.y, 3.2, Terrain.Forest);

  // Caminos: base -> centro del mapa y base -> borde horizontal (conecta con el cuadrante reflejado).
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      if (inQ(x, y)) q[qi(x, y)] = Terrain.Road;
      if (inQ(x + 1, y) && q[qi(x + 1, y)] === Terrain.Water) q[qi(x + 1, y)] = Terrain.Road;
    }
  };
  line(spawn.x + 2, spawn.y + 2, h - 1, h - 1);
  line(spawn.x + 2, spawn.y, h - 1, spawn.y);
  line(spawn.x, spawn.y + 2, spawn.x, h - 1);

  // Recursos del cuadrante (coordenadas de casilla del cuadrante).
  const res: { type: ResourceType; x: number; y: number; amount: number }[] = [];
  const addNode = (type: ResourceType, x: number, y: number, amount: number, zone: boolean) => {
    if (!inQ(x, y)) return;
    if (zone) paint(x, y, 1.6, Terrain.ResourceZone, (c) => c !== Terrain.Road);
    else if (q[qi(x, y)] === Terrain.Water || q[qi(x, y)] === Terrain.Mountain) q[qi(x, y)] = Terrain.Grass;
    res.push({ type, x, y, amount });
  };
  // Cerca de la base.
  addNode('gold', spawn.x + 6, spawn.y - 2, 1500, true);
  addNode('gold', spawn.x + 7, spawn.y - 1, 1500, false);
  addNode('stone', spawn.x - 2, spawn.y + 5, 1200, true);
  addNode('stone', spawn.x - 1, spawn.y + 6, 1200, false);
  for (const [dx, dy] of [[4, 4], [5, 4], [4, 5]]) addNode('food', spawn.x + dx, spawn.y + dy, 300, false);
  // Árboles en el bosque garantizado.
  for (let y = Math.floor(forestC.y - 3); y <= forestC.y + 3; y++) {
    for (let x = Math.floor(forestC.x - 3); x <= forestC.x + 3; x++) {
      if (inQ(x, y) && q[qi(x, y)] === Terrain.Forest && rng() < 0.45) res.push({ type: 'wood', x, y, amount: 200 });
    }
  }
  // Árboles dispersos en otros bosques.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      if (q[qi(x, y)] === Terrain.Forest && Math.hypot(x - forestC.x, y - forestC.y) > 4 && rng() < 0.1) {
        res.push({ type: 'wood', x, y, amount: 200 });
      }
    }
  }
  // Yacimientos ricos hacia el centro (zona disputada).
  addNode('gold', h - 5, h - 9, 2500, true);
  addNode('stone', h - 9, h - 5, 2000, true);

  // Puntos de control.
  const cpQuad: Vec2[] = [];
  if (opts.controlPoints >= 5) cpQuad.push({ x: Math.round(h * 0.78), y: Math.round(h * 0.35) });
  for (const p of cpQuad) paint(p.x, p.y, 3, Terrain.Grass);
  paint(h - 1, h - 1, 3.5, Terrain.Grass);
  for (const p of cpQuad) paint(p.x, p.y, 1.5, Terrain.Strategic);
  paint(h, h, 1.8, Terrain.Strategic);

  // Reflejo en ambos ejes.
  const tiles = new Array<number>(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = x < h ? x : N - 1 - x;
      const sy = y < h ? y : N - 1 - y;
      tiles[y * N + x] = q[qi(sx, sy)];
    }
  }
  const mirror = (p: { x: number; y: number }) => [
    { x: p.x, y: p.y },
    { x: N - 1 - p.x, y: N - 1 - p.y },
    { x: N - 1 - p.x, y: p.y },
    { x: p.x, y: N - 1 - p.y },
  ];
  const resources = res.flatMap((r) => mirror(r).map((m) => ({ ...r, x: m.x, y: m.y })));
  // Orden de aparición: esquina superior izquierda, inferior derecha, superior derecha, inferior izquierda.
  const spawns = mirror(spawn).map((s) => ({ x: s.x + 0.5, y: s.y + 0.5 }));
  const controlPoints: Vec2[] = [{ x: N / 2, y: N / 2 }];
  for (const p of cpQuad) for (const m of mirror(p)) controlPoints.push({ x: m.x + 0.5, y: m.y + 0.5 });

  return { width: N, height: N, tiles, spawns, controlPoints: controlPoints.slice(0, Math.max(1, opts.controlPoints)), resources };
}

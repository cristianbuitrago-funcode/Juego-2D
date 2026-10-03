import { terrainDef, Terrain } from '@shared/constants/terrain';

/** Mapa de casillas del servidor: terreno + ocupación (edificios y yacimientos). */
export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  /** Id de la entidad que ocupa la casilla (0 = libre). */
  readonly occupant: Int32Array;

  constructor(width: number, height: number, tiles: ArrayLike<number>) {
    this.width = width;
    this.height = height;
    this.tiles = Uint8Array.from(tiles);
    this.occupant = new Int32Array(width * height);
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  terrain(tx: number, ty: number): Terrain {
    if (!this.inBounds(tx, ty)) return Terrain.Water;
    return this.tiles[ty * this.width + tx] as Terrain;
  }

  /** Velocidad relativa en una posición continua. */
  speedAt(x: number, y: number): number {
    return terrainDef(this.terrain(Math.floor(x), Math.floor(y))).speed;
  }

  /** Transitable por unidades terrestres (terreno + sin edificios/yacimientos). */
  isWalkable(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const i = ty * this.width + tx;
    return terrainDef(this.tiles[i]).speed > 0 && this.occupant[i] === 0;
  }

  isWalkableAt(x: number, y: number): boolean {
    return this.isWalkable(Math.floor(x), Math.floor(y));
  }

  setOccupant(tx: number, ty: number, size: number, id: number) {
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (this.inBounds(x, y)) this.occupant[y * this.width + x] = id;
      }
    }
  }

  /** Busca la casilla transitable más cercana a (x, y) en anillos crecientes. */
  nearestWalkable(x: number, y: number, maxRadius = 10): { x: number; y: number } | null {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (this.isWalkable(cx, cy)) return { x: cx + 0.5, y: cy + 0.5 };
    for (let r = 1; r <= maxRadius; r++) {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (!this.isWalkable(tx, ty)) continue;
          const d = (tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: tx + 0.5, y: ty + 0.5 };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Línea de paso libre entre dos puntos (muestreo cada 0.25 casillas). */
  hasClearLine(x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 0.25);
    const startTerrain = this.terrain(Math.floor(x0), Math.floor(y0));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (!this.isWalkable(tx, ty)) return false;
      // No recortamos atravesando terreno más lento que el inicial (p. ej. montañas).
      if (terrainDef(this.terrain(tx, ty)).speed < terrainDef(startTerrain).speed - 0.3) return false;
    }
    return true;
  }
}

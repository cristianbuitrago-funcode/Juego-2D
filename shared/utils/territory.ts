import { BUILDING_DEFS } from '../constants/buildings';
import type { BuildingType } from '../types/game';

export interface TerritorySource {
  owner: number;
  type: BuildingType;
  /** Casilla superior izquierda. */
  tx: number;
  ty: number;
}

/**
 * Calcula el dueño de cada casilla a partir de los edificios.
 * Regla: cada edificio proyecta un radio; una casilla pertenece al edificio cuya distancia
 * normalizada (distancia / radio) sea menor. Se usa igual en servidor (validación) y cliente (dibujo).
 */
export function computeTerritory(width: number, height: number, sources: TerritorySource[]): Int8Array {
  const owner = new Int8Array(width * height).fill(-1);
  const best = new Float32Array(width * height).fill(Infinity);
  for (const s of sources) {
    const def = BUILDING_DEFS[s.type];
    const r = def.territory;
    const cx = s.tx + def.size / 2;
    const cy = s.ty + def.size / 2;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d > 1) continue;
        const i = y * width + x;
        if (d < best[i]) {
          best[i] = d;
          owner[i] = s.owner;
        }
      }
    }
  }
  return owner;
}

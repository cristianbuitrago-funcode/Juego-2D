import { Terrain, TERRAIN_DEFS } from '@shared/constants/terrain';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import { createRng } from '@shared/utils/math';

const TILE = GAME_CONFIG.tileSize;

/**
 * Pre-renderiza el terreno una sola vez en un canvas fuera de pantalla (texturas procedurales).
 * Cada fotograma solo se copia la porción visible.
 */
export function renderTerrain(width: number, height: number, tiles: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width * TILE;
  c.height = height * TILE;
  const ctx = c.getContext('2d')!;
  const rng = createRng(width * 7919 + height);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? -1 : tiles[y * width + x]);

  // 1) Color base con variación por casilla.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[y * width + x] as Terrain;
      const base = TERRAIN_DEFS[t].color;
      ctx.fillStyle = base;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      const v = rng();
      ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.08})` : `rgba(0,0,0,${(0.5 - v) * 0.1})`;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  // 2) Detalles por tipo de terreno.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[y * width + x] as Terrain;
      const px = x * TILE;
      const py = y * TILE;
      switch (t) {
        case Terrain.Grass:
          ctx.strokeStyle = 'rgba(30, 70, 25, 0.35)';
          ctx.lineWidth = 1;
          for (let i = 0; i < 4; i++) {
            const gx = px + rng() * TILE;
            const gy = py + rng() * TILE;
            ctx.beginPath();
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + 1, gy - 3);
            ctx.stroke();
          }
          if (rng() < 0.04) {
            ctx.fillStyle = ['#fde68a', '#fca5a5', '#e9d5ff'][Math.floor(rng() * 3)];
            ctx.beginPath();
            ctx.arc(px + rng() * TILE, py + rng() * TILE, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case Terrain.Dirt:
        case Terrain.ResourceZone:
          ctx.fillStyle = t === Terrain.ResourceZone ? 'rgba(90, 80, 50, 0.5)' : 'rgba(80, 55, 30, 0.35)';
          for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(px + rng() * TILE, py + rng() * TILE, 1 + rng() * 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case Terrain.Road:
          ctx.fillStyle = 'rgba(120, 95, 60, 0.35)';
          for (let i = 0; i < 3; i++) ctx.fillRect(px + rng() * TILE, py + rng() * TILE, 3, 2);
          break;
        case Terrain.Water: {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1.2;
          const wy = py + 8 + rng() * 16;
          ctx.beginPath();
          ctx.moveTo(px + 4, wy);
          ctx.quadraticCurveTo(px + 10, wy - 3, px + 16, wy);
          ctx.quadraticCurveTo(px + 22, wy + 3, px + 28, wy);
          ctx.stroke();
          break;
        }
        case Terrain.Mountain: {
          const peaks = 2;
          for (let i = 0; i < peaks; i++) {
            const mx = px + 6 + rng() * 20;
            const my = py + 26 - rng() * 4;
            const h = 14 + rng() * 10;
            ctx.fillStyle = '#6b6863';
            ctx.beginPath();
            ctx.moveTo(mx - 11, my);
            ctx.lineTo(mx, my - h);
            ctx.lineTo(mx + 11, my);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#918d87';
            ctx.beginPath();
            ctx.moveTo(mx, my - h);
            ctx.lineTo(mx + 11, my);
            ctx.lineTo(mx + 3, my);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#eef2f7';
            ctx.beginPath();
            ctx.moveTo(mx, my - h);
            ctx.lineTo(mx - 3.5, my - h + 5);
            ctx.lineTo(mx + 3.5, my - h + 5);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }
        case Terrain.Forest:
          for (let i = 0; i < 3; i++) {
            const fx = px + 6 + rng() * 20;
            const fy = py + 6 + rng() * 20;
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(fx + 2, fy + 5, 7, 3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = rng() > 0.5 ? '#245a28' : '#2e6f31';
            ctx.beginPath();
            ctx.arc(fx, fy, 6 + rng() * 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath();
            ctx.arc(fx - 2, fy - 2, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case Terrain.Strategic:
          ctx.strokeStyle = 'rgba(90, 75, 50, 0.45)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 1.5, py + 1.5, TILE / 2 - 2, TILE / 2 - 2);
          ctx.strokeRect(px + TILE / 2 + 0.5, py + TILE / 2 + 0.5, TILE / 2 - 2, TILE / 2 - 2);
          break;
      }
    }
  }

  // 3) Orillas: borde suave entre agua y tierra.
  ctx.strokeStyle = 'rgba(233, 222, 170, 0.75)';
  ctx.lineWidth = 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) !== Terrain.Water) continue;
      const px = x * TILE;
      const py = y * TILE;
      ctx.beginPath();
      if (at(x, y - 1) >= 0 && at(x, y - 1) !== Terrain.Water) {
        ctx.moveTo(px, py + 1);
        ctx.lineTo(px + TILE, py + 1);
      }
      if (at(x, y + 1) >= 0 && at(x, y + 1) !== Terrain.Water) {
        ctx.moveTo(px, py + TILE - 1);
        ctx.lineTo(px + TILE, py + TILE - 1);
      }
      if (at(x - 1, y) >= 0 && at(x - 1, y) !== Terrain.Water) {
        ctx.moveTo(px + 1, py);
        ctx.lineTo(px + 1, py + TILE);
      }
      if (at(x + 1, y) >= 0 && at(x + 1, y) !== Terrain.Water) {
        ctx.moveTo(px + TILE - 1, py);
        ctx.lineTo(px + TILE - 1, py + TILE);
      }
      ctx.stroke();
    }
  }
  return c;
}

/** Imagen base del minimapa (1 píxel por casilla). */
export function renderMinimapBase(width: number, height: number, tiles: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < tiles.length; i++) {
    const hex = TERRAIN_DEFS[tiles[i] as Terrain].minimap;
    const n = parseInt(hex.slice(1), 16);
    img.data[i * 4] = (n >> 16) & 255;
    img.data[i * 4 + 1] = (n >> 8) & 255;
    img.data[i * 4 + 2] = n & 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

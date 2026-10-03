import { BUILDING_DEFS } from '@shared/constants/buildings';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { BuildingType } from '@shared/types/game';
import { withAlpha } from '../assets/palette';
import type { Camera } from '../systems/Camera';
import type { ClientWorld } from '../systems/ClientWorld';
import { renderMinimapBase } from './MapRenderer';

const TILE = GAME_CONFIG.tileSize;

/**
 * Minimapa: terreno, territorio propio y enemigo descubierto, unidades propias,
 * enemigos visibles, puntos estratégicos y rectángulo de cámara.
 * Click/arrastre izquierdo mueve la cámara; click derecho envía las unidades seleccionadas.
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private dragging = false;
  onRightClick: ((tx: number, ty: number) => void) | null = null;
  onAlert: { x: number; y: number; until: number } | null = null;

  constructor(
    private readonly world: ClientWorld,
    private readonly camera: Camera,
    size = 180,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.base = renderMinimapBase(world.width, world.height, world.tiles);
    this.overlay = document.createElement('canvas');
    this.overlay.width = world.width;
    this.overlay.height = world.height;

    const toTile = (ev: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: ((ev.clientX - r.left) / r.width) * world.width, y: ((ev.clientY - r.top) / r.height) * world.height };
    };
    this.canvas.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const t = toTile(ev);
      if (ev.button === 2) {
        this.onRightClick?.(t.x, t.y);
        return;
      }
      this.dragging = true;
      this.canvas.setPointerCapture(ev.pointerId);
      camera.centerOnTile(t.x, t.y);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (!this.dragging) return;
      const t = toTile(ev);
      camera.centerOnTile(t.x, t.y);
    });
    const stop = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  draw(now: number) {
    const { ctx, world } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sx = W / world.width;
    const sy = H / world.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, W, H);

    // Territorio + niebla en un único overlay de 1 px por casilla.
    const oc = this.overlay.getContext('2d')!;
    const img = oc.createImageData(world.width, world.height);
    const terr = world.getTerritory();
    const rgbCache = new Map<number, number[]>();
    for (let i = 0; i < terr.length; i++) {
      const vis = world.visible[i];
      const exp = world.explored[i];
      const o = terr[i];
      if (!exp) {
        img.data.set([10, 13, 18, 255], i * 4);
        continue;
      }
      if (o >= 0) {
        let rgb = rgbCache.get(o);
        if (!rgb) {
          const n = parseInt(world.colorOf(o).slice(1), 16);
          rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
          rgbCache.set(o, rgb);
        }
        img.data.set([rgb[0], rgb[1], rgb[2], vis ? 90 : 110], i * 4);
      } else if (!vis) {
        img.data.set([10, 13, 18, 120], i * 4);
      }
    }
    oc.putImageData(img, 0, 0);
    ctx.drawImage(this.overlay, 0, 0, W, H);

    // Puntos estratégicos
    for (const cp of world.controlPoints) {
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cp.x * sx, cp.y * sy, cp.radius * sx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = cp.owner >= 0 ? this.teamColor(cp.owner) : '#fef3c7';
      ctx.fillRect(cp.x * sx - 2.5, cp.y * sy - 2.5, 5, 5);
    }

    // Edificios (incluidos los recordados) y unidades visibles
    for (const e of [...world.ghosts.values(), ...world.entities.values()]) {
      if (e.k === 'resource') continue;
      const color = e.o === world.me ? '#ffffff' : world.colorOf(e.o);
      if (e.k === 'building') {
        const s = BUILDING_DEFS[e.t as BuildingType].size;
        ctx.fillStyle = color;
        ctx.fillRect(e.x * sx, e.y * sy, Math.max(3, s * sx), Math.max(3, s * sy));
        ctx.strokeStyle = world.colorOf(e.o);
        ctx.lineWidth = 1;
        ctx.strokeRect(e.x * sx, e.y * sy, Math.max(3, s * sx), Math.max(3, s * sy));
      } else {
        ctx.fillStyle = world.isMine(e) ? world.colorOf(e.o) : world.isAlly(e) ? withAlpha(world.colorOf(e.o), 0.9) : '#ff4d4d';
        const d = Math.max(2, sx * 0.9);
        ctx.fillRect(e.rx * sx - d / 2, e.ry * sy - d / 2, d, d);
      }
    }

    // Alerta de ataque
    if (this.onAlert && this.onAlert.until > now) {
      const t = ((this.onAlert.until - now) % 600) / 600;
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.onAlert.x * sx, this.onAlert.y * sy, 4 + t * 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rectángulo de cámara
    const cam = this.camera;
    const a = cam.screenToWorld(0, 0);
    const b = cam.screenToWorld(cam.viewW, cam.viewH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect((a.x / TILE) * sx, (a.y / TILE) * sy, ((b.x - a.x) / TILE) * sx, ((b.y - a.y) / TILE) * sy);
  }

  private teamColor(team: number) {
    if (this.world.mode === 'coop') return team === 0 ? '#38bdf8' : '#ef4444';
    for (const p of this.world.players.values()) if (p.team === team) return p.color;
    return '#fef3c7';
  }
}

import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { BuildingType, ResourceType, UnitType } from '@shared/types/game';
import { withAlpha } from '../assets/palette';
import { drawBuilding, drawResource, drawUnit } from '../entities/sprites';
import type { Camera } from '../systems/Camera';
import type { ClientEntity, ClientWorld } from '../systems/ClientWorld';
import type { Selection } from '../systems/Selection';
import { renderTerrain } from './MapRenderer';
import type { Effects } from './Effects';

const TILE = GAME_CONFIG.tileSize;
const TERRITORY_RES = 8;

export interface OverlayState {
  /** Rectángulo de selección en pantalla. */
  selectionBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Vista previa de construcción. */
  placement: { type: BuildingType; tx: number; ty: number; valid: boolean } | null;
  hoverId: number | null;
  commandMode: 'attack' | 'move' | null;
  showHpAlways: boolean;
}

/** Dibuja el mundo en el canvas principal (Canvas 2D). */
export class GameRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  private territoryCanvas: HTMLCanvasElement;
  private fogCanvas: HTMLCanvasElement;
  private territoryVersion = -1;
  private fogVersion = -1;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: ClientWorld,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.terrain = renderTerrain(world.width, world.height, world.tiles);
    this.territoryCanvas = document.createElement('canvas');
    this.territoryCanvas.width = world.width * TERRITORY_RES;
    this.territoryCanvas.height = world.height * TERRITORY_RES;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = world.width;
    this.fogCanvas.height = world.height;
  }

  resize(cssW: number, cssH: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  teamColor(team: number): string {
    if (this.world.mode === 'coop') return team === 0 ? '#38bdf8' : '#ef4444';
    for (const p of this.world.players.values()) if (p.team === team) return p.color;
    return '#e5e7eb';
  }

  render(cam: Camera, sel: Selection, fx: Effects, ov: OverlayState, now: number) {
    const { ctx, world } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = cam.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, (-cam.x * cam.zoom + cam.viewW / 2) * this.dpr, (-cam.y * cam.zoom + cam.viewH / 2) * this.dpr);
    ctx.imageSmoothingEnabled = true;

    const v = cam.visibleTiles();
    const x0 = Math.max(0, v.x0 - 1);
    const y0 = Math.max(0, v.y0 - 1);
    const x1 = Math.min(world.width, v.x1 + 1);
    const y1 = Math.min(world.height, v.y1 + 1);
    // Terreno (solo la parte visible)
    ctx.drawImage(this.terrain, x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE, x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE);

    this.drawTerritory();
    this.drawControlPoints(now);

    const inView = (x: number, y: number, m = 3) => x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;

    // Recursos (visibles y recordados)
    for (const e of [...world.ghosts.values(), ...world.entities.values()]) {
      if (e.k !== 'resource' || !inView(e.x, e.y)) continue;
      drawResource(ctx, e.t as ResourceType, e.x, e.y, (e.a ?? e.hp) / Math.max(1, e.mhp), !!e.ghost);
      if (sel.ids.has(e.id) || ov.hoverId === e.id) this.selectionRing(e, '#fde047');
    }

    // Círculos de selección bajo las entidades
    for (const e of world.entities.values()) {
      if (e.k === 'resource') continue;
      if (sel.ids.has(e.id)) this.selectionRing(e, this.relationColor(e));
      else if (ov.hoverId === e.id) this.selectionRing(e, withAlpha('#ffffff', 0.5));
    }

    // Edificios y unidades ordenados por profundidad (y)
    const drawables: ClientEntity[] = [];
    for (const e of world.ghosts.values()) if (e.k === 'building' && inView(e.x, e.y)) drawables.push(e);
    for (const e of world.entities.values()) if (e.k !== 'resource' && inView(e.rx, e.ry)) drawables.push(e);
    drawables.sort((a, b) => a.ry - b.ry);
    for (const e of drawables) {
      const color = world.colorOf(e.o);
      if (e.k === 'building') {
        drawBuilding(ctx, { tx: e.x, ty: e.y, type: e.t as BuildingType, color, state: e.s, progress: e.p, level: e.l, time: now, id: e.id, hitAge: now - e.hitAt, ghost: e.ghost });
      } else {
        drawUnit(ctx, { x: e.rx, y: e.ry, type: e.t as UnitType, color, facing: e.f ?? 0, state: e.s, time: now, id: e.id, attackAge: now - e.attackAt, hitAge: now - e.hitAt, carrying: e.ct });
      }
    }

    // Barras de vida / progreso
    for (const e of drawables) {
      if (e.ghost) continue;
      const selected = sel.ids.has(e.id);
      if (selected || ov.showHpAlways || e.hp < e.mhp || ov.hoverId === e.id) this.hpBar(e);
      if (e.k === 'building' && (e.s === 'construction' || e.s === 'upgrading') && e.p !== undefined) {
        this.progressBar(e, e.p, e.s === 'construction' ? '#38bdf8' : '#c084fc');
      } else if (e.k === 'building' && e.q?.length && world.isMine(e)) {
        this.progressBar(e, e.q[0].p, '#facc15');
      }
    }

    // Puntos de reunión de edificios propios seleccionados
    for (const b of sel.myBuildings()) {
      if (!b.rally) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.rx * TILE, b.ry * TILE);
      ctx.lineTo(b.rally.x * TILE, b.rally.y * TILE);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = world.colorOf(b.o);
      ctx.beginPath();
      ctx.arc(b.rally.x * TILE, b.rally.y * TILE, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    fx.draw(ctx, now);
    this.drawFog();

    // Vista previa de construcción (encima de la niebla para que siempre se vea)
    if (ov.placement) {
      drawBuilding(ctx, {
        tx: ov.placement.tx,
        ty: ov.placement.ty,
        type: ov.placement.type,
        color: world.colorOf(world.me),
        time: now,
        id: 0,
        preview: ov.placement.valid ? 'ok' : 'bad',
      });
    }

    // Rectángulo de selección (en pantalla)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (ov.selectionBox) {
      const b = ov.selectionBox;
      ctx.strokeStyle = '#86efac';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(134, 239, 172, 0.12)';
      const x = Math.min(b.x0, b.x1);
      const y = Math.min(b.y0, b.y1);
      ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
  }

  relationColor(e: ClientEntity): string {
    if (e.k === 'resource') return '#fde047';
    if (this.world.isMine(e)) return '#4ade80';
    if (this.world.isAlly(e)) return '#38bdf8';
    return '#f87171';
  }

  private selectionRing(e: ClientEntity, color: string) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (e.k === 'unit') {
      const r = UNIT_DEFS[e.t as UnitType].radius * TILE + 4;
      ctx.beginPath();
      ctx.ellipse(e.rx * TILE, e.ry * TILE + r * 0.45, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const size = e.k === 'building' ? BUILDING_DEFS[e.t as BuildingType].size : 1;
      ctx.strokeRect(e.x * TILE - 1, e.y * TILE - 1, size * TILE + 2, size * TILE + 2);
    }
  }

  private barGeometry(e: ClientEntity) {
    if (e.k === 'unit') {
      const r = UNIT_DEFS[e.t as UnitType].radius * TILE;
      return { x: e.rx * TILE - 13, y: e.ry * TILE - r - 12, w: 26 };
    }
    const size = BUILDING_DEFS[e.t as BuildingType].size * TILE;
    return { x: e.x * TILE + 4, y: e.y * TILE - 8, w: size - 8 };
  }

  private hpBar(e: ClientEntity) {
    const { ctx } = this;
    const g = this.barGeometry(e);
    const f = Math.max(0, Math.min(1, e.hp / e.mhp));
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(g.x - 1, g.y - 1, g.w + 2, 5);
    ctx.fillStyle = f > 0.6 ? '#22c55e' : f > 0.3 ? '#eab308' : '#ef4444';
    ctx.fillRect(g.x, g.y, g.w * f, 3);
  }

  private progressBar(e: ClientEntity, p: number, color: string) {
    const { ctx } = this;
    const g = this.barGeometry(e);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(g.x - 1, g.y + 4, g.w + 2, 5);
    ctx.fillStyle = color;
    ctx.fillRect(g.x, g.y + 5, g.w * Math.max(0, Math.min(1, p)), 3);
  }

  private drawControlPoints(now: number) {
    const { ctx } = this;
    for (const cp of this.world.controlPoints) {
      const x = cp.x * TILE;
      const y = cp.y * TILE;
      const r = cp.radius * TILE;
      const color = cp.owner >= 0 ? this.teamColor(cp.owner) : '#e5e7eb';
      ctx.fillStyle = withAlpha(color.startsWith('#') ? color : '#e5e7eb', cp.owner >= 0 ? 0.16 : 0.07);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -now / 60;
      ctx.strokeStyle = withAlpha(color.startsWith('#') ? color : '#e5e7eb', 0.8);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      if (cp.capturingTeam >= 0 && cp.progress > 0 && cp.progress < 1) {
        ctx.strokeStyle = this.teamColor(cp.capturingTeam);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, r - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cp.progress);
        ctx.stroke();
      }
      // Obelisco central
      ctx.fillStyle = '#d6cfc0';
      ctx.strokeStyle = 'rgba(15,20,28,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 7, y + 8);
      ctx.lineTo(x - 4, y - 18);
      ctx.lineTo(x, y - 24);
      ctx.lineTo(x + 4, y - 18);
      ctx.lineTo(x + 7, y + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y - 10, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTerritory() {
    const w = this.world;
    if (this.territoryVersion !== w.territoryVersion) {
      this.territoryVersion = w.territoryVersion;
      const terr = w.getTerritory();
      const c = this.territoryCanvas.getContext('2d')!;
      c.clearRect(0, 0, this.territoryCanvas.width, this.territoryCanvas.height);
      const R = TERRITORY_RES;
      for (let y = 0; y < w.height; y++) {
        for (let x = 0; x < w.width; x++) {
          const o = terr[y * w.width + x];
          if (o < 0) continue;
          const color = w.colorOf(o);
          c.fillStyle = withAlpha(color, 0.12);
          c.fillRect(x * R, y * R, R, R);
          c.fillStyle = withAlpha(color, 0.85);
          const other = (nx: number, ny: number) => nx < 0 || ny < 0 || nx >= w.width || ny >= w.height || terr[ny * w.width + nx] !== o;
          if (other(x, y - 1)) c.fillRect(x * R, y * R, R, 1);
          if (other(x, y + 1)) c.fillRect(x * R, y * R + R - 1, R, 1);
          if (other(x - 1, y)) c.fillRect(x * R, y * R, 1, R);
          if (other(x + 1, y)) c.fillRect(x * R + R - 1, y * R, 1, R);
        }
      }
    }
    this.ctx.drawImage(this.territoryCanvas, 0, 0, w.width * TILE, w.height * TILE);
  }

  private drawFog() {
    const w = this.world;
    if (this.fogVersion !== w.fogVersion) {
      this.fogVersion = w.fogVersion;
      const c = this.fogCanvas.getContext('2d')!;
      const img = c.createImageData(w.width, w.height);
      for (let i = 0; i < w.visible.length; i++) {
        img.data[i * 4] = 8;
        img.data[i * 4 + 1] = 11;
        img.data[i * 4 + 2] = 16;
        img.data[i * 4 + 3] = w.visible[i] ? 0 : w.explored[i] ? 140 : 250;
      }
      c.putImageData(img, 0, 0);
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.fogCanvas, 0, 0, w.width * TILE, w.height * TILE);
  }
}

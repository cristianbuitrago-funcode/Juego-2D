import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { BuildingType, ResourceType, UnitType } from '@shared/types/game';
import { shade } from '../assets/palette';

// Gráficos 2D procedurales (sin assets externos): estilo "cartoon" plano con contorno.
// Todas las funciones dibujan en coordenadas del mundo (1 casilla = TILE px).

const TILE = GAME_CONFIG.tileSize;
const OUTLINE = 'rgba(15, 20, 28, 0.85)';

export interface DrawUnitOpts {
  x: number;
  y: number;
  type: UnitType;
  color: string;
  facing: number;
  state?: string;
  time: number;
  id: number;
  attackAge?: number;
  hitAge?: number;
  carrying?: ResourceType;
}

const RES_COLORS: Record<ResourceType, string> = {
  gold: '#facc15',
  wood: '#a16207',
  stone: '#9ca3af',
  food: '#ef4444',
};

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawUnit(ctx: CanvasRenderingContext2D, o: DrawUnitOpts) {
  const def = UNIT_DEFS[o.type];
  const r = def.radius * TILE;
  let x = o.x * TILE;
  let y = o.y * TILE;
  const moving = o.state === 'moving' || o.state === 'retreating' || o.state === 'returning';
  const bob = moving ? Math.abs(Math.sin(o.time / 110 + o.id)) * 2.2 : 0;
  // Embestida al atacar.
  if (o.attackAge !== undefined && o.attackAge < 220 && !def.ranged) {
    const k = Math.sin((o.attackAge / 220) * Math.PI) * 4;
    x += Math.cos(o.facing) * k;
    y += Math.sin(o.facing) * k;
  }
  shadow(ctx, x, y + r * 0.75, r * 1.05, r * 0.45);
  y -= bob;
  const dark = shade(o.color, -0.35);
  const light = shade(o.color, 0.25);
  const fx = Math.cos(o.facing);
  const fy = Math.sin(o.facing);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = OUTLINE;

  switch (o.type) {
    case 'tank': {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(o.facing);
      // Orugas
      ctx.fillStyle = '#374151';
      ctx.fillRect(-r * 1.05, -r * 0.95, r * 2.1, r * 0.45);
      ctx.fillRect(-r * 1.05, r * 0.5, r * 2.1, r * 0.45);
      ctx.strokeRect(-r * 1.05, -r * 0.95, r * 2.1, r * 0.45);
      ctx.strokeRect(-r * 1.05, r * 0.5, r * 2.1, r * 0.45);
      // Casco
      ctx.fillStyle = o.color;
      roundRect(ctx, -r * 0.9, -r * 0.6, r * 1.8, r * 1.2, 4);
      ctx.fill();
      ctx.stroke();
      // Cañón y torreta
      ctx.fillStyle = dark;
      ctx.fillRect(0, -r * 0.13, r * 1.35, r * 0.26);
      ctx.strokeRect(0, -r * 0.13, r * 1.35, r * 0.26);
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(-r * 0.05, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'scout': {
      // Montura rápida con estandarte.
      ctx.fillStyle = '#8b5e34';
      ctx.beginPath();
      ctx.ellipse(x - fx * 2, y + 2, r * 1.1, r * 0.6, o.facing, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.moveTo(x + fx * r, y + fy * r - 4);
      ctx.lineTo(x - fy * r * 0.8, y + fx * r * 0.8 - 4);
      ctx.lineTo(x - fx * r, y - fy * r - 4);
      ctx.lineTo(x + fy * r * 0.8, y - fx * r * 0.8 - 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y - r - 10);
      ctx.stroke();
      ctx.fillStyle = light;
      const wave = Math.sin(o.time / 120 + o.id) * 2;
      ctx.beginPath();
      ctx.moveTo(x, y - r - 10);
      ctx.lineTo(x + 8, y - r - 8 + wave);
      ctx.lineTo(x, y - r - 5);
      ctx.fill();
      if (moving) {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(x - fx * (r + 3) + (i - 1) * fy * 4, y - fy * (r + 3) - (i - 1) * fx * 4);
          ctx.lineTo(x - fx * (r + 9) + (i - 1) * fy * 4, y - fy * (r + 9) - (i - 1) * fx * 4);
          ctx.stroke();
        }
      }
      break;
    }
    default: {
      // Personaje redondo genérico (recolector, soldado, arquero).
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      // Cabeza/rostro hacia donde mira
      ctx.fillStyle = '#f2d2b0';
      ctx.beginPath();
      ctx.arc(x + fx * r * 0.35, y + fy * r * 0.35 - 2, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (o.type === 'soldier') {
        // Casco
        ctx.fillStyle = '#9ca3af';
        ctx.beginPath();
        ctx.arc(x + fx * r * 0.35, y + fy * r * 0.35 - 3, r * 0.45, Math.PI, 0);
        ctx.fill();
        ctx.stroke();
        // Espada
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x + fx * r * 0.6 - fy * r * 0.6, y + fy * r * 0.6 + fx * r * 0.6);
        ctx.lineTo(x + fx * r * 1.6 - fy * r * 0.5, y + fy * r * 1.6 + fx * r * 0.5);
        ctx.stroke();
        // Escudo
        ctx.fillStyle = dark;
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x + fy * r * 0.75, y - fx * r * 0.75, r * 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (o.type === 'archer') {
        // Capucha
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(x + fx * r * 0.35, y + fy * r * 0.35 - 3, r * 0.47, Math.PI * 1.05, Math.PI * 1.95);
        ctx.fill();
        // Arco
        ctx.strokeStyle = '#92400e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + fx * r * 0.6, y + fy * r * 0.6, r * 0.95, o.facing - 1.1, o.facing + 1.1);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x + fx * r * 0.6 + Math.cos(o.facing - 1.1) * r * 0.95, y + fy * r * 0.6 + Math.sin(o.facing - 1.1) * r * 0.95);
        ctx.lineTo(x + fx * r * 0.6 + Math.cos(o.facing + 1.1) * r * 0.95, y + fy * r * 0.6 + Math.sin(o.facing + 1.1) * r * 0.95);
        ctx.stroke();
      } else {
        // Recolector: gorro y herramienta
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.ellipse(x + fx * r * 0.35, y + fy * r * 0.35 - 4, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        const swing = o.state === 'gathering' || o.state === 'building' ? Math.sin(o.time / 90 + o.id) * 0.7 : 0;
        const a = o.facing + swing;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5);
        ctx.lineTo(x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.45);
        ctx.stroke();
        if (o.carrying) {
          ctx.fillStyle = RES_COLORS[o.carrying];
          ctx.strokeStyle = OUTLINE;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x - fx * r * 0.8, y - fy * r * 0.8 - 2, r * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }
  if (o.hitAge !== undefined && o.hitAge < 140) {
    ctx.fillStyle = `rgba(255,255,255,${0.65 * (1 - o.hitAge / 140)})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface DrawBuildingOpts {
  tx: number;
  ty: number;
  type: BuildingType;
  color: string;
  state?: string;
  progress?: number;
  level?: number;
  time: number;
  id: number;
  hitAge?: number;
  ghost?: boolean;
  /** Vista previa de colocación. */
  preview?: 'ok' | 'bad';
}

export function drawBuilding(ctx: CanvasRenderingContext2D, o: DrawBuildingOpts) {
  const def = BUILDING_DEFS[o.type];
  const s = def.size * TILE;
  const x = o.tx * TILE;
  const y = o.ty * TILE;
  const pad = 3;
  const dark = shade(o.color, -0.35);
  const light = shade(o.color, 0.2);
  const constructing = o.state === 'construction';
  ctx.save();
  if (o.ghost) ctx.globalAlpha = 0.55;
  if (o.preview) ctx.globalAlpha = 0.6;
  if (constructing) ctx.globalAlpha *= 0.55 + 0.45 * (o.progress ?? 0);

  // Sombra y cimientos
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, x + pad + 3, y + pad + 5, s - pad * 2, s - pad * 2, 5);
  ctx.fill();
  ctx.fillStyle = '#8d8478';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  roundRect(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2, 5);
  ctx.fill();
  ctx.stroke();

  const cx = x + s / 2;
  const cy = y + s / 2;
  switch (o.type) {
    case 'commandCenter': {
      ctx.fillStyle = '#b8ab98';
      roundRect(ctx, x + 10, y + 16, s - 20, s - 24, 4);
      ctx.fill();
      ctx.stroke();
      // Torreones
      for (const [px, py] of [[x + 12, y + 18], [x + s - 12, y + 18], [x + 12, y + s - 12], [x + s - 12, y + s - 12]]) {
        ctx.fillStyle = '#a3967f';
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = o.color;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Tejado central
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.moveTo(cx, y + 8);
      ctx.lineTo(cx + 22, cy);
      ctx.lineTo(cx - 22, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 7, cy + 2, 14, 18);
      ctx.strokeRect(cx - 7, cy + 2, 14, 18);
      flag(ctx, cx, y + 8, o.color, o.time, o.id);
      break;
    }
    case 'barracks': {
      ctx.fillStyle = '#7c6a55';
      roundRect(ctx, x + 7, y + 14, s - 14, s - 20, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 18);
      ctx.lineTo(cx, y + 4);
      ctx.lineTo(x + s - 4, y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Espadas cruzadas
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy + 1);
      ctx.lineTo(cx + 9, cy + 17);
      ctx.moveTo(cx + 9, cy + 1);
      ctx.lineTo(cx - 9, cy + 17);
      ctx.stroke();
      break;
    }
    case 'mine': {
      ctx.fillStyle = '#6b6259';
      ctx.beginPath();
      ctx.moveTo(x + 6, y + s - 6);
      ctx.lineTo(x + 14, y + 10);
      ctx.lineTo(cx + 4, y + 6);
      ctx.lineTo(x + s - 6, y + 16);
      ctx.lineTo(x + s - 6, y + s - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f1a17';
      ctx.beginPath();
      ctx.arc(cx, y + s - 12, 11, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#8b5e34';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.fillRect(x + 8, y + s - 16, 12, 8);
      ctx.fillStyle = '#facc15';
      for (const [dx, dy] of [[14, 20], [s - 18, 24], [cx - x + 8, 14]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'lumberMill': {
      ctx.fillStyle = '#9a6b3f';
      roundRect(ctx, x + 6, y + 12, s - 20, s - 18, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.fillRect(x + 4, y + 8, s - 16, 7);
      ctx.strokeRect(x + 4, y + 8, s - 16, 7);
      // Troncos
      ctx.fillStyle = '#b07a46';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(x + s - 10, y + 18 + i * 9, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // Sierra giratoria
      const a = constructing ? 0 : o.time / 200;
      ctx.save();
      ctx.translate(x + 20, y + s - 16);
      ctx.rotate(a);
      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * 8, Math.sin(ang) * 8);
        ctx.lineTo(Math.cos(ang + 0.4) * 5, Math.sin(ang + 0.4) * 5);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'farm': {
      ctx.fillStyle = '#6b8e23';
      ctx.fillRect(x + 5, y + 5, s - 10, s - 10);
      ctx.strokeStyle = '#d4b44a';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 10 + i * 10);
        ctx.lineTo(x + s - 26, y + 10 + i * 10);
        ctx.stroke();
      }
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.6;
      ctx.fillStyle = '#b91c1c';
      roundRect(ctx, x + s - 24, y + 14, 18, 22, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.moveTo(x + s - 27, y + 16);
      ctx.lineTo(x + s - 15, y + 6);
      ctx.lineTo(x + s - 3, y + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'warehouse': {
      ctx.fillStyle = '#a0784d';
      roundRect(ctx, x + 6, y + 10, s - 12, s - 16, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.fillRect(x + 4, y + 6, s - 8, 8);
      ctx.strokeRect(x + 4, y + 6, s - 8, 8);
      ctx.fillStyle = '#c49a6c';
      for (const [dx, dy] of [[10, 22], [26, 22], [18, 36], [34, 36]]) {
        ctx.fillRect(x + dx, y + dy, 12, 10);
        ctx.strokeRect(x + dx, y + dy, 12, 10);
      }
      break;
    }
    case 'tower': {
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(cx - 9, y - 14, 18, s - 2);
      ctx.strokeRect(cx - 9, y - 14, 18, s - 2);
      ctx.fillStyle = '#6b7280';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(cx - 11 + i * 8, y - 20, 6, 7);
        ctx.strokeRect(cx - 11 + i * 8, y - 20, 6, 7);
      }
      ctx.fillStyle = o.color;
      ctx.fillRect(cx - 9, y - 6, 18, 5);
      ctx.fillStyle = '#111827';
      ctx.fillRect(cx - 2, y + 2, 4, 7);
      break;
    }
    case 'techCenter': {
      ctx.fillStyle = '#cbd5e1';
      roundRect(ctx, x + 6, y + 16, s - 12, s - 22, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(cx, y + 20, 15, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const glow = 0.5 + 0.5 * Math.sin(o.time / 300 + o.id);
      ctx.fillStyle = `rgba(125, 211, 252, ${0.5 + glow * 0.5})`;
      ctx.beginPath();
      ctx.arc(cx, cy + 8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
  }

  // Estandarte de color del jugador en la esquina (identificación rápida).
  ctx.fillStyle = light;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.fillRect(x + pad + 1, y + pad + 1, 6, 6);
  ctx.strokeRect(x + pad + 1, y + pad + 1, 6, 6);

  if (constructing) {
    // Andamios
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i < def.size * 2; i++) {
      ctx.moveTo(x + (i * s) / (def.size * 2), y + pad);
      ctx.lineTo(x + (i * s) / (def.size * 2), y + s - pad);
    }
    ctx.moveTo(x + pad, cy);
    ctx.lineTo(x + s - pad, cy);
    ctx.stroke();
  }
  // Nivel
  if ((o.level ?? 1) > 1 && !o.preview) {
    ctx.fillStyle = '#fde047';
    for (let i = 0; i < (o.level ?? 1); i++) star(ctx, x + s - 8 - i * 9, y + s - 7, 3.6);
  }
  if (o.hitAge !== undefined && o.hitAge < 140) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - o.hitAge / 140)})`;
    ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
  }
  if (o.preview) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.preview === 'ok' ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = o.preview === 'ok' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.3)';
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

function flag(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number, id: number) {
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 16);
  ctx.stroke();
  const w = Math.sin(time / 180 + id) * 2.5;
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 16);
  ctx.quadraticCurveTo(x + 7, y - 17 + w, x + 14, y - 13 + w);
  ctx.lineTo(x, y - 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawResource(ctx: CanvasRenderingContext2D, type: ResourceType, tx: number, ty: number, fraction: number, ghost = false) {
  const x = tx * TILE + TILE / 2;
  const y = ty * TILE + TILE / 2;
  const k = 0.65 + 0.35 * Math.max(0, Math.min(1, fraction));
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.6;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  switch (type) {
    case 'gold':
    case 'stone': {
      shadow(ctx, x, y + 9, 14 * k, 5);
      const base = type === 'gold' ? '#7c6f5e' : '#8b8f96';
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.moveTo(x - 14 * k, y + 8);
      ctx.lineTo(x - 9 * k, y - 8 * k);
      ctx.lineTo(x + 2, y - 13 * k);
      ctx.lineTo(x + 13 * k, y - 4 * k);
      ctx.lineTo(x + 14 * k, y + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = type === 'gold' ? '#facc15' : '#d1d5db';
      for (const [dx, dy] of [[-5, -2], [4, -6], [6, 3], [-1, 4]]) {
        ctx.beginPath();
        ctx.arc(x + dx * k, y + dy * k, 2.6 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'wood': {
      shadow(ctx, x, y + 10, 10, 4);
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(x - 2.5, y, 5, 10);
      ctx.fillStyle = '#2f7d32';
      for (const [dx, dy, r] of [[0, -8, 9], [-6, -2, 7], [6, -2, 7]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(x - 3, y - 11, 4 * k, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'food': {
      shadow(ctx, x, y + 7, 11, 4);
      ctx.fillStyle = '#3f8f3a';
      ctx.beginPath();
      ctx.arc(x, y, 11 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dc2626';
      for (const [dx, dy] of [[-4, -3], [3, -5], [5, 2], [-3, 4], [0, 0]]) {
        ctx.beginPath();
        ctx.arc(x + dx * k, y + dy * k, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ iconos para la interfaz
const iconCache = new Map<string, string>();

/** Genera (y cachea) un icono PNG a partir de los mismos gráficos procedurales. */
export function iconFor(kind: 'unit' | 'building' | 'resource', type: string, color = '#3b82f6'): string {
  const key = `${kind}:${type}:${color}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  if (kind === 'unit') {
    ctx.translate(32, 34);
    ctx.scale(1.7, 1.7);
    drawUnit(ctx, { x: 0, y: 0, type: type as UnitType, color, facing: 0.4, time: 0, id: 1 });
  } else if (kind === 'building') {
    const size = BUILDING_DEFS[type as BuildingType].size * TILE;
    const scale = 52 / Math.max(size, 40);
    ctx.translate(32 - (size * scale) / 2, 36 - (size * scale) / 2);
    ctx.scale(scale, scale);
    drawBuilding(ctx, { tx: 0, ty: 0, type: type as BuildingType, color, time: 0, id: 1 });
  } else {
    ctx.translate(32 - TILE, 32 - TILE);
    ctx.scale(2, 2);
    drawResource(ctx, type as ResourceType, 0, 0, 1);
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

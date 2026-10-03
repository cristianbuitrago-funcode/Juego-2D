import { BUILDING_DEFS } from '@shared/constants/buildings';
import { TECH_DEFS, UNIT_DEFS } from '@shared/constants/units';
import { GAME_CONFIG, PLAYER_NAME_MAX, ROOM_CODE_LENGTH } from '@shared/config/gameConfig';
import { GAME_MODES } from '@shared/config/gameModes';
import type { AIDifficulty, MapSize, TargetPriority } from '@shared/types/game';
import type { Command, RoomSettings } from '@shared/types/messages';

// Validación estricta de TODO lo que llega del cliente. Nada se usa sin pasar por aquí.

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

function ids(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > GAME_CONFIG.maxUnitsPerCommand) return null;
  return v.every(isInt) ? (v as number[]) : null;
}

const PRIORITIES: TargetPriority[] = ['nearest', 'weakest', 'units', 'buildings'];

export function validateCommand(raw: unknown): Command | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'move':
    case 'attackMove': {
      const u = ids(raw.unitIds);
      if (!u || !isNum(raw.x) || !isNum(raw.y)) return null;
      return { type: raw.type, unitIds: u, x: raw.x, y: raw.y };
    }
    case 'attack':
    case 'gather':
    case 'assist': {
      const u = ids(raw.unitIds);
      if (!u || !isInt(raw.targetId)) return null;
      return { type: raw.type, unitIds: u, targetId: raw.targetId };
    }
    case 'stop':
    case 'hold':
    case 'retreat': {
      const u = ids(raw.unitIds);
      return u ? { type: raw.type, unitIds: u } : null;
    }
    case 'setPriority': {
      const u = ids(raw.unitIds);
      if (!u || !PRIORITIES.includes(raw.priority as TargetPriority)) return null;
      return { type: 'setPriority', unitIds: u, priority: raw.priority as TargetPriority };
    }
    case 'build': {
      if (typeof raw.building !== 'string' || !Object.hasOwn(BUILDING_DEFS, raw.building)) return null;
      if (!isInt(raw.tx) || !isInt(raw.ty)) return null;
      return { type: 'build', building: raw.building as keyof typeof BUILDING_DEFS, tx: raw.tx, ty: raw.ty };
    }
    case 'train': {
      if (!isInt(raw.buildingId) || typeof raw.unit !== 'string' || !Object.hasOwn(UNIT_DEFS, raw.unit)) return null;
      return { type: 'train', buildingId: raw.buildingId, unit: raw.unit as keyof typeof UNIT_DEFS };
    }
    case 'cancelTrain':
    case 'upgrade': {
      if (!isInt(raw.buildingId)) return null;
      return { type: raw.type, buildingId: raw.buildingId };
    }
    case 'research': {
      if (!isInt(raw.buildingId) || typeof raw.tech !== 'string' || !Object.hasOwn(TECH_DEFS, raw.tech)) return null;
      return { type: 'research', buildingId: raw.buildingId, tech: raw.tech as keyof typeof TECH_DEFS };
    }
    case 'rally': {
      if (!isInt(raw.buildingId) || !isNum(raw.x) || !isNum(raw.y)) return null;
      return { type: 'rally', buildingId: raw.buildingId, x: raw.x, y: raw.y };
    }
  }
  return null;
}

export function sanitizeName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, PLAYER_NAME_MAX);
  return name.length >= 1 ? name : null;
}

export function sanitizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  return code.length === ROOM_CODE_LENGTH && /^[A-Z0-9]+$/.test(code) ? code : null;
}

const MAP_SIZES: MapSize[] = ['small', 'medium', 'large'];
const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard'];

export function sanitizeSettings(v: unknown): Partial<RoomSettings> {
  if (!isObj(v)) return {};
  const out: Partial<RoomSettings> = {};
  if (typeof v.mode === 'string' && Object.hasOwn(GAME_MODES, v.mode)) out.mode = v.mode as RoomSettings['mode'];
  if (MAP_SIZES.includes(v.mapSize as MapSize)) out.mapSize = v.mapSize as MapSize;
  if (DIFFS.includes(v.aiDifficulty as AIDifficulty)) out.aiDifficulty = v.aiDifficulty as AIDifficulty;
  return out;
}

/** Limitador de comandos tipo "token bucket" (anti-spam / anti-flood). */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly rate = GAME_CONFIG.commandsPerSecond,
    private readonly burst = GAME_CONFIG.commandBurst,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

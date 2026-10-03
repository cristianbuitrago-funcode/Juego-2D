import { BUILDING_DEFS, buildingMaxHp } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import type { GameModeConfig } from '@shared/config/gameModes';
import type { BuildingType, MapData, ResourceType, UnitType } from '@shared/types/game';
import type { GameEvent } from '@shared/types/messages';
import { computeTerritory } from '@shared/utils/territory';
import type { PlayerState } from '../players/PlayerState';
import { GameMap } from './GameMap';
import type { BuildingEntity, ControlPoint, Entity, ResourceEntity, UnitEntity } from './entities';

/** Evento pendiente de enviar con información de a quién va dirigido. */
export interface QueuedEvent {
  event: GameEvent;
  /** Si se indica, solo lo reciben estos jugadores. */
  to?: number[];
  /** Si se indica (y no hay `to`), solo lo reciben equipos que ven esa posición. */
  pos?: { x: number; y: number };
}

/**
 * GameState centralizado y autoritativo. Contiene TODO el estado de la partida:
 * jugadores, recursos, entidades (unidades, edificios, yacimientos), territorio,
 * tiempo, objetivos y estado de victoria. Los sistemas operan sobre esta estructura.
 */
export class GameState {
  readonly map: GameMap;
  readonly mode: GameModeConfig;
  readonly players = new Map<number, PlayerState>();
  readonly entities = new Map<number, Entity>();
  readonly controlPoints: ControlPoint[] = [];
  time = 0;
  tick = 0;
  phase: 'playing' | 'ended' = 'playing';
  winner: { team: number; reason: string } | null = null;
  /** Equipos presentes al inicio (para saber si la partida es de un solo equipo). */
  initialTeams = new Set<number>();

  private nextId = 1;
  private territoryCache: Int8Array | null = null;
  /** Visibilidad por equipo (1 = visible). La calcula VisionSystem. */
  visibility = new Map<number, Uint8Array>();
  /** Entidades visibles por equipo en el tick actual (caché de VisionSystem). */
  visibleEntities = new Map<number, Set<number>>();
  events: QueuedEvent[] = [];

  constructor(mapData: MapData, mode: GameModeConfig) {
    this.map = new GameMap(mapData.width, mapData.height, mapData.tiles);
    this.mode = mode;
    mapData.controlPoints.forEach((p, i) =>
      this.controlPoints.push({ id: i, x: p.x, y: p.y, radius: 3, owner: -1, progress: 0, capturingTeam: -1 }),
    );
    for (const r of mapData.resources) this.addResourceNode(r.type, r.x, r.y, r.amount);
  }

  // ---------------------------------------------------------------- consultas
  get units(): UnitEntity[] {
    const out: UnitEntity[] = [];
    for (const e of this.entities.values()) if (e.kind === 'unit') out.push(e);
    return out;
  }

  get buildings(): BuildingEntity[] {
    const out: BuildingEntity[] = [];
    for (const e of this.entities.values()) if (e.kind === 'building') out.push(e);
    return out;
  }

  teamOf(playerId: number): number {
    return this.players.get(playerId)?.team ?? -1;
  }

  areEnemies(ownerA: number, ownerB: number): boolean {
    if (ownerA < 0 || ownerB < 0 || ownerA === ownerB) return false;
    return this.teamOf(ownerA) !== this.teamOf(ownerB);
  }

  playerBuildings(playerId: number, type?: BuildingType): BuildingEntity[] {
    return this.buildings.filter((b) => b.owner === playerId && (!type || b.type === type));
  }

  territory(): Int8Array {
    if (!this.territoryCache) {
      this.territoryCache = computeTerritory(
        this.map.width,
        this.map.height,
        this.buildings.map((b) => ({ owner: b.owner, type: b.type, tx: b.tx, ty: b.ty })),
      );
    }
    return this.territoryCache;
  }

  isVisibleTile(team: number, tx: number, ty: number): boolean {
    const vis = this.visibility.get(team);
    if (!vis || !this.map.inBounds(tx, ty)) return false;
    return vis[ty * this.map.width + tx] === 1;
  }

  // ---------------------------------------------------------------- creación
  private id(): number {
    return this.nextId++;
  }

  addUnit(type: UnitType, owner: number, x: number, y: number): UnitEntity {
    const def = UNIT_DEFS[type];
    const u: UnitEntity = {
      id: this.id(),
      kind: 'unit',
      type,
      owner,
      x,
      y,
      hp: def.hp,
      maxHp: def.hp,
      order: { type: 'idle' },
      status: 'idle',
      path: [],
      pathGoal: null,
      repathTimer: 0,
      cooldown: 0,
      carrying: null,
      priority: 'nearest',
      facing: 0,
      revealedUntil: 0,
      scanTimer: Math.random() * 0.5,
      stuckTimer: 0,
      lastPos: { x, y },
    };
    this.entities.set(u.id, u);
    return u;
  }

  addBuilding(type: BuildingType, owner: number, tx: number, ty: number, completed: boolean): BuildingEntity {
    const def = BUILDING_DEFS[type];
    const maxHp = buildingMaxHp(type, 1);
    const b: BuildingEntity = {
      id: this.id(),
      kind: 'building',
      type,
      owner,
      tx,
      ty,
      x: tx + def.size / 2,
      y: ty + def.size / 2,
      size: def.size,
      hp: completed ? maxHp : Math.max(1, Math.round(maxHp * 0.1)),
      maxHp,
      level: 1,
      state: completed ? 'active' : 'construction',
      progress: completed ? 1 : 0,
      upgradeElapsed: 0,
      queue: [],
      rally: null,
      research: null,
      cooldown: 0,
      producesResource: null,
      assistCount: 0,
    };
    this.entities.set(b.id, b);
    this.map.setOccupant(tx, ty, def.size, b.id);
    this.territoryCache = null;
    return b;
  }

  addResourceNode(type: ResourceType, tx: number, ty: number, amount: number): ResourceEntity | null {
    if (!this.map.isWalkable(tx, ty)) return null;
    const r: ResourceEntity = {
      id: this.id(),
      kind: 'resource',
      type,
      owner: -1,
      tx,
      ty,
      x: tx + 0.5,
      y: ty + 0.5,
      amount,
      maxAmount: amount,
      blocks: type === 'gold' || type === 'stone',
    };
    this.entities.set(r.id, r);
    if (r.blocks) this.map.setOccupant(tx, ty, 1, r.id);
    return r;
  }

  removeEntity(id: number) {
    const e = this.entities.get(id);
    if (!e) return;
    this.entities.delete(id);
    if (e.kind === 'building') {
      this.map.setOccupant(e.tx, e.ty, e.size, 0);
      this.territoryCache = null;
    } else if (e.kind === 'resource' && e.blocks) {
      this.map.setOccupant(e.tx, e.ty, 1, 0);
    }
  }

  emit(event: GameEvent, opts: { to?: number[]; pos?: { x: number; y: number } } = {}) {
    this.events.push({ event, ...opts });
  }

  notify(playerId: number, text: string, level: 'info' | 'warn' | 'error' = 'info') {
    this.emit({ type: 'notify', text, level }, { to: [playerId] });
  }
}

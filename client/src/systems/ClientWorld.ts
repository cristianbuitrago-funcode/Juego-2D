import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import type {
  BuildingType,
  ControlPointState,
  EntityState,
  GameModeId,
  PlayerPrivate,
  PlayerPublic,
  UnitType,
} from '@shared/types/game';
import type { GameEvent, GameInit, Snapshot } from '@shared/types/messages';
import { computeTerritory } from '@shared/utils/territory';

/** Entidad en el cliente: estado recibido + datos de interpolación/animación. */
export interface ClientEntity extends EntityState {
  /** Posición dibujada (centro, en casillas). */
  rx: number;
  ry: number;
  fromX: number;
  fromY: number;
  lerpStart: number;
  /** Momento del último impacto recibido (destello). */
  hitAt: number;
  /** Momento del último ataque (animación). */
  attackAt: number;
  /** Recordado fuera de visión (fantasma). */
  ghost?: boolean;
}

/**
 * Copia local del estado del juego (solo lectura para la lógica: la verdad está en el servidor).
 * Aplica snapshots delta, interpola posiciones y calcula la niebla de guerra para dibujar.
 */
export class ClientWorld {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  readonly me: number;
  readonly myTeam: number;
  readonly mode: GameModeId;
  readonly snapshotInterval: number;
  players = new Map<number, PlayerPublic>();
  priv: PlayerPrivate | null = null;
  entities = new Map<number, ClientEntity>();
  ghosts = new Map<number, ClientEntity>();
  controlPoints: ControlPointState[];
  time = 0;
  /** performance.now() del último snapshot (para extrapolar el reloj). */
  timeAt = performance.now();

  readonly visible: Uint8Array;
  readonly explored: Uint8Array;
  fogVersion = 0;
  private territory: Int8Array | null = null;
  territoryVersion = 0;

  constructor(init: GameInit) {
    this.width = init.map.width;
    this.height = init.map.height;
    this.tiles = Uint8Array.from(init.map.tiles);
    this.me = init.you;
    this.myTeam = init.yourTeam;
    this.mode = init.mode;
    this.snapshotInterval = 1000 / init.snapshotRate;
    for (const p of init.players) this.players.set(p.id, p);
    this.controlPoints = init.controlPoints;
    this.visible = new Uint8Array(this.width * this.height);
    this.explored = new Uint8Array(this.width * this.height);
  }

  get mePublic(): PlayerPublic | undefined {
    return this.players.get(this.me);
  }

  get spectator(): boolean {
    return !!this.mePublic?.eliminated;
  }

  gameTime(): number {
    return this.time + (performance.now() - this.timeAt) / 1000;
  }

  isMine(e: EntityState) {
    return e.o === this.me;
  }

  isAlly(e: EntityState) {
    return e.o >= 0 && this.players.get(e.o)?.team === this.myTeam;
  }

  isEnemy(e: EntityState) {
    return e.o >= 0 && !this.isAlly(e);
  }

  colorOf(owner: number): string {
    return this.players.get(owner)?.color ?? '#cbd5e1';
  }

  /** Aplica un snapshot. Devuelve los eventos para que los consuman efectos, sonido y HUD. */
  applySnapshot(s: Snapshot): GameEvent[] {
    const now = performance.now();
    this.time = s.time;
    this.timeAt = now;
    if (s.full) {
      this.entities.clear();
    }
    const events = s.ev ?? [];
    const dead = new Set<number>();
    for (const ev of events) if (ev.type === 'death') dead.add(ev.id);

    let territoryChanged = false;
    for (const st of s.ents) {
      const prev = this.entities.get(st.id);
      const center = centerOf(st);
      if (prev) {
        if (st.k === 'building' && (prev.s !== st.s || prev.o !== st.o)) territoryChanged = true;
        const hpDropped = st.hp < prev.hp;
        Object.assign(prev, st);
        prev.fromX = prev.rx;
        prev.fromY = prev.ry;
        prev.lerpStart = now;
        if (st.k !== 'unit') {
          prev.rx = prev.fromX = center.x;
          prev.ry = prev.fromY = center.y;
        }
        if (hpDropped) prev.hitAt = now;
        // Limpiar campos opcionales que ya no vienen.
        for (const key of ['c', 'ct', 'q', 'rs', 'rally', 'p'] as const) if (!(key in st)) delete prev[key];
      } else {
        const ghost = this.ghosts.get(st.id);
        this.ghosts.delete(st.id);
        if (st.k === 'building') territoryChanged = true;
        this.entities.set(st.id, {
          ...st,
          rx: ghost && st.k === 'unit' ? ghost.rx : center.x,
          ry: ghost && st.k === 'unit' ? ghost.ry : center.y,
          fromX: center.x,
          fromY: center.y,
          lerpStart: now,
          hitAt: 0,
          attackAt: 0,
        });
      }
    }
    for (const id of s.rm) {
      const e = this.entities.get(id);
      if (!e) continue;
      this.entities.delete(id);
      if (e.k === 'building') territoryChanged = true;
      // Edificios y recursos fuera de visión se recuerdan como "fantasmas".
      if (!dead.has(id) && e.k !== 'unit' && !this.isMine(e)) this.ghosts.set(id, { ...e, ghost: true });
    }
    for (const id of dead) this.ghosts.delete(id);

    if (s.me) this.priv = s.me;
    if (s.pts) this.controlPoints = s.pts;
    if (s.players) for (const p of s.players) this.players.set(p.id, p);

    for (const ev of events) {
      if (ev.type === 'attack') {
        const a = this.entities.get(ev.from);
        if (a) a.attackAt = now;
      }
    }

    this.updateFog();
    if (territoryChanged) {
      this.territory = null;
      this.territoryVersion++;
    }
    return events;
  }

  /** Interpola la posición dibujada de las unidades entre snapshots. */
  interpolate(now: number) {
    const dur = this.snapshotInterval * 1.15;
    for (const e of this.entities.values()) {
      if (e.k !== 'unit') continue;
      const t = Math.min(1, (now - e.lerpStart) / dur);
      e.rx = e.fromX + (e.x - e.fromX) * t;
      e.ry = e.fromY + (e.y - e.fromY) * t;
    }
  }

  /** Niebla de guerra visual: calculada con las mismas reglas de visión que el servidor. */
  private updateFog() {
    const { width, height, visible, explored } = this;
    if (this.spectator) {
      visible.fill(1);
      explored.fill(1);
      this.fogVersion++;
      return;
    }
    visible.fill(0);
    for (const e of this.entities.values()) {
      if (!this.isAlly(e)) continue;
      let r: number;
      let cx: number;
      let cy: number;
      if (e.k === 'unit') {
        r = UNIT_DEFS[e.t as UnitType].sight;
        cx = e.x;
        cy = e.y;
      } else if (e.k === 'building') {
        const def = BUILDING_DEFS[e.t as BuildingType];
        r = def.sight * (e.s === 'construction' ? 0.5 : 1) + def.size / 2;
        cx = e.x + def.size / 2;
        cy = e.y + def.size / 2;
      } else continue;
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(width - 1, Math.floor(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const y1 = Math.min(height - 1, Math.floor(cy + r));
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) {
            visible[y * width + x] = 1;
            explored[y * width + x] = 1;
          }
        }
      }
    }
    // Si vemos la casilla de un fantasma y el servidor no nos lo ha enviado, ya no existe.
    for (const [id, g] of this.ghosts) {
      const size = g.k === 'building' ? BUILDING_DEFS[g.t as BuildingType].size : 1;
      let seen = false;
      for (let y = g.y; y < g.y + size && !seen; y++)
        for (let x = g.x; x < g.x + size && !seen; x++) if (visible[y * width + x]) seen = true;
      if (seen) {
        this.ghosts.delete(id);
        if (g.k === 'building') {
          this.territory = null;
          this.territoryVersion++;
        }
      }
    }
    this.fogVersion++;
  }

  isVisible(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.visible[ty * this.width + tx] === 1;
  }

  /** Territorio según los edificios conocidos (visibles + recordados). */
  getTerritory(): Int8Array {
    if (!this.territory) {
      const src = [...this.entities.values(), ...this.ghosts.values()]
        .filter((e) => e.k === 'building')
        .map((e) => ({ owner: e.o, type: e.t as BuildingType, tx: e.x, ty: e.y }));
      this.territory = computeTerritory(this.width, this.height, src);
    }
    return this.territory;
  }

  /** Entidad (visible) bajo un punto del mundo en casillas. */
  entityAt(x: number, y: number, radiusBonus = 0): ClientEntity | null {
    let best: ClientEntity | null = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.k === 'unit') {
        const r = UNIT_DEFS[e.t as UnitType].radius + 0.25 + radiusBonus;
        const d = Math.hypot(e.rx - x, e.ry - y);
        if (d <= r && d < bestD) {
          best = e;
          bestD = d;
        }
      }
    }
    if (best) return best;
    for (const e of [...this.entities.values(), ...this.ghosts.values()]) {
      if (e.k === 'unit') continue;
      const size = e.k === 'building' ? BUILDING_DEFS[e.t as BuildingType].size : 1;
      const pad = radiusBonus * 0.5;
      if (x >= e.x - pad && x < e.x + size + pad && y >= e.y - pad && y < e.y + size + pad) return e;
    }
    return null;
  }
}

export function centerOf(e: EntityState): { x: number; y: number } {
  if (e.k === 'unit') return { x: e.x, y: e.y };
  const size = e.k === 'building' ? BUILDING_DEFS[e.t as BuildingType].size : 1;
  return { x: e.x + size / 2, y: e.y + size / 2 };
}

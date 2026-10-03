import type { EntityState } from '@shared/types/game';
import type { GameEvent, Snapshot } from '@shared/types/messages';
import type { Entity } from '../game/entities';
import type { GameState, QueuedEvent } from '../game/GameState';
import { toPublic } from '../players/PlayerState';
import { VisionSystem } from '../systems/VisionSystem';
import { TECH_DEFS, UNIT_DEFS } from '@shared/constants/units';
import { BUILDING_DEFS } from '@shared/constants/buildings';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Convierte una entidad del servidor al formato de red. Los datos privados solo van al dueño. */
export function serializeEntity(state: GameState, e: Entity, viewer: number): EntityState {
  if (e.kind === 'unit') {
    const s: EntityState = { id: e.id, k: 'unit', t: e.type, o: e.owner, x: r2(e.x), y: r2(e.y), hp: Math.ceil(e.hp), mhp: e.maxHp, s: e.status, f: Math.round(e.facing * 10) / 10 };
    if (e.carrying && e.carrying.amount >= 1) {
      s.c = Math.floor(e.carrying.amount);
      s.ct = e.carrying.type;
    }
    if (e.owner === viewer) s.pr = e.priority;
    return s;
  }
  if (e.kind === 'building') {
    const s: EntityState = { id: e.id, k: 'building', t: e.type, o: e.owner, x: e.tx, y: e.ty, hp: Math.ceil(e.hp), mhp: e.maxHp, s: e.state, l: e.level };
    if (e.state === 'construction') s.p = r2(e.progress);
    if (e.state === 'upgrading') s.p = r2(e.upgradeElapsed / BUILDING_DEFS[e.type].upgradeTime[e.level - 1]);
    if (e.owner === viewer) {
      if (e.queue.length) s.q = e.queue.map((q, i) => ({ u: q.unit, p: i === 0 ? r2(q.elapsed / UNIT_DEFS[q.unit].trainTime) : 0 }));
      if (e.research) {
        const level = state.players.get(e.owner)?.tech[e.research.tech] ?? 0;
        s.rs = { tech: e.research.tech, p: r2(e.research.elapsed / TECH_DEFS[e.research.tech].time[level]) };
      }
      if (e.rally) s.rally = { x: r2(e.rally.x), y: r2(e.rally.y) };
    }
    return s;
  }
  return { id: e.id, k: 'resource', t: e.type, o: -1, x: e.tx, y: e.ty, hp: Math.ceil(e.amount), mhp: e.maxAmount, a: Math.ceil(e.amount) };
}

/**
 * Construye snapshots DELTA por jugador: solo entidades visibles que cambiaron desde el último envío,
 * más la lista de las que dejaron de verse. Evita reenviar el estado completo constantemente.
 */
export class SnapshotBuilder {
  private sent = new Map<number, string>();
  private lastMe = '';
  private lastPts = '';
  private lastPlayers = '';

  constructor(private readonly viewer: number) {}

  reset() {
    this.sent.clear();
    this.lastMe = '';
    this.lastPts = '';
    this.lastPlayers = '';
  }

  build(state: GameState, events: QueuedEvent[], full = false): Snapshot {
    if (full) this.reset();
    const viewer = state.players.get(this.viewer);
    const team = viewer?.team ?? -1;
    const spectator = !viewer || viewer.eliminated;
    const snap: Snapshot = { time: Math.round(state.time * 10) / 10, tick: state.tick, ents: [], rm: [] };
    if (full) snap.full = true;

    const visibleNow = new Set<number>();
    for (const e of state.entities.values()) {
      if (!spectator && !VisionSystem.sees(state, team, e)) continue;
      visibleNow.add(e.id);
      const ser = serializeEntity(state, e, this.viewer);
      const key = JSON.stringify(ser);
      if (this.sent.get(e.id) !== key) {
        this.sent.set(e.id, key);
        snap.ents.push(ser);
      }
    }
    for (const id of this.sent.keys()) {
      if (!visibleNow.has(id)) {
        snap.rm.push(id);
        this.sent.delete(id);
      }
    }

    if (viewer) {
      const me = {
        resources: {
          gold: Math.floor(viewer.resources.gold),
          wood: Math.floor(viewer.resources.wood),
          stone: Math.floor(viewer.resources.stone),
          food: Math.floor(viewer.resources.food),
        },
        storageCap: viewer.storageCap,
        pop: viewer.pop,
        popCap: viewer.popCap,
        tech: { ...viewer.tech },
        gathered: Math.floor(viewer.gathered),
      };
      const k = JSON.stringify(me);
      if (k !== this.lastMe) {
        this.lastMe = k;
        snap.me = me;
      }
    }

    const pts = state.controlPoints.map((c) => ({ ...c, progress: Math.round(c.progress * 20) / 20 }));
    const pk = JSON.stringify(pts);
    if (pk !== this.lastPts) {
      this.lastPts = pk;
      snap.pts = pts;
    }

    const players = [...state.players.values()].map(toPublic);
    const plk = JSON.stringify(players);
    if (plk !== this.lastPlayers) {
      this.lastPlayers = plk;
      snap.players = players;
    }

    const ev: GameEvent[] = [];
    for (const q of events) {
      if (q.to) {
        if (q.to.includes(this.viewer)) ev.push(q.event);
      } else if (q.pos) {
        if (spectator || state.isVisibleTile(team, Math.floor(q.pos.x), Math.floor(q.pos.y))) ev.push(q.event);
      } else ev.push(q.event);
    }
    if (ev.length) snap.ev = ev;
    return snap;
  }
}

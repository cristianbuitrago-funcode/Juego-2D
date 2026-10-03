import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import { distToRect } from '@shared/utils/math';
import type { BuildingEntity, Entity, UnitEntity } from '../game/entities';
import type { GameState } from '../game/GameState';
import { defenseOf, edgeDistance, isAttackable } from './helpers';
import { VisionSystem } from './VisionSystem';

const UNDER_ATTACK_COOLDOWN = 12;
const lastAlert = new WeakMap<GameState, Map<number, number>>();

/**
 * Combate autoritativo: el servidor comprueba alcance, calcula el daño y aplica la vida.
 * El cliente solo recibe eventos `attack`/`death` para animarlos.
 */
export const CombatSystem = {
  /** Daño que haría `u` a `target` (con tecnologías y defensa). */
  computeDamage(state: GameState, u: UnitEntity, target: Entity): number {
    const def = UNIT_DEFS[u.type];
    const weapons = state.players.get(u.owner)?.tech.weapons ?? 0;
    let dmg = def.damage * (1 + 0.15 * weapons);
    if (target.kind === 'building') dmg *= def.buildingBonus;
    return Math.max(1, Math.round(dmg - defenseOf(state, target)));
  },

  inRange(u: UnitEntity, target: Entity): boolean {
    return edgeDistance(u, target) <= UNIT_DEFS[u.type].range + 0.05;
  },

  /** Intenta atacar si el enfriamiento lo permite. Supone que ya está en rango. */
  tryAttack(state: GameState, u: UnitEntity, target: UnitEntity | BuildingEntity) {
    u.facing = Math.atan2(target.y - u.y, target.x - u.x);
    if (u.cooldown > 0) return;
    const def = UNIT_DEFS[u.type];
    u.cooldown = def.attackCooldown;
    const dmg = this.computeDamage(state, u, target);
    // Atacar desde un bosque revela brevemente a la unidad.
    u.revealedUntil = state.time + 2;
    state.emit(
      { type: 'attack', from: u.id, to: target.id, ranged: def.ranged, x1: u.x, y1: u.y, x2: target.x, y2: target.y, dmg },
      { pos: { x: target.x, y: target.y } },
    );
    this.applyDamage(state, target, dmg, u.owner);
  },

  applyDamage(state: GameState, target: UnitEntity | BuildingEntity, dmg: number, attackerOwner: number) {
    target.hp -= dmg;
    this.alertOwner(state, target);
    if (target.hp <= 0) this.kill(state, target, attackerOwner);
  },

  alertOwner(state: GameState, target: UnitEntity | BuildingEntity) {
    let m = lastAlert.get(state);
    if (!m) lastAlert.set(state, (m = new Map()));
    const last = m.get(target.owner) ?? -Infinity;
    if (state.time - last < UNDER_ATTACK_COOLDOWN) return;
    m.set(target.owner, state.time);
    state.emit({ type: 'underAttack', x: target.x, y: target.y }, { to: [target.owner] });
  },

  kill(state: GameState, target: UnitEntity | BuildingEntity, killerOwner: number) {
    target.hp = 0;
    state.emit(
      { type: 'death', id: target.id, kind: target.kind, t: target.type, o: target.owner, x: target.x, y: target.y },
      { pos: { x: target.x, y: target.y } },
    );
    const killer = state.players.get(killerOwner);
    if (killer && target.kind === 'unit') killer.stats.kills++;
    const victim = state.players.get(target.owner);
    if (victim && target.kind === 'unit') victim.stats.unitsLost++;
    if (target.kind === 'building' && victim) {
      state.notify(target.owner, `Has perdido: ${BUILDING_DEFS[target.type].name}`, 'warn');
    }
    state.removeEntity(target.id);
  },

  /**
   * Busca el mejor objetivo enemigo visible dentro de `radius` (borde a borde) según la prioridad de la unidad.
   */
  findTarget(state: GameState, u: UnitEntity, radius: number): UnitEntity | BuildingEntity | null {
    const team = state.teamOf(u.owner);
    let best: UnitEntity | BuildingEntity | null = null;
    let bestScore = Infinity;
    for (const e of state.entities.values()) {
      if (!isAttackable(e) || !state.areEnemies(u.owner, e.owner)) continue;
      if (Math.abs(e.x - u.x) > radius + 3 || Math.abs(e.y - u.y) > radius + 3) continue;
      const d = edgeDistance(u, e);
      if (d > radius) continue;
      if (!VisionSystem.sees(state, team, e)) continue;
      let score = d;
      switch (u.priority) {
        case 'weakest':
          score = e.hp + d * 2;
          break;
        case 'units':
          score = d + (e.kind === 'building' ? 1000 : 0);
          break;
        case 'buildings':
          score = d + (e.kind === 'unit' ? 1000 : 0);
          break;
        default:
          // Por defecto se prefiere a las unidades que pueden devolver el golpe.
          score = d + (e.kind === 'building' ? 4 : 0);
      }
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  },

  /** Torres defensivas: atacan automáticamente al enemigo visible más cercano. */
  updateTowers(state: GameState, dt: number) {
    for (const b of state.buildings) {
      const def = BUILDING_DEFS[b.type];
      if (!def.attack || b.state === 'construction') continue;
      b.cooldown -= dt;
      if (b.cooldown > 0) continue;
      const range = def.attack.range[b.level - 1];
      const team = state.teamOf(b.owner);
      let best: UnitEntity | BuildingEntity | null = null;
      let bestD = Infinity;
      for (const e of state.entities.values()) {
        if (!isAttackable(e) || !state.areEnemies(b.owner, e.owner)) continue;
        const d =
          e.kind === 'building'
            ? distToRect(b.x, b.y, e.tx, e.ty, e.size, e.size) + 2
            : Math.hypot(e.x - b.x, e.y - b.y);
        if (d > range || d >= bestD) continue;
        if (!VisionSystem.sees(state, team, e)) continue;
        best = e;
        bestD = d;
      }
      if (!best) continue;
      b.cooldown = def.attack.cooldown;
      const dmg = Math.max(1, Math.round(def.attack.damage[b.level - 1] - defenseOf(state, best)));
      state.emit(
        { type: 'attack', from: b.id, to: best.id, ranged: true, x1: b.x, y1: b.y - 0.5, x2: best.x, y2: best.y, dmg },
        { pos: { x: best.x, y: best.y } },
      );
      this.applyDamage(state, best, dmg, b.owner);
    }
  },
};

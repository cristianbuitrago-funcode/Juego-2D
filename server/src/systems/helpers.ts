import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import { distToRect } from '@shared/utils/math';
import type { BuildingEntity, Entity, UnitEntity } from '../game/entities';
import type { GameState } from '../game/GameState';
import type { PathGoal } from './Pathfinding';

/** Distancia borde a borde entre una unidad y cualquier entidad. */
export function edgeDistance(u: UnitEntity, target: Entity): number {
  const ur = UNIT_DEFS[u.type].radius;
  if (target.kind === 'building') {
    return Math.max(0, distToRect(u.x, u.y, target.tx, target.ty, target.size, target.size) - ur);
  }
  if (target.kind === 'resource') {
    return Math.max(0, distToRect(u.x, u.y, target.tx, target.ty, 1, 1) - ur);
  }
  return Math.max(0, Math.hypot(u.x - target.x, u.y - target.y) - ur - UNIT_DEFS[target.type].radius);
}

/** Objetivo de pathfinding para acercarse a `range` de una entidad. */
export function goalFor(target: Entity, range: number): PathGoal {
  if (target.kind === 'building') {
    return { x: target.x, y: target.y, range: range + 0.2, rect: { x: target.tx, y: target.ty, w: target.size, h: target.size } };
  }
  if (target.kind === 'resource') {
    return { x: target.x, y: target.y, range: range + 0.3, rect: { x: target.tx, y: target.ty, w: 1, h: 1 } };
  }
  return { x: target.x, y: target.y, range: range + 0.3 };
}

/** Defensa efectiva de una entidad (incluye tecnologías). */
export function defenseOf(state: GameState, e: Entity): number {
  if (e.kind === 'unit') return UNIT_DEFS[e.type].defense + (state.players.get(e.owner)?.tech.armor ?? 0);
  if (e.kind === 'building') return BUILDING_DEFS[e.type].defense;
  return 0;
}

export function isDropoffFor(b: BuildingEntity, res: string): boolean {
  if (b.state === 'construction') return false;
  return (BUILDING_DEFS[b.type].dropoff ?? []).includes(res as never);
}

/** Entidad viva atacable. */
export function isAttackable(e: Entity | undefined): e is UnitEntity | BuildingEntity {
  return !!e && (e.kind === 'unit' || e.kind === 'building') && e.hp > 0;
}

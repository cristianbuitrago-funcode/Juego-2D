import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import { RESOURCE_NAMES } from '@shared/constants/units';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { ResourceType } from '@shared/types/game';
import type { BuildingEntity, ResourceEntity, UnitEntity } from '../game/entities';
import type { GameState } from '../game/GameState';
import { edgeDistance, goalFor, isDropoffFor } from './helpers';
import { MovementSystem } from './MovementSystem';
import { ResourceSystem } from './ResourceSystem';

const REACH = 0.35;
const lastStorageWarn = new WeakMap<GameState, Map<number, number>>();

function storageWarn(state: GameState, playerId: number) {
  let m = lastStorageWarn.get(state);
  if (!m) lastStorageWarn.set(state, (m = new Map()));
  if (state.time - (m.get(playerId) ?? -Infinity) < 20) return;
  m.set(playerId, state.time);
  state.notify(playerId, 'Almacenamiento lleno: construye o mejora un almacén.', 'warn');
}

export const EconomySystem = {
  nearestNode(state: GameState, x: number, y: number, type: ResourceType, maxDist = 14): ResourceEntity | null {
    let best: ResourceEntity | null = null;
    let bestD = maxDist;
    for (const e of state.entities.values()) {
      if (e.kind !== 'resource' || e.type !== type || e.amount <= 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  },

  nearestDropoff(state: GameState, u: UnitEntity, type: ResourceType): BuildingEntity | null {
    let best: BuildingEntity | null = null;
    let bestD = Infinity;
    for (const b of state.buildings) {
      if (b.owner !== u.owner || !isDropoffFor(b, type)) continue;
      const d = Math.hypot(b.x - u.x, b.y - u.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  },

  /** Ciclo de recolección: ir al nodo → recolectar → llevar al punto de entrega → repetir. */
  updateGatherer(state: GameState, u: UnitEntity, dt: number) {
    const order = u.order;
    if (order.type !== 'gather') return;
    const def = UNIT_DEFS[u.type];
    const player = state.players.get(u.owner)!;
    const capacity = def.carryCapacity ?? 10;

    if (order.phase !== 'toDropoff' && u.carrying && u.carrying.type !== order.resource && u.carrying.amount > 0) {
      order.phase = 'toDropoff';
    }

    if (order.phase === 'toDropoff') {
      const carry = u.carrying;
      if (!carry || carry.amount <= 0) {
        u.carrying = null;
        order.phase = 'toNode';
        return;
      }
      const drop = this.nearestDropoff(state, u, carry.type);
      if (!drop) {
        state.notify(u.owner, `No hay punto de entrega para ${RESOURCE_NAMES[carry.type].toLowerCase()}.`, 'warn');
        u.order = { type: 'idle' };
        return;
      }
      if (edgeDistance(u, drop) <= REACH + 0.15) {
        const added = ResourceSystem.add(player, carry.type, carry.amount);
        if (added < carry.amount) storageWarn(state, u.owner);
        u.carrying = null;
        order.phase = 'toNode';
        u.status = 'returning';
        return;
      }
      u.status = 'returning';
      MovementSystem.moveTo(state, u, goalFor(drop, REACH), dt);
      return;
    }

    let node = state.entities.get(order.nodeId);
    if (!node || node.kind !== 'resource' || node.amount <= 0) {
      const next = this.nearestNode(state, u.x, u.y, order.resource);
      if (!next) {
        if (u.carrying) order.phase = 'toDropoff';
        else u.order = { type: 'idle' };
        return;
      }
      order.nodeId = next.id;
      node = next;
      u.pathGoal = null;
    }
    if (edgeDistance(u, node) > REACH + 0.1) {
      order.phase = 'toNode';
      u.status = 'moving';
      const res = MovementSystem.moveTo(state, u, goalFor(node, REACH), dt);
      if (res === 'unreachable') {
        // Nodo inalcanzable: probar otro cercano.
        const alt = this.nearestNode(state, u.x, u.y, order.resource, 8);
        if (alt && alt.id !== node.id) order.nodeId = alt.id;
      }
      return;
    }
    order.phase = 'gathering';
    u.status = 'gathering';
    u.facing = Math.atan2(node.y - u.y, node.x - u.x);
    const rate = (def.gatherRate ?? 1) * (1 + 0.25 * player.tech.tools) * player.econMultiplier;
    if (!u.carrying || u.carrying.type !== node.type) u.carrying = { type: node.type, amount: 0 };
    const take = Math.min(rate * dt, node.amount, capacity - u.carrying.amount);
    u.carrying.amount += take;
    node.amount -= take;
    if (node.amount <= 0.001) state.removeEntity(node.id);
    if (u.carrying.amount >= capacity - 0.001) order.phase = 'toDropoff';
  },

  /** Ayudar a construir o reparar un edificio propio. */
  updateAssist(state: GameState, u: UnitEntity, dt: number) {
    const order = u.order;
    if (order.type !== 'assist') return;
    const b = state.entities.get(order.buildingId);
    if (!b || b.kind !== 'building' || b.owner !== u.owner) {
      u.order = { type: 'idle' };
      return;
    }
    const needsWork = b.state === 'construction' || b.hp < b.maxHp;
    if (!needsWork) {
      u.order = { type: 'idle' };
      return;
    }
    if (edgeDistance(u, b) > REACH + 0.15) {
      u.status = 'moving';
      MovementSystem.moveTo(state, u, goalFor(b, REACH), dt);
      return;
    }
    u.status = 'building';
    u.facing = Math.atan2(b.y - u.y, b.x - u.x);
    if (b.state === 'construction') {
      b.assistCount++;
      return;
    }
    // Reparación: cuesta madera y piedra proporcional a la vida reparada.
    const player = state.players.get(u.owner)!;
    const amount = Math.min(GAME_CONFIG.repairRate * dt, b.maxHp - b.hp);
    const def = BUILDING_DEFS[b.type];
    const totalCost = (def.cost.wood ?? 0) + (def.cost.stone ?? 0) + (def.cost.gold ?? 0) || 300;
    const perHp = (totalCost * GAME_CONFIG.repairCostFactor) / b.maxHp;
    const cost = { wood: amount * perHp * 0.6, stone: amount * perHp * 0.4 };
    if (!ResourceSystem.spend(player, cost)) {
      state.notify(u.owner, 'No hay recursos suficientes para reparar (madera y piedra).', 'warn');
      u.order = { type: 'idle' };
      return;
    }
    b.hp = Math.min(b.maxHp, b.hp + amount);
  },

  /** Producción pasiva de edificios y bonus de puntos de control. */
  updatePassive(state: GameState, dt: number) {
    for (const b of state.buildings) {
      if (b.state === 'construction') continue;
      const def = BUILDING_DEFS[b.type];
      if (!def.production) continue;
      const p = state.players.get(b.owner);
      if (!p || p.eliminated) continue;
      const resource = def.production.resource === 'auto' ? b.producesResource : def.production.resource;
      if (!resource) continue;
      const rate = def.production.rate[b.level - 1] * (1 + 0.25 * p.tech.tools) * p.econMultiplier;
      const added = ResourceSystem.add(p, resource, rate * dt);
      if (added < rate * dt * 0.5) storageWarn(state, p.id);
    }
    for (const cp of state.controlPoints) {
      if (cp.owner < 0) continue;
      for (const p of state.players.values()) {
        if (p.team === cp.owner && !p.eliminated) ResourceSystem.add(p, 'gold', GAME_CONFIG.controlPointGoldBonus * dt);
      }
    }
  },
};

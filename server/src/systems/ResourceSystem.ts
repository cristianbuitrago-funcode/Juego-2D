import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { Cost, ResourceType } from '@shared/types/game';
import { RESOURCE_TYPES } from '@shared/types/game';
import type { GameState } from '../game/GameState';
import type { PlayerState } from '../players/PlayerState';

/**
 * Gestor CENTRALIZADO de recursos y población. Ninguna otra parte del servidor
 * modifica `player.resources` directamente: todo pasa por aquí.
 */
export const ResourceSystem = {
  canAfford(p: PlayerState, cost: Cost): boolean {
    return RESOURCE_TYPES.every((r) => p.resources[r] + 1e-6 >= (cost[r] ?? 0));
  },

  /** Cobra el coste completo o nada. */
  spend(p: PlayerState, cost: Cost): boolean {
    if (!this.canAfford(p, cost)) return false;
    for (const r of RESOURCE_TYPES) p.resources[r] = Math.max(0, p.resources[r] - (cost[r] ?? 0));
    return true;
  },

  /** Ingresa recursos respetando el límite de almacenamiento. Devuelve lo realmente añadido. */
  add(p: PlayerState, type: ResourceType, amount: number, countAsGathered = true): number {
    const space = Math.max(0, p.storageCap - p.resources[type]);
    const added = Math.min(space, amount);
    p.resources[type] += added;
    if (countAsGathered) {
      p.gathered += added;
      p.stats.resourcesGathered += added;
    }
    return added;
  },

  refund(p: PlayerState, cost: Cost) {
    for (const r of RESOURCE_TYPES) if (cost[r]) this.add(p, r, cost[r] as number, false);
  },

  /** Recalcula población, población máxima y almacenamiento de todos los jugadores. */
  recompute(state: GameState) {
    for (const p of state.players.values()) {
      p.pop = 0;
      p.popCap = 0;
      p.storageCap = GAME_CONFIG.baseStorage;
    }
    for (const e of state.entities.values()) {
      const p = state.players.get(e.owner);
      if (!p) continue;
      if (e.kind === 'unit') {
        p.pop += UNIT_DEFS[e.type].pop;
      } else if (e.kind === 'building') {
        for (const q of e.queue) p.pop += UNIT_DEFS[q.unit].pop;
        if (e.state === 'construction') continue;
        const def = BUILDING_DEFS[e.type];
        if (def.popProvided) p.popCap += def.popProvided[e.level - 1] ?? 0;
        if (def.storage) p.storageCap += def.storage[e.level - 1] ?? 0;
      }
    }
    for (const p of state.players.values()) p.popCap = Math.min(p.popCap, GAME_CONFIG.maxPopulation);
  },
};

import { BUILDING_DEFS, PLACEMENT_RESOURCE_DISTANCE } from '@shared/constants/buildings';
import { Terrain, terrainDef } from '@shared/constants/terrain';
import { TECH_DEFS, UNIT_DEFS } from '@shared/constants/units';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { BuildingType, ResourceType } from '@shared/types/game';
import type { Command } from '@shared/types/messages';
import { clamp, distToRect } from '@shared/utils/math';
import type { UnitEntity } from './entities';
import type { GameState } from './GameState';
import { MovementSystem } from '../systems/MovementSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { setOrder } from '../systems/UnitSystem';
import { VisionSystem } from '../systems/VisionSystem';
import { isAttackable } from '../systems/helpers';

export type CommandResult = { ok: true } | { ok: false; error: string };
const OK: CommandResult = { ok: true };
const fail = (error: string): CommandResult => ({ ok: false, error });

/**
 * Valida y aplica las órdenes de los jugadores (humanos e IA usan exactamente el mismo camino).
 * El cliente nunca decide recursos, daño, vida, posiciones válidas ni victoria: solo pide acciones.
 */
export const CommandHandler = {
  handle(state: GameState, playerId: number, cmd: Command): CommandResult {
    if (state.phase !== 'playing') return fail('La partida ha terminado.');
    const player = state.players.get(playerId);
    if (!player || player.eliminated) return fail('Jugador no válido.');

    switch (cmd.type) {
      case 'move':
      case 'attackMove': {
        const units = this.ownUnits(state, playerId, cmd.unitIds);
        if (!units.length) return fail('Sin unidades.');
        const x = clamp(cmd.x, 0.5, state.map.width - 0.5);
        const y = clamp(cmd.y, 0.5, state.map.height - 0.5);
        const targets = MovementSystem.formationTargets(state, units.length, x, y);
        // Asignar los destinos más cercanos primero para evitar cruces.
        const sorted = [...units].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
        sorted.forEach((u, i) => setOrder(u, { type: 'move', x: targets[i].x, y: targets[i].y, attackMove: cmd.type === 'attackMove' }));
        return OK;
      }
      case 'attack': {
        const units = this.ownUnits(state, playerId, cmd.unitIds);
        const target = state.entities.get(cmd.targetId);
        if (!units.length) return fail('Sin unidades.');
        if (!isAttackable(target)) return fail('Objetivo no válido.');
        if (!state.areEnemies(playerId, target.owner)) return fail('No puedes atacar a un aliado.');
        if (!VisionSystem.sees(state, player.team, target)) return fail('El objetivo no es visible.');
        for (const u of units) setOrder(u, { type: 'attack', targetId: target.id, auto: false });
        return OK;
      }
      case 'stop': {
        for (const u of this.ownUnits(state, playerId, cmd.unitIds)) setOrder(u, { type: 'idle' });
        return OK;
      }
      case 'hold': {
        for (const u of this.ownUnits(state, playerId, cmd.unitIds)) setOrder(u, { type: 'hold' });
        return OK;
      }
      case 'retreat': {
        const units = this.ownUnits(state, playerId, cmd.unitIds);
        const cc = state.playerBuildings(playerId, 'commandCenter')[0];
        if (!cc) return fail('No hay base a la que retirarse.');
        const targets = MovementSystem.formationTargets(state, units.length, cc.x, cc.y + cc.size / 2 + 1.5);
        units.forEach((u, i) => setOrder(u, { type: 'retreat', x: targets[i].x, y: targets[i].y }));
        return OK;
      }
      case 'setPriority': {
        for (const u of this.ownUnits(state, playerId, cmd.unitIds)) u.priority = cmd.priority;
        return OK;
      }
      case 'gather': {
        const units = this.ownUnits(state, playerId, cmd.unitIds).filter((u) => UNIT_DEFS[u.type].canGather);
        const node = state.entities.get(cmd.targetId);
        if (!units.length) return fail('Solo los recolectores pueden recolectar.');
        if (!node || node.kind !== 'resource') return fail('Recurso no válido.');
        for (const u of units) setOrder(u, { type: 'gather', nodeId: node.id, resource: node.type, phase: 'toNode' });
        return OK;
      }
      case 'assist': {
        const units = this.ownUnits(state, playerId, cmd.unitIds).filter((u) => UNIT_DEFS[u.type].canGather);
        const b = state.entities.get(cmd.targetId);
        if (!units.length) return fail('Solo los recolectores pueden construir o reparar.');
        if (!b || b.kind !== 'building' || b.owner !== playerId) return fail('Edificio no válido.');
        if (b.state !== 'construction' && b.hp >= b.maxHp) return fail('El edificio no necesita reparación.');
        for (const u of units) setOrder(u, { type: 'assist', buildingId: b.id });
        return OK;
      }
      case 'build': {
        const err = this.placementError(state, playerId, cmd.building, cmd.tx, cmd.ty);
        if (err) return fail(err);
        const def = BUILDING_DEFS[cmd.building];
        if (!ResourceSystem.spend(player, def.cost)) return fail('Recursos insuficientes.');
        const b = state.addBuilding(cmd.building, playerId, cmd.tx, cmd.ty, false);
        if (cmd.building === 'mine') b.producesResource = this.nearbyOre(state, cmd.tx, cmd.ty, def.size);
        // Empujar fuera a las unidades que estuvieran en la parcela.
        for (const u of state.units) {
          if (u.x >= cmd.tx && u.x < cmd.tx + def.size && u.y >= cmd.ty && u.y < cmd.ty + def.size) {
            const p = state.map.nearestWalkable(u.x, u.y, 6);
            if (p) {
              u.x = p.x;
              u.y = p.y;
              u.path = [];
              u.pathGoal = null;
            }
          }
        }
        return OK;
      }
      case 'train': {
        const b = state.entities.get(cmd.buildingId);
        const udef = UNIT_DEFS[cmd.unit];
        if (!b || b.kind !== 'building' || b.owner !== playerId) return fail('Edificio no válido.');
        if (!udef) return fail('Unidad desconocida.');
        if (b.state !== 'active') return fail('El edificio no está disponible.');
        if (!(BUILDING_DEFS[b.type].trains ?? []).includes(cmd.unit)) return fail('Este edificio no entrena esa unidad.');
        if (b.level < udef.requiresLevel) return fail(`Requiere ${BUILDING_DEFS[b.type].name} nivel ${udef.requiresLevel}.`);
        if (udef.requiresBuilding && !state.playerBuildings(playerId, udef.requiresBuilding).some((x) => x.state !== 'construction')) {
          return fail(`Requiere ${BUILDING_DEFS[udef.requiresBuilding].name}.`);
        }
        if (b.queue.length >= GAME_CONFIG.maxQueue) return fail('Cola llena.');
        ResourceSystem.recompute(state);
        if (player.pop + udef.pop > player.popCap) return fail('Población máxima alcanzada: construye granjas.');
        if (!ResourceSystem.spend(player, udef.cost)) return fail('Recursos insuficientes.');
        b.queue.push({ unit: cmd.unit, elapsed: 0 });
        return OK;
      }
      case 'cancelTrain': {
        const b = state.entities.get(cmd.buildingId);
        if (!b || b.kind !== 'building' || b.owner !== playerId) return fail('Edificio no válido.');
        const item = b.queue.pop();
        if (!item) return fail('Cola vacía.');
        ResourceSystem.refund(player, UNIT_DEFS[item.unit].cost);
        return OK;
      }
      case 'upgrade': {
        const b = state.entities.get(cmd.buildingId);
        if (!b || b.kind !== 'building' || b.owner !== playerId) return fail('Edificio no válido.');
        const def = BUILDING_DEFS[b.type];
        if (b.state !== 'active') return fail('El edificio está ocupado.');
        if (b.level >= def.maxLevel) return fail('Nivel máximo alcanzado.');
        if (b.research) return fail('Espera a que termine la investigación.');
        if (!ResourceSystem.spend(player, def.upgradeCost[b.level - 1])) return fail('Recursos insuficientes.');
        b.state = 'upgrading';
        b.upgradeElapsed = 0;
        return OK;
      }
      case 'research': {
        const b = state.entities.get(cmd.buildingId);
        const tech = TECH_DEFS[cmd.tech];
        if (!b || b.kind !== 'building' || b.owner !== playerId) return fail('Edificio no válido.');
        if (!tech) return fail('Tecnología desconocida.');
        if (!BUILDING_DEFS[b.type].research || b.state !== 'active') return fail('El edificio no puede investigar ahora.');
        if (b.research) return fail('Ya hay una investigación en curso.');
        const level = player.tech[cmd.tech];
        if (level >= tech.maxLevel) return fail('Tecnología al máximo.');
        if (b.level < tech.requiresLevel[level]) return fail(`Requiere centro tecnológico nivel ${tech.requiresLevel[level]}.`);
        if (!ResourceSystem.spend(player, tech.cost[level])) return fail('Recursos insuficientes.');
        b.research = { tech: cmd.tech, elapsed: 0 };
        return OK;
      }
      case 'rally': {
        const b = state.entities.get(cmd.buildingId);
        if (!b || b.kind !== 'building' || b.owner !== playerId) return fail('Edificio no válido.');
        b.rally = { x: clamp(cmd.x, 0.5, state.map.width - 0.5), y: clamp(cmd.y, 0.5, state.map.height - 0.5) };
        return OK;
      }
    }
    return fail('Orden desconocida.');
  },

  ownUnits(state: GameState, playerId: number, ids: number[]): UnitEntity[] {
    const out: UnitEntity[] = [];
    const seen = new Set<number>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = state.entities.get(id);
      if (e && e.kind === 'unit' && e.owner === playerId && e.hp > 0) out.push(e);
    }
    return out;
  },

  nearbyOre(state: GameState, tx: number, ty: number, size: number): ResourceType | null {
    let best: ResourceType | null = null;
    let bestD = PLACEMENT_RESOURCE_DISTANCE;
    for (const e of state.entities.values()) {
      if (e.kind !== 'resource' || (e.type !== 'gold' && e.type !== 'stone')) continue;
      const d = distToRect(e.x, e.y, tx, ty, size, size);
      if (d <= bestD) {
        bestD = d;
        best = e.type;
      }
    }
    return best;
  },

  /** Devuelve un mensaje de error si no se puede construir ahí, o null si es válido. */
  placementError(state: GameState, playerId: number, type: BuildingType, tx: number, ty: number): string | null {
    const def = BUILDING_DEFS[type];
    if (!def || !def.buildable) return 'Edificio no construible.';
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) return 'Posición no válida.';
    if (def.maxCount !== undefined && state.playerBuildings(playerId, type).length >= def.maxCount) {
      return `Solo puedes tener ${def.maxCount} ${def.name}.`;
    }
    const terr = state.territory();
    const map = state.map;
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        if (!map.inBounds(x, y)) return 'Fuera del mapa.';
        const i = y * map.width + x;
        if (!terrainDef(map.tiles[i]).buildable) return 'Terreno no edificable.';
        if (map.occupant[i] !== 0) return 'La zona está ocupada.';
        if (terr[i] !== playerId) return 'Solo puedes construir dentro de tu territorio.';
      }
    }
    for (const e of state.entities.values()) {
      if (e.kind === 'resource' && e.tx >= tx && e.tx < tx + def.size && e.ty >= ty && e.ty < ty + def.size) {
        return 'Hay recursos en esa zona.';
      }
    }
    if (def.placement === 'nearGoldOrStone' &&!this.nearbyOre(state, tx, ty, def.size)) {
      return 'La mina debe construirse junto a un yacimiento de oro o piedra.';
    }
    if (def.placement === 'nearForest') {
      let ok = false;
      const r = PLACEMENT_RESOURCE_DISTANCE;
      for (let y = ty - r; y < ty + def.size + r && !ok; y++) {
        for (let x = tx - r; x < tx + def.size + r && !ok; x++) {
          if (map.terrain(x, y) === Terrain.Forest && distToRect(x + 0.5, y + 0.5, tx, ty, def.size, def.size) <= r) ok = true;
        }
      }
      if (!ok) return 'El aserradero debe construirse cerca de un bosque.';
    }
    return null;
  },
};

import { BUILDING_DEFS, buildingMaxHp } from '@shared/constants/buildings';
import { TECH_DEFS, UNIT_DEFS } from '@shared/constants/units';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { BuildingEntity } from '../game/entities';
import type { GameState } from '../game/GameState';
import { setOrder } from './UnitSystem';

/** Construcción, mejoras, entrenamiento de unidades e investigación. */
export const ProductionSystem = {
  update(state: GameState, dt: number) {
    for (const b of state.buildings) {
      const player = state.players.get(b.owner);
      if (!player || player.eliminated) continue;
      const def = BUILDING_DEFS[b.type];

      if (b.state === 'construction') {
        const rate = (1 / def.buildTime) * (1 + GAME_CONFIG.assistBuildBonus * b.assistCount);
        const delta = Math.min(rate * dt, 1 - b.progress);
        b.progress += delta;
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * delta);
        if (b.progress >= 1) {
          b.progress = 1;
          b.state = 'active';
          player.stats.buildingsBuilt++;
          state.emit({ type: 'built', id: b.id, t: b.type, o: b.owner }, { to: [b.owner] });
          state.notify(b.owner, `${def.name} completado.`);
        }
        continue;
      }

      if (b.state === 'upgrading') {
        b.upgradeElapsed += dt;
        const time = def.upgradeTime[b.level - 1];
        if (b.upgradeElapsed >= time) {
          b.level++;
          const newMax = buildingMaxHp(b.type, b.level);
          b.hp += newMax - b.maxHp;
          b.maxHp = newMax;
          b.state = 'active';
          b.upgradeElapsed = 0;
          state.emit({ type: 'upgraded', id: b.id, level: b.level }, { to: [b.owner] });
          state.notify(b.owner, `${def.name} mejorado a nivel ${b.level}.`);
        }
        continue;
      }

      // Entrenamiento (solo el primero de la cola avanza).
      const item = b.queue[0];
      if (item) {
        item.elapsed += dt;
        if (item.elapsed >= UNIT_DEFS[item.unit].trainTime) {
          this.spawnUnit(state, b, item.unit);
          b.queue.shift();
        }
      }

      // Investigación.
      if (b.research) {
        b.research.elapsed += dt;
        const tech = TECH_DEFS[b.research.tech];
        const level = player.tech[b.research.tech];
        if (b.research.elapsed >= tech.time[level]) {
          player.tech[b.research.tech] = level + 1;
          state.emit({ type: 'researched', tech: b.research.tech, level: level + 1 }, { to: [b.owner] });
          state.notify(b.owner, `Investigación completada: ${tech.name} ${level + 1}.`);
          b.research = null;
        }
      }
    }
  },

  spawnUnit(state: GameState, b: BuildingEntity, type: keyof typeof UNIT_DEFS) {
    const player = state.players.get(b.owner)!;
    // Aparece en el borde del edificio, del lado del punto de reunión si existe.
    const tx = b.rally ? b.rally.x : b.x;
    const ty = b.rally ? b.rally.y : b.y + b.size;
    const dx = tx - b.x;
    const dy = ty - b.y;
    const len = Math.hypot(dx, dy) || 1;
    const sx = b.x + (dx / len) * (b.size / 2 + 0.6);
    const sy = b.y + (dy / len) * (b.size / 2 + 0.6);
    const pos = state.map.nearestWalkable(sx, sy, 8) ?? { x: sx, y: sy };
    const u = state.addUnit(type, b.owner, pos.x, pos.y);
    player.stats.unitsTrained++;
    state.emit({ type: 'trained', id: u.id, t: type }, { to: [b.owner] });
    if (b.rally) setOrder(u, { type: 'move', x: b.rally.x, y: b.rally.y, attackMove: false });
  },
};

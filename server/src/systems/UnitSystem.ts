import { UNIT_DEFS } from '@shared/constants/units';
import type { Order, UnitEntity } from '../game/entities';
import type { GameState } from '../game/GameState';
import { CombatSystem } from './CombatSystem';
import { EconomySystem } from './EconomySystem';
import { goalFor, isAttackable } from './helpers';
import { MovementSystem } from './MovementSystem';
import { VisionSystem } from './VisionSystem';

/** Distancia máxima que una unidad persigue a un objetivo adquirido automáticamente. */
const LEASH = 7;
const SCAN_INTERVAL = 0.35;

export function setOrder(u: UnitEntity, order: Order) {
  u.order = order;
  u.path = [];
  u.pathGoal = null;
  u.repathTimer = 0;
}

function acquireRadius(u: UnitEntity): number {
  const def = UNIT_DEFS[u.type];
  return Math.max(def.range + 2, Math.min(def.sight - 0.5, def.range + 4));
}

/** Máquina de estados de las órdenes de cada unidad. */
export const UnitSystem = {
  update(state: GameState, dt: number) {
    for (const u of state.units) {
      if (u.hp <= 0) continue;
      u.cooldown = Math.max(0, u.cooldown - dt);
      u.scanTimer -= dt;
      const scan = u.scanTimer <= 0;
      if (scan) u.scanTimer = SCAN_INTERVAL;
      const def = UNIT_DEFS[u.type];
      const order = u.order;

      switch (order.type) {
        case 'idle': {
          u.status = 'idle';
          if (def.autoAcquire && scan) {
            const t = CombatSystem.findTarget(state, u, acquireRadius(u));
            if (t) setOrder(u, { type: 'attack', targetId: t.id, auto: true, anchor: { x: u.x, y: u.y } });
          }
          break;
        }
        case 'hold': {
          u.status = 'holding';
          if (def.autoAcquire) {
            const t = CombatSystem.findTarget(state, u, def.range + 0.05);
            if (t) CombatSystem.tryAttack(state, u, t);
          }
          break;
        }
        case 'move':
        case 'retreat': {
          u.status = order.type === 'retreat' ? 'retreating' : 'moving';
          if (order.type === 'move' && order.attackMove && scan && def.autoAcquire) {
            const t = CombatSystem.findTarget(state, u, acquireRadius(u));
            if (t) {
              setOrder(u, { type: 'attack', targetId: t.id, auto: true, anchor: { x: u.x, y: u.y }, resume: { x: order.x, y: order.y } });
              break;
            }
          }
          const res = MovementSystem.moveTo(state, u, { x: order.x, y: order.y, range: 0.15 }, dt);
          if (res !== 'moving') setOrder(u, { type: 'idle' });
          break;
        }
        case 'attack': {
          const target = state.entities.get(order.targetId);
          const team = state.teamOf(u.owner);
          if (!isAttackable(target) || !VisionSystem.sees(state, team, target)) {
            this.finishAttack(u);
            break;
          }
          if (order.auto && order.anchor && Math.hypot(u.x - order.anchor.x, u.y - order.anchor.y) > LEASH) {
            // Demasiado lejos: abandonar la persecución.
            this.finishAttack(u, true);
            break;
          }
          if (CombatSystem.inRange(u, target)) {
            MovementSystem.stop(u);
            u.status = 'attacking';
            CombatSystem.tryAttack(state, u, target);
          } else {
            u.status = 'moving';
            // En ataque automático, cambiar a un objetivo más cercano si aparece.
            if (order.auto && scan) {
              const closer = CombatSystem.findTarget(state, u, def.range + 0.05);
              if (closer && closer.id !== target.id) {
                order.targetId = closer.id;
                break;
              }
            }
            const res = MovementSystem.moveTo(state, u, goalFor(target, def.range * 0.9), dt);
            if (res === 'unreachable' && order.auto) this.finishAttack(u);
          }
          break;
        }
        case 'gather':
          EconomySystem.updateGatherer(state, u, dt);
          break;
        case 'assist':
          EconomySystem.updateAssist(state, u, dt);
          break;
      }
    }
  },

  /** Al terminar un ataque: retomar ataque-movimiento, volver al ancla o quedar en reposo. */
  finishAttack(u: UnitEntity, returnToAnchor = false) {
    const order = u.order;
    if (order.type !== 'attack') return setOrder(u, { type: 'idle' });
    if (order.resume) return setOrder(u, { type: 'move', x: order.resume.x, y: order.resume.y, attackMove: true });
    if (returnToAnchor && order.anchor) return setOrder(u, { type: 'move', x: order.anchor.x, y: order.anchor.y, attackMove: false });
    setOrder(u, { type: 'idle' });
  },
};

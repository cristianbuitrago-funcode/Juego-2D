import { UNIT_DEFS } from '@shared/constants/units';
import { distToRect } from '@shared/utils/math';
import type { UnitEntity } from '../game/entities';
import type { GameState } from '../game/GameState';
import { findPath, type PathGoal } from './Pathfinding';

export type MoveStatus = 'arrived' | 'moving' | 'unreachable';

function goalDist(goal: PathGoal, x: number, y: number) {
  return goal.rect ? distToRect(x, y, goal.rect.x, goal.rect.y, goal.rect.w, goal.rect.h) : Math.hypot(x - goal.x, y - goal.y);
}

/**
 * Movimiento autoritativo: el servidor calcula rutas y posiciones. El cliente solo interpola.
 */
export const MovementSystem = {
  /** Avanza la unidad hacia el objetivo. Recalcula la ruta cuando el objetivo cambia o se atasca. */
  moveTo(state: GameState, u: UnitEntity, goal: PathGoal, dt: number): MoveStatus {
    if (goalDist(goal, u.x, u.y) <= goal.range) {
      u.path = [];
      return 'arrived';
    }
    u.repathTimer -= dt;
    const goalMoved = !u.pathGoal || Math.hypot(u.pathGoal.x - goal.x, u.pathGoal.y - goal.y) > 0.75;
    if ((goalMoved || u.path.length === 0) && u.repathTimer <= 0) {
      u.path = findPath(state.map, u.x, u.y, goal);
      u.pathGoal = { x: goal.x, y: goal.y };
      u.repathTimer = 0.4;
      u.stuckTimer = 0;
      u.lastPos = { x: u.x, y: u.y };
      if (u.path.length === 0) return goalDist(goal, u.x, u.y) <= goal.range + 0.6 ? 'arrived' : 'unreachable';
    }
    if (u.path.length === 0) return goalMoved ? 'moving' : 'unreachable';
    this.step(state, u, dt);

    // Detección de atascos: si apenas se mueve en 1.2 s, fuerza recalcular.
    u.stuckTimer += dt;
    if (u.stuckTimer > 1.2) {
      if (Math.hypot(u.x - u.lastPos.x, u.y - u.lastPos.y) < 0.3) {
        u.pathGoal = null;
        u.path = [];
        u.repathTimer = 0;
      }
      u.stuckTimer = 0;
      u.lastPos = { x: u.x, y: u.y };
    }
    return 'moving';
  },

  step(state: GameState, u: UnitEntity, dt: number) {
    const def = UNIT_DEFS[u.type];
    let remaining = def.speed * Math.max(0.2, state.map.speedAt(u.x, u.y)) * dt;
    while (remaining > 0 && u.path.length > 0) {
      const wp = u.path[0];
      const dx = wp.x - u.x;
      const dy = wp.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.001) u.facing = Math.atan2(dy, dx);
      if (d <= remaining) {
        u.x = wp.x;
        u.y = wp.y;
        u.path.shift();
        remaining -= d;
      } else {
        u.x += (dx / d) * remaining;
        u.y += (dy / d) * remaining;
        remaining = 0;
      }
    }
  },

  stop(u: UnitEntity) {
    u.path = [];
    u.pathGoal = null;
  },

  /** Separación simple entre unidades para que no se apilen, y expulsión de casillas bloqueadas. */
  separate(state: GameState) {
    const units = state.units;
    const map = state.map;
    // Rejilla espacial por casilla para evitar O(n²).
    const cells = new Map<number, UnitEntity[]>();
    for (const u of units) {
      const k = Math.floor(u.y) * map.width + Math.floor(u.x);
      let arr = cells.get(k);
      if (!arr) cells.set(k, (arr = []));
      arr.push(u);
    }
    for (const a of units) {
      const ra = UNIT_DEFS[a.type].radius;
      const cx = Math.floor(a.x);
      const cy = Math.floor(a.y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const arr = cells.get((cy + dy) * map.width + cx + dx);
          if (!arr) continue;
          for (const b of arr) {
            if (b.id <= a.id) continue;
            const rb = UNIT_DEFS[b.type].radius;
            const min = (ra + rb) * 0.85;
            let ddx = b.x - a.x;
            let ddy = b.y - a.y;
            let d = Math.hypot(ddx, ddy);
            if (d >= min) continue;
            if (d < 0.0001) {
              ddx = Math.cos(a.id);
              ddy = Math.sin(a.id);
              d = 1;
            }
            const push = (min - d) * 0.5;
            const nx = ddx / d;
            const ny = ddy / d;
            // Las unidades en movimiento ceden menos que las quietas.
            const aw = a.path.length > 0 ? 0.3 : 1;
            const bw = b.path.length > 0 ? 0.3 : 1;
            const tot = aw + bw;
            const ax = a.x - nx * push * (aw / tot) * 2;
            const ay = a.y - ny * push * (aw / tot) * 2;
            const bx = b.x + nx * push * (bw / tot) * 2;
            const by = b.y + ny * push * (bw / tot) * 2;
            if (map.isWalkableAt(ax, ay)) {
              a.x = ax;
              a.y = ay;
            }
            if (map.isWalkableAt(bx, by)) {
              b.x = bx;
              b.y = by;
            }
          }
        }
      }
    }
    for (const u of units) {
      if (!map.isWalkableAt(u.x, u.y)) {
        const p = map.nearestWalkable(u.x, u.y, 6);
        if (p) {
          u.x = p.x;
          u.y = p.y;
          u.path = [];
          u.pathGoal = null;
        }
      }
    }
  },

  /** Destinos en formación (espiral) alrededor de un punto para un grupo de unidades. */
  formationTargets(state: GameState, count: number, x: number, y: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const spacing = 0.85;
    out.push({ x, y });
    let ring = 1;
    while (out.length < count && ring < 12) {
      const n = Math.max(6, Math.round(2 * Math.PI * ring));
      for (let i = 0; i < n && out.length < count; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * ring * spacing;
        const py = y + Math.sin(a) * ring * spacing;
        if (state.map.isWalkableAt(px, py)) out.push({ x: px, y: py });
      }
      ring++;
    }
    while (out.length < count) out.push({ x, y });
    return out;
  },
};

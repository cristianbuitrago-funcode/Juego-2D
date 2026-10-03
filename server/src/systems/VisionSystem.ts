import { BUILDING_DEFS } from '@shared/constants/buildings';
import { FOREST_REVEAL_DISTANCE, terrainDef } from '@shared/constants/terrain';
import { UNIT_DEFS } from '@shared/constants/units';
import type { Entity } from '../game/entities';
import type { GameState } from '../game/GameState';

/**
 * Niebla de guerra autoritativa: calcula qué casillas ve cada equipo.
 * El servidor solo envía a cada jugador lo que su equipo puede ver, así que
 * un cliente modificado no puede revelar unidades ocultas.
 */
export const VisionSystem = {
  update(state: GameState) {
    const { width, height } = state.map;
    const teams = new Set<number>();
    for (const p of state.players.values()) teams.add(p.team);
    for (const t of teams) {
      let vis = state.visibility.get(t);
      if (!vis) {
        vis = new Uint8Array(width * height);
        state.visibility.set(t, vis);
      }
      vis.fill(0);
    }
    for (const e of state.entities.values()) {
      if (e.kind === 'resource') continue;
      const p = state.players.get(e.owner);
      if (!p || p.eliminated) continue;
      const vis = state.visibility.get(p.team)!;
      let r: number;
      if (e.kind === 'unit') r = UNIT_DEFS[e.type].sight;
      else r = BUILDING_DEFS[e.type].sight * (e.state === 'construction' ? 0.5 : 1) + e.size / 2;
      const x0 = Math.max(0, Math.floor(e.x - r));
      const x1 = Math.min(width - 1, Math.floor(e.x + r));
      const y0 = Math.max(0, Math.floor(e.y - r));
      const y1 = Math.min(height - 1, Math.floor(e.y + r));
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - e.y;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - e.x;
          if (dx * dx + dy * dy <= r2) vis[y * width + x] = 1;
        }
      }
    }
    // Caché de entidades visibles por equipo para este tick.
    for (const t of teams) {
      const set = new Set<number>();
      for (const e of state.entities.values()) if (this.canTeamSee(state, t, e)) set.add(e.id);
      state.visibleEntities.set(t, set);
    }
  },

  /** Consulta rápida usando la caché del tick (las entidades propias siempre son visibles). */
  sees(state: GameState, team: number, e: Entity): boolean {
    if (e.kind !== 'resource' && state.teamOf(e.owner) === team) return true;
    return state.visibleEntities.get(team)?.has(e.id) ?? false;
  },

  /** ¿Puede el equipo `team` ver la entidad `e`? */
  canTeamSee(state: GameState, team: number, e: Entity): boolean {
    if (e.kind !== 'resource' && state.teamOf(e.owner) === team) return true;
    if (e.kind === 'building') {
      for (let y = e.ty; y < e.ty + e.size; y++)
        for (let x = e.tx; x < e.tx + e.size; x++) if (state.isVisibleTile(team, x, y)) return true;
      return false;
    }
    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);
    if (!state.isVisibleTile(team, tx, ty)) return false;
    if (e.kind === 'unit' && terrainDef(state.map.terrain(tx, ty)).hides && e.revealedUntil < state.time) {
      // Oculta en el bosque: solo se detecta a corta distancia.
      for (const o of state.entities.values()) {
        if (o.kind === 'resource' || state.teamOf(o.owner) !== team) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) <= FOREST_REVEAL_DISTANCE + (o.kind === 'building' ? o.size / 2 : 0)) return true;
      }
      return false;
    }
    return true;
  },
};

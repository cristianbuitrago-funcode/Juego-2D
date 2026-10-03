import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { GameState } from '../game/GameState';

/**
 * Puntos estratégicos: se capturan con unidades dentro del radio sin oposición.
 * Si hay unidades de varios equipos, el punto está en disputa y no cambia.
 */
export const ControlPointSystem = {
  update(state: GameState, dt: number) {
    const rate = 1 / GAME_CONFIG.captureSeconds;
    for (const cp of state.controlPoints) {
      const present = new Set<number>();
      for (const u of state.units) {
        if (Math.hypot(u.x - cp.x, u.y - cp.y) <= cp.radius) {
          const p = state.players.get(u.owner);
          if (p && !p.eliminated) present.add(p.team);
        }
      }
      if (present.size !== 1) continue;
      const team = [...present][0];
      if (cp.owner === team) {
        // Reforzar: recuperar progreso perdido.
        cp.progress = 1;
        cp.capturingTeam = team;
        continue;
      }
      if (cp.capturingTeam !== team) {
        // Otro equipo empieza a capturar: primero neutraliza.
        cp.progress -= rate * dt;
        if (cp.progress <= 0) {
          cp.progress = 0;
          cp.capturingTeam = team;
          if (cp.owner !== -1) cp.owner = -1;
        }
        continue;
      }
      cp.progress += rate * dt;
      if (cp.progress >= 1) {
        cp.progress = 1;
        cp.owner = team;
        state.emit({ type: 'captured', pointId: cp.id, team });
      }
    }
    // Puntuación por puntos controlados.
    for (const cp of state.controlPoints) {
      if (cp.owner < 0) continue;
      for (const p of state.players.values()) if (p.team === cp.owner && !p.eliminated) p.score += dt;
    }
  },
};

import { isPassable } from '@shared/constants/terrain';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { VictoryCondition } from '@shared/config/gameModes';
import type { GameState } from '../game/GameState';
import type { PlayerState } from '../players/PlayerState';

/**
 * Evalúa eliminaciones y condiciones de victoria configuradas por el modo de juego.
 * Para añadir una condición nueva: añade su tipo en shared/config/gameModes.ts y un caso en `evaluate`.
 */
export const VictorySystem = {
  update(state: GameState, dt: number) {
    if (state.phase !== 'playing') return;
    this.checkEliminations(state);
    for (const cond of state.mode.victory) {
      const res = this.evaluate(state, cond, dt);
      if (res) {
        this.end(state, res.team, res.reason);
        return;
      }
    }
  },

  checkEliminations(state: GameState) {
    for (const p of state.players.values()) {
      if (p.eliminated) continue;
      const hasBase = state.buildings.some((b) => b.owner === p.id && b.type === 'commandCenter');
      if (!hasBase) this.eliminate(state, p, `${p.name} ha perdido su centro de mando.`);
      else if (!p.isAI && !p.connected && p.disconnectedAt !== null && state.time - p.disconnectedAt > GAME_CONFIG.reconnectGrace) {
        this.eliminate(state, p, `${p.name} ha abandonado la partida.`);
      }
    }
  },

  eliminate(state: GameState, p: PlayerState, text: string) {
    p.eliminated = true;
    for (const e of [...state.entities.values()]) if (e.kind !== 'resource' && e.owner === p.id) state.removeEntity(e.id);
    state.emit({ type: 'eliminated', playerId: p.id });
    state.emit({ type: 'notify', text, level: 'warn' });
  },

  /** Rendición voluntaria. */
  surrender(state: GameState, playerId: number) {
    const p = state.players.get(playerId);
    if (p && !p.eliminated) this.eliminate(state, p, `${p.name} se ha rendido.`);
  },

  aliveTeams(state: GameState): Set<number> {
    const s = new Set<number>();
    for (const p of state.players.values()) if (!p.eliminated) s.add(p.team);
    return s;
  },

  evaluate(state: GameState, cond: VictoryCondition, dt: number): { team: number; reason: string } | null {
    switch (cond.type) {
      case 'lastTeamStanding': {
        const alive = this.aliveTeams(state);
        if (state.initialTeams.size > 1 && alive.size <= 1) {
          const team = alive.size === 1 ? [...alive][0] : -1;
          return { team, reason: 'Último equipo en pie' };
        }
        // Partida de un solo equipo (pruebas): termina si todos son eliminados.
        if (state.initialTeams.size <= 1 && alive.size === 0) return { team: -1, reason: 'Todos eliminados' };
        return null;
      }
      case 'controlPoints': {
        for (const p of state.players.values()) {
          if (!p.eliminated && p.score >= cond.score) return { team: p.team, reason: `Alcanzó ${cond.score} puntos de control` };
        }
        return null;
      }
      case 'resources': {
        const totals = new Map<number, number>();
        for (const p of state.players.values()) totals.set(p.team, (totals.get(p.team) ?? 0) + p.gathered);
        for (const [team, total] of totals) {
          if (total >= cond.amount && [...state.players.values()].some((p) => p.team === team && !p.eliminated)) {
            return { team, reason: `Recolectó ${cond.amount} recursos` };
          }
        }
        return null;
      }
      case 'holdTerritory': {
        const terr = state.territory();
        let passable = 0;
        const byOwner = new Map<number, number>();
        for (let i = 0; i < terr.length; i++) {
          if (!isPassable(state.map.tiles[i])) continue;
          passable++;
          if (terr[i] >= 0) byOwner.set(terr[i], (byOwner.get(terr[i]) ?? 0) + 1);
        }
        for (const p of state.players.values()) {
          if (p.eliminated) continue;
          const pct = ((byOwner.get(p.id) ?? 0) / passable) * 100;
          p.territoryHold = pct >= cond.percent ? p.territoryHold + dt : 0;
          if (p.territoryHold >= cond.seconds) return { team: p.team, reason: `Mantuvo el ${cond.percent}% del territorio` };
        }
        return null;
      }
    }
  },

  end(state: GameState, team: number, reason: string) {
    state.phase = 'ended';
    state.winner = { team, reason };
  },
};

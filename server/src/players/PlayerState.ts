import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { PlayerPublic, Resources, TechType } from '@shared/types/game';
import type { PlayerStats } from '@shared/types/messages';

/** Estado de un jugador dentro de una partida (humano o IA). */
export interface PlayerState {
  id: number;
  name: string;
  color: string;
  team: number;
  isAI: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  eliminated: boolean;
  spawn: { x: number; y: number };
  /** Recursos (pueden ser fraccionarios en el servidor; el cliente los ve redondeados). */
  resources: Resources;
  storageCap: number;
  pop: number;
  popCap: number;
  tech: Record<TechType, number>;
  gathered: number;
  score: number;
  /** Multiplicador económico (dificultad de la IA). 1 para humanos. */
  econMultiplier: number;
  /** Segundos seguidos cumpliendo la condición de territorio. */
  territoryHold: number;
  stats: Omit<PlayerStats, 'playerId' | 'name'>;
}

export function createPlayerState(p: {
  id: number;
  name: string;
  color: string;
  team: number;
  isAI: boolean;
  spawn: { x: number; y: number };
  econMultiplier?: number;
}): PlayerState {
  return {
    ...p,
    connected: true,
    disconnectedAt: null,
    eliminated: false,
    resources: { ...GAME_CONFIG.startResources },
    storageCap: GAME_CONFIG.baseStorage,
    pop: 0,
    popCap: 0,
    tech: { weapons: 0, armor: 0, tools: 0 },
    gathered: 0,
    score: 0,
    econMultiplier: p.econMultiplier ?? 1,
    territoryHold: 0,
    stats: { unitsTrained: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0, resourcesGathered: 0 },
  };
}

export function toPublic(p: PlayerState): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    team: p.team,
    isAI: p.isAI,
    connected: p.connected,
    eliminated: p.eliminated,
    score: Math.floor(p.score),
  };
}

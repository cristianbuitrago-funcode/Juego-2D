import type { GameModeId } from '../types/game';

// Modos de juego definidos por datos. Un modo nuevo = una entrada nueva en GAME_MODES
// combinando condiciones de victoria existentes (o añadiendo un evaluador nuevo en el servidor).

export type VictoryCondition =
  /** Siempre activa en todos los modos: un jugador sin centro de mando queda eliminado; gana el último equipo en pie. */
  | { type: 'lastTeamStanding' }
  /** Los puntos de control otorgan puntos por segundo; gana quien llegue a `score`. */
  | { type: 'controlPoints'; score: number }
  /** Gana el primer equipo que recolecte `amount` recursos en total. */
  | { type: 'resources'; amount: number }
  /** Gana quien controle `percent`% del terreno transitable durante `seconds` segundos seguidos. */
  | { type: 'holdTerritory'; percent: number; seconds: number };

export interface GameModeConfig {
  id: GameModeId;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** 'ffa' = todos contra todos; 'coop' = humanos (equipo 0) contra IA (equipo 1). */
  teams: 'ffa' | 'coop';
  victory: VictoryCondition[];
  controlPoints: number;
  /** Modo experimental: funcional pero menos probado. */
  experimental?: boolean;
}

export const GAME_MODES: Record<GameModeId, GameModeConfig> = {
  battle: {
    id: 'battle',
    name: 'Batalla',
    description: 'Todos contra todos. Destruye los centros de mando enemigos. Gana el último en pie.',
    minPlayers: 2,
    maxPlayers: 4,
    teams: 'ffa',
    victory: [{ type: 'lastTeamStanding' }],
    controlPoints: 1,
  },
  territory: {
    id: 'territory',
    name: 'Control territorial',
    description: 'Captura y mantén los puntos estratégicos. Cada punto da puntuación; gana quien llegue a 300.',
    minPlayers: 2,
    maxPlayers: 4,
    teams: 'ffa',
    victory: [{ type: 'lastTeamStanding' }, { type: 'controlPoints', score: 300 }],
    controlPoints: 5,
  },
  coop: {
    id: 'coop',
    name: 'Cooperativo',
    description: 'Los jugadores humanos colaboran contra bases controladas por la IA.',
    minPlayers: 1,
    maxPlayers: 3,
    teams: 'coop',
    victory: [{ type: 'lastTeamStanding' }],
    controlPoints: 1,
  },
  economy: {
    id: 'economy',
    name: 'Carrera económica',
    description: 'Gana el primero en recolectar 3000 recursos (o el último en pie).',
    minPlayers: 2,
    maxPlayers: 4,
    teams: 'ffa',
    victory: [{ type: 'lastTeamStanding' }, { type: 'resources', amount: 3000 }],
    controlPoints: 1,
    experimental: true,
  },
  domination: {
    id: 'domination',
    name: 'Dominio',
    description: 'Controla el 25% del territorio durante 90 segundos (o sé el último en pie).',
    minPlayers: 2,
    maxPlayers: 4,
    teams: 'ffa',
    victory: [{ type: 'lastTeamStanding' }, { type: 'holdTerritory', percent: 25, seconds: 90 }],
    controlPoints: 1,
    experimental: true,
  },
};

export const GAME_MODE_IDS = Object.keys(GAME_MODES) as GameModeId[];

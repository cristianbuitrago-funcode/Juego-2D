import type { MapSize, Resources } from '../types/game';

/** Parámetros globales de la simulación y la red. */
export const GAME_CONFIG = {
  /** Ticks de simulación por segundo en el servidor. */
  tickRate: 20,
  /** Snapshots (deltas) por segundo que el servidor envía a cada cliente. */
  snapshotRate: 10,
  /** Tamaño de casilla en píxeles del mundo (solo el cliente lo usa para dibujar). */
  tileSize: 32,
  minPlayers: 2,
  maxPlayers: 4,
  startResources: { gold: 200, wood: 250, stone: 150, food: 250 } as Resources,
  baseStorage: 1000,
  maxPopulation: 100,
  /** Unidades iniciales por jugador. */
  startUnits: [
    { type: 'gatherer', count: 3 },
    { type: 'soldier', count: 2 },
  ] as const,
  maxQueue: 5,
  /** Segundos que se guarda la plaza de un jugador desconectado durante la partida. */
  reconnectGrace: 60,
  /** Fracción del coste que cuesta reparar la vida perdida completa de un edificio. */
  repairCostFactor: 0.4,
  /** Velocidad de reparación (vida por segundo por recolector). */
  repairRate: 12,
  /** Bonus de velocidad de construcción por cada recolector que ayuda. */
  assistBuildBonus: 0.6,
  /** Puntos de control. */
  controlPointRadius: 3,
  captureSeconds: 8,
  controlPointGoldBonus: 0.5,
  /** Límite de comandos por segundo por jugador (anti-spam). */
  commandsPerSecond: 25,
  commandBurst: 50,
  maxUnitsPerCommand: 200,
};

export const MAP_SIZES: Record<MapSize, number> = {
  small: 48,
  medium: 64,
  large: 80,
};

export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#f97316'];

export const ROOM_CODE_LENGTH = 5;
export const PLAYER_NAME_MAX = 16;

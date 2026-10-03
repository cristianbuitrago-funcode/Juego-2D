import type {
  AIDifficulty,
  BuildingType,
  ControlPointState,
  EntityState,
  GameModeId,
  MapSize,
  PlayerPrivate,
  PlayerPublic,
  TargetPriority,
  TechType,
  UnitType,
  Vec2,
} from './game';

// ---------------------------------------------------------------------------
// Órdenes del cliente. El cliente SOLO envía intenciones; el servidor valida todo.
// ---------------------------------------------------------------------------
export type Command =
  | { type: 'move'; unitIds: number[]; x: number; y: number }
  | { type: 'attackMove'; unitIds: number[]; x: number; y: number }
  | { type: 'attack'; unitIds: number[]; targetId: number }
  | { type: 'stop'; unitIds: number[] }
  | { type: 'hold'; unitIds: number[] }
  | { type: 'retreat'; unitIds: number[] }
  | { type: 'gather'; unitIds: number[]; targetId: number }
  | { type: 'assist'; unitIds: number[]; targetId: number }
  | { type: 'setPriority'; unitIds: number[]; priority: TargetPriority }
  | { type: 'build'; building: BuildingType; tx: number; ty: number }
  | { type: 'train'; buildingId: number; unit: UnitType }
  | { type: 'cancelTrain'; buildingId: number }
  | { type: 'upgrade'; buildingId: number }
  | { type: 'research'; buildingId: number; tech: TechType }
  | { type: 'rally'; buildingId: number; x: number; y: number };

export type CommandType = Command['type'];

// ---------------------------------------------------------------------------
// Eventos de juego (para animaciones, sonidos y notificaciones).
// ---------------------------------------------------------------------------
export type GameEvent =
  | { type: 'attack'; from: number; to: number; ranged: boolean; x1: number; y1: number; x2: number; y2: number; dmg: number }
  | { type: 'death'; id: number; kind: 'unit' | 'building'; t: string; o: number; x: number; y: number }
  | { type: 'built'; id: number; t: BuildingType; o: number }
  | { type: 'trained'; id: number; t: UnitType }
  | { type: 'upgraded'; id: number; level: number }
  | { type: 'researched'; tech: TechType; level: number }
  | { type: 'captured'; pointId: number; team: number }
  | { type: 'eliminated'; playerId: number }
  | { type: 'notify'; text: string; level: 'info' | 'warn' | 'error' }
  | { type: 'underAttack'; x: number; y: number };

/** Mensaje periódico del servidor. Es un delta: solo incluye lo que cambió para ese jugador. */
export interface Snapshot {
  /** Tiempo de partida (segundos). */
  time: number;
  tick: number;
  /** true = el cliente debe descartar su estado y usar este (tras reconexión). */
  full?: boolean;
  /** Entidades nuevas o modificadas visibles para el jugador. */
  ents: EntityState[];
  /** Entidades que dejaron de ser visibles o desaparecieron. */
  rm: number[];
  /** Estado privado del jugador (solo si cambió). */
  me?: PlayerPrivate;
  /** Puntos de control (solo si cambiaron). */
  pts?: ControlPointState[];
  /** Jugadores públicos (solo si cambiaron). */
  players?: PlayerPublic[];
  /** Eventos ocurridos desde el último snapshot (filtrados por visibilidad). */
  ev?: GameEvent[];
}

export interface GameInit {
  roomCode: string;
  mode: GameModeId;
  you: number;
  yourTeam: number;
  players: PlayerPublic[];
  map: { width: number; height: number; tiles: number[] };
  controlPoints: ControlPointState[];
  tickRate: number;
  snapshotRate: number;
}

export interface PlayerStats {
  playerId: number;
  name: string;
  unitsTrained: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  resourcesGathered: number;
}

export interface GameOverInfo {
  winnerTeam: number;
  winners: number[];
  reason: string;
  duration: number;
  stats: PlayerStats[];
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
export interface RoomSettings {
  mode: GameModeId;
  mapSize: MapSize;
  aiDifficulty: AIDifficulty;
}

export interface LobbyPlayer {
  slot: number;
  name: string;
  color: string;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  phase: 'lobby' | 'playing';
  settings: RoomSettings;
  players: LobbyPlayer[];
  maxPlayers: number;
  minPlayers: number;
}

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface JoinResult {
  room: RoomInfo;
  slot: number;
  /** Token secreto para reconectarse a la misma plaza. */
  token: string;
}

export interface ClientToServerEvents {
  'lobby:create': (p: { name: string; settings?: Partial<RoomSettings> }, ack: Ack<JoinResult>) => void;
  'lobby:join': (p: { name: string; code: string }, ack: Ack<JoinResult>) => void;
  'lobby:rejoin': (p: { code: string; token: string }, ack: Ack<JoinResult>) => void;
  'lobby:ready': (ready: boolean) => void;
  'lobby:settings': (s: Partial<RoomSettings>) => void;
  'lobby:start': (ack: Ack<null>) => void;
  'lobby:leave': () => void;
  'game:command': (cmd: Command) => void;
  'game:surrender': () => void;
  'net:ping': (t: number, ack: (t: number) => void) => void;
}

export interface ServerToClientEvents {
  'lobby:state': (room: RoomInfo) => void;
  'game:init': (init: GameInit) => void;
  'game:snapshot': (snap: Snapshot) => void;
  'game:over': (info: GameOverInfo) => void;
  'game:rejected': (reason: string) => void;
}

export type { Vec2 };

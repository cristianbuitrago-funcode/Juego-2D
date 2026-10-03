// Tipos de dominio compartidos entre cliente y servidor.

export type ResourceType = 'gold' | 'wood' | 'stone' | 'food';
export const RESOURCE_TYPES: readonly ResourceType[] = ['gold', 'wood', 'stone', 'food'];
export type Resources = Record<ResourceType, number>;
export type Cost = Partial<Resources>;

export type UnitType = 'gatherer' | 'soldier' | 'archer' | 'tank' | 'scout';
export type BuildingType =
  | 'commandCenter'
  | 'barracks'
  | 'mine'
  | 'lumberMill'
  | 'farm'
  | 'warehouse'
  | 'tower'
  | 'techCenter';
export type TechType = 'weapons' | 'armor' | 'tools';

export type EntityKind = 'unit' | 'building' | 'resource';

/** Prioridad de objetivo al adquirir enemigos automáticamente. */
export type TargetPriority = 'nearest' | 'weakest' | 'units' | 'buildings';

export type UnitStateName =
  | 'idle'
  | 'moving'
  | 'attacking'
  | 'gathering'
  | 'returning'
  | 'building'
  | 'holding'
  | 'retreating';

export type BuildingStateName = 'construction' | 'active' | 'upgrading';

export type GameModeId = 'battle' | 'territory' | 'coop' | 'economy' | 'domination';
export type MapSize = 'small' | 'medium' | 'large';
export type AIDifficulty = 'easy' | 'normal' | 'hard';

export interface Vec2 {
  x: number;
  y: number;
}

/** Información pública de un jugador (todos la ven). */
export interface PlayerPublic {
  id: number;
  name: string;
  color: string;
  team: number;
  isAI: boolean;
  connected: boolean;
  eliminated: boolean;
  /** Puntuación de objetivos (puntos de control, etc.). */
  score: number;
}

/** Información privada: solo la recibe el propio jugador. */
export interface PlayerPrivate {
  resources: Resources;
  storageCap: number;
  pop: number;
  popCap: number;
  tech: Record<TechType, number>;
  gathered: number;
}

export interface QueueItemState {
  u: UnitType;
  /** Progreso 0..1 (solo el primero avanza). */
  p: number;
}

/** Estado de una entidad tal y como viaja por la red (claves cortas para ahorrar ancho de banda). */
export interface EntityState {
  id: number;
  k: EntityKind;
  /** Subtipo: UnitType | BuildingType | ResourceType */
  t: string;
  /** Dueño (id de jugador) o -1 si es neutral. */
  o: number;
  x: number;
  y: number;
  hp: number;
  mhp: number;
  /** Estado (UnitStateName | BuildingStateName). */
  s?: string;
  /** Progreso de construcción/mejora 0..1. */
  p?: number;
  /** Nivel del edificio. */
  l?: number;
  /** Cantidad transportada (recolector) y tipo. */
  c?: number;
  ct?: ResourceType;
  /** Cantidad restante de un nodo de recursos. */
  a?: number;
  /** Ángulo de orientación (radianes). */
  f?: number;
  /** Solo para el dueño: cola de producción, investigación, punto de reunión, prioridad. */
  q?: QueueItemState[];
  rs?: { tech: TechType; p: number };
  rally?: Vec2;
  pr?: TargetPriority;
}

export interface ControlPointState {
  id: number;
  x: number;
  y: number;
  radius: number;
  /** Equipo propietario o -1. */
  owner: number;
  /** Progreso de captura 0..1 del equipo que captura. */
  progress: number;
  capturingTeam: number;
}

export interface MapData {
  width: number;
  height: number;
  /** Terreno por casilla (índice = y * width + x). */
  tiles: number[];
  spawns: Vec2[];
  controlPoints: Vec2[];
  resources: { type: ResourceType; x: number; y: number; amount: number }[];
}

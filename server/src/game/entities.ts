import type {
  BuildingStateName,
  UnitStateName,
  BuildingType,
  ResourceType,
  TargetPriority,
  TechType,
  UnitType,
  Vec2,
} from '@shared/types/game';

// Entidades del servidor (estado completo y autoritativo). El cliente nunca recibe estas
// estructuras directamente: se serializan en SnapshotBuilder filtrando por visibilidad.

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number; attackMove: boolean }
  /** `auto` = adquirido automáticamente (con correa `anchor`); `resume` = destino de ataque-movimiento a retomar. */
  | { type: 'attack'; targetId: number; auto: boolean; anchor?: Vec2; resume?: Vec2 }
  | { type: 'gather'; nodeId: number; resource: ResourceType; phase: 'toNode' | 'gathering' | 'toDropoff' }
  | { type: 'assist'; buildingId: number }
  | { type: 'hold' }
  | { type: 'retreat'; x: number; y: number };

export interface UnitEntity {
  id: number;
  kind: 'unit';
  type: UnitType;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  order: Order;
  /** Estado visible (para animaciones del cliente); lo actualiza UnitSystem. */
  status: UnitStateName;
  path: Vec2[];
  /** Destino para el que se calculó `path` (para saber cuándo recalcular). */
  pathGoal: Vec2 | null;
  repathTimer: number;
  cooldown: number;
  carrying: { type: ResourceType; amount: number } | null;
  priority: TargetPriority;
  facing: number;
  /** Hasta cuándo la unidad queda revelada (al atacar desde un bosque). */
  revealedUntil: number;
  scanTimer: number;
  /** Detección de atascos. */
  stuckTimer: number;
  lastPos: Vec2;
}

export interface QueueItem {
  unit: UnitType;
  elapsed: number;
}

export interface BuildingEntity {
  id: number;
  kind: 'building';
  type: BuildingType;
  owner: number;
  /** Casilla superior izquierda. */
  tx: number;
  ty: number;
  /** Centro (casillas). */
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  level: number;
  state: BuildingStateName;
  /** Progreso de construcción 0..1. */
  progress: number;
  upgradeElapsed: number;
  queue: QueueItem[];
  rally: Vec2 | null;
  research: { tech: TechType; elapsed: number } | null;
  cooldown: number;
  /** Recurso que produce una mina (según yacimiento cercano). */
  producesResource: ResourceType | null;
  /** Recolectores ayudando este tick (se recalcula cada tick). */
  assistCount: number;
}

export interface ResourceEntity {
  id: number;
  kind: 'resource';
  type: ResourceType;
  owner: -1;
  tx: number;
  ty: number;
  x: number;
  y: number;
  amount: number;
  maxAmount: number;
  /** Bloquea el paso (yacimientos de oro y piedra). */
  blocks: boolean;
}

export type Entity = UnitEntity | BuildingEntity | ResourceEntity;

export interface ControlPoint {
  id: number;
  x: number;
  y: number;
  radius: number;
  owner: number;
  progress: number;
  capturingTeam: number;
}

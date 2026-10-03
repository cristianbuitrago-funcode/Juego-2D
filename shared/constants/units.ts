import type { BuildingType, Cost, ResourceType, TechType, UnitType } from '../types/game';

// Catálogo de unidades. Para añadir una unidad nueva: añade su tipo a UnitType y una entrada aquí;
// el servidor, la IA y la interfaz la leen de este catálogo.

export interface UnitDef {
  type: UnitType;
  name: string;
  description: string;
  hp: number;
  damage: number;
  defense: number;
  /** Casillas por segundo. */
  speed: number;
  /** Alcance de ataque en casillas (distancia borde a borde). */
  range: number;
  /** Segundos entre ataques. */
  attackCooldown: number;
  /** Radio de visión en casillas. */
  sight: number;
  /** Radio físico (casillas). */
  radius: number;
  cost: Cost;
  /** Segundos de entrenamiento. */
  trainTime: number;
  pop: number;
  trainedAt: BuildingType;
  /** Nivel mínimo del edificio que entrena. */
  requiresLevel: number;
  /** Edificio adicional requerido (activo). */
  requiresBuilding?: BuildingType;
  ranged: boolean;
  /** Multiplicador de daño contra edificios. */
  buildingBonus: number;
  canGather: boolean;
  /** Recursos por segundo al recolectar. */
  gatherRate?: number;
  carryCapacity?: number;
  /** Las unidades de combate adquieren objetivos automáticamente. */
  autoAcquire: boolean;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  gatherer: {
    type: 'gatherer',
    name: 'Recolector',
    description: 'Obtiene recursos, ayuda a construir y repara edificios.',
    hp: 45,
    damage: 3,
    defense: 0,
    speed: 2.6,
    range: 0.4,
    attackCooldown: 1.3,
    sight: 5,
    radius: 0.28,
    cost: { food: 50 },
    trainTime: 8,
    pop: 1,
    trainedAt: 'commandCenter',
    requiresLevel: 1,
    ranged: false,
    buildingBonus: 0.5,
    canGather: true,
    gatherRate: 1.1,
    carryCapacity: 10,
    autoAcquire: false,
  },
  soldier: {
    type: 'soldier',
    name: 'Soldado',
    description: 'Unidad básica de combate cuerpo a cuerpo.',
    hp: 95,
    damage: 10,
    defense: 2,
    speed: 2.4,
    range: 0.45,
    attackCooldown: 1.0,
    sight: 6,
    radius: 0.32,
    cost: { food: 60, gold: 25 },
    trainTime: 10,
    pop: 1,
    trainedAt: 'barracks',
    requiresLevel: 1,
    ranged: false,
    buildingBonus: 1,
    canGather: false,
    autoAcquire: true,
  },
  archer: {
    type: 'archer',
    name: 'Arquero',
    description: 'Ataca a distancia, pero tiene poca defensa.',
    hp: 55,
    damage: 9,
    defense: 0,
    speed: 2.5,
    range: 5,
    attackCooldown: 1.4,
    sight: 7.5,
    radius: 0.3,
    cost: { food: 45, wood: 55 },
    trainTime: 12,
    pop: 1,
    trainedAt: 'barracks',
    requiresLevel: 2,
    ranged: true,
    buildingBonus: 0.6,
    canGather: false,
    autoAcquire: true,
  },
  tank: {
    type: 'tank',
    name: 'Tanque',
    description: 'Mucha vida y defensa, pero lento. Muy eficaz contra edificios.',
    hp: 340,
    damage: 22,
    defense: 7,
    speed: 1.4,
    range: 0.6,
    attackCooldown: 1.8,
    sight: 5.5,
    radius: 0.45,
    cost: { gold: 120, stone: 80, food: 60 },
    trainTime: 22,
    pop: 3,
    trainedAt: 'barracks',
    requiresLevel: 3,
    requiresBuilding: 'techCenter',
    ranged: false,
    buildingBonus: 1.6,
    canGather: false,
    autoAcquire: true,
  },
  scout: {
    type: 'scout',
    name: 'Explorador',
    description: 'Muy rápido y con gran visión. Ideal para descubrir el mapa.',
    hp: 50,
    damage: 5,
    defense: 0,
    speed: 4.3,
    range: 0.45,
    attackCooldown: 1.0,
    sight: 10,
    radius: 0.28,
    cost: { food: 40, gold: 15 },
    trainTime: 7,
    pop: 1,
    trainedAt: 'barracks',
    requiresLevel: 1,
    ranged: false,
    buildingBonus: 0.5,
    canGather: false,
    autoAcquire: true,
  },
};

export const UNIT_TYPES = Object.keys(UNIT_DEFS) as UnitType[];

export interface TechDef {
  type: TechType;
  name: string;
  description: string;
  maxLevel: number;
  /** Coste por nivel (índice 0 = nivel 1). */
  cost: Cost[];
  /** Segundos de investigación por nivel. */
  time: number[];
  /** Nivel del centro tecnológico requerido por nivel de tecnología. */
  requiresLevel: number[];
}

export const TECH_DEFS: Record<TechType, TechDef> = {
  weapons: {
    type: 'weapons',
    name: 'Forja de armas',
    description: '+15% de daño por nivel para todas las unidades.',
    maxLevel: 2,
    cost: [{ gold: 120, wood: 60 }, { gold: 220, stone: 120 }],
    time: [25, 40],
    requiresLevel: [1, 2],
  },
  armor: {
    type: 'armor',
    name: 'Armaduras',
    description: '+1 de defensa por nivel para todas las unidades.',
    maxLevel: 2,
    cost: [{ gold: 100, stone: 80 }, { gold: 200, stone: 160 }],
    time: [25, 40],
    requiresLevel: [1, 2],
  },
  tools: {
    type: 'tools',
    name: 'Herramientas',
    description: '+25% de recolección y producción por nivel.',
    maxLevel: 2,
    cost: [{ wood: 120, food: 80 }, { wood: 200, gold: 120 }],
    time: [20, 35],
    requiresLevel: [1, 2],
  },
};

export const TECH_TYPES = Object.keys(TECH_DEFS) as TechType[];

export const RESOURCE_NAMES: Record<ResourceType, string> = {
  gold: 'Oro',
  wood: 'Madera',
  stone: 'Piedra',
  food: 'Comida',
};

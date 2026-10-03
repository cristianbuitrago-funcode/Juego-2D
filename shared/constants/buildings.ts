import type { BuildingType, Cost, ResourceType, UnitType } from '../types/game';

// Catálogo de edificios. Para añadir un edificio: añade su tipo a BuildingType y una entrada aquí.

export type PlacementRule = 'any' | 'nearGoldOrStone' | 'nearForest';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  /** Tamaño en casillas (cuadrado). */
  size: number;
  /** Vida a nivel 1; cada nivel adicional suma `hpPerLevel`. */
  hp: number;
  hpPerLevel: number;
  defense: number;
  cost: Cost;
  /** Segundos de construcción. */
  buildTime: number;
  maxLevel: number;
  /** Coste para subir al nivel N+1 (índice 0 = subir a nivel 2). */
  upgradeCost: Cost[];
  upgradeTime: number[];
  sight: number;
  /** Radio de territorio (casillas) que proyecta. */
  territory: number;
  /** Población que aporta por nivel (índice 0 = nivel 1). */
  popProvided?: number[];
  /** Producción pasiva por segundo por nivel. Si resource es 'auto' depende del nodo cercano (mina). */
  production?: { resource: ResourceType | 'auto'; rate: number[] };
  /** Recursos que acepta como punto de entrega. */
  dropoff?: ResourceType[];
  /** Capacidad de almacenamiento extra por nivel. */
  storage?: number[];
  /** Ataque automático (torres). Valores por nivel. */
  attack?: { damage: number[]; range: number[]; cooldown: number };
  trains?: UnitType[];
  /** Permite investigar tecnologías. */
  research?: boolean;
  placement: PlacementRule;
  /** Máximo por jugador (undefined = sin límite). */
  maxCount?: number;
  /** Los jugadores pueden construirlo. */
  buildable: boolean;
  /** Texto de lo que desbloquea cada nivel (para la interfaz). */
  levelInfo: string[];
}

const ALL: ResourceType[] = ['gold', 'wood', 'stone', 'food'];

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  commandCenter: {
    type: 'commandCenter',
    name: 'Centro de mando',
    description: 'Corazón de la base. Si cae, el jugador queda eliminado.',
    size: 3,
    hp: 1500,
    hpPerLevel: 500,
    defense: 4,
    cost: {},
    buildTime: 60,
    maxLevel: 3,
    upgradeCost: [{ gold: 200, stone: 150, wood: 100 }, { gold: 350, stone: 300, wood: 200 }],
    upgradeTime: [35, 50],
    sight: 9,
    territory: 9,
    popProvided: [10, 15, 20],
    production: { resource: 'gold', rate: [0.25, 0.4, 0.6] },
    dropoff: ALL,
    storage: [0, 250, 500],
    trains: ['gatherer'],
    placement: 'any',
    buildable: false,
    levelInfo: ['Entrena recolectores', '+5 población, más oro', '+5 población, más almacenamiento'],
  },
  barracks: {
    type: 'barracks',
    name: 'Cuartel',
    description: 'Entrena unidades militares.',
    size: 2,
    hp: 700,
    hpPerLevel: 250,
    defense: 3,
    cost: { wood: 150, stone: 50 },
    buildTime: 25,
    maxLevel: 3,
    upgradeCost: [{ wood: 150, gold: 100 }, { gold: 200, stone: 150 }],
    upgradeTime: [25, 35],
    sight: 6,
    territory: 4,
    trains: ['soldier', 'scout', 'archer', 'tank'],
    placement: 'any',
    buildable: true,
    levelInfo: ['Soldado y explorador', 'Desbloquea arquero', 'Desbloquea tanque (requiere centro tecnológico)'],
  },
  mine: {
    type: 'mine',
    name: 'Mina',
    description: 'Extrae oro o piedra del yacimiento cercano. Punto de entrega de oro y piedra.',
    size: 2,
    hp: 500,
    hpPerLevel: 150,
    defense: 2,
    cost: { wood: 100 },
    buildTime: 20,
    maxLevel: 3,
    upgradeCost: [{ wood: 100, gold: 60 }, { wood: 160, gold: 120 }],
    upgradeTime: [20, 30],
    sight: 5,
    territory: 3,
    production: { resource: 'auto', rate: [0.35, 0.6, 0.9] },
    dropoff: ['gold', 'stone'],
    placement: 'nearGoldOrStone',
    buildable: true,
    levelInfo: ['Producción básica', 'Mayor producción', 'Producción máxima'],
  },
  lumberMill: {
    type: 'lumberMill',
    name: 'Aserradero',
    description: 'Produce madera del bosque cercano. Punto de entrega de madera.',
    size: 2,
    hp: 500,
    hpPerLevel: 150,
    defense: 2,
    cost: { wood: 80, gold: 20 },
    buildTime: 18,
    maxLevel: 3,
    upgradeCost: [{ wood: 100, gold: 50 }, { wood: 150, gold: 100 }],
    upgradeTime: [20, 30],
    sight: 5,
    territory: 3,
    production: { resource: 'wood', rate: [0.4, 0.7, 1.0] },
    dropoff: ['wood'],
    placement: 'nearForest',
    buildable: true,
    levelInfo: ['Producción básica', 'Mayor producción', 'Producción máxima'],
  },
  farm: {
    type: 'farm',
    name: 'Granja',
    description: 'Produce comida y aumenta la población máxima. Punto de entrega de comida.',
    size: 2,
    hp: 400,
    hpPerLevel: 120,
    defense: 1,
    cost: { wood: 60 },
    buildTime: 15,
    maxLevel: 3,
    upgradeCost: [{ wood: 80, gold: 30 }, { wood: 120, gold: 80 }],
    upgradeTime: [15, 25],
    sight: 4,
    territory: 3,
    popProvided: [5, 7, 10],
    production: { resource: 'food', rate: [0.5, 0.85, 1.25] },
    dropoff: ['food'],
    placement: 'any',
    buildable: true,
    levelInfo: ['+5 población', '+7 población, más comida', '+10 población, comida máxima'],
  },
  warehouse: {
    type: 'warehouse',
    name: 'Almacén',
    description: 'Aumenta la capacidad de almacenamiento. Punto de entrega de todos los recursos.',
    size: 2,
    hp: 600,
    hpPerLevel: 200,
    defense: 2,
    cost: { wood: 120, stone: 40 },
    buildTime: 20,
    maxLevel: 3,
    upgradeCost: [{ wood: 120, stone: 80 }, { wood: 200, stone: 160 }],
    upgradeTime: [20, 30],
    sight: 5,
    territory: 4,
    dropoff: ALL,
    storage: [500, 900, 1400],
    placement: 'any',
    buildable: true,
    levelInfo: ['+500 almacenamiento', '+900 almacenamiento', '+1400 almacenamiento'],
  },
  tower: {
    type: 'tower',
    name: 'Torre defensiva',
    description: 'Ataca automáticamente a los enemigos cercanos.',
    size: 1,
    hp: 450,
    hpPerLevel: 200,
    defense: 4,
    cost: { stone: 100, wood: 40 },
    buildTime: 20,
    maxLevel: 3,
    upgradeCost: [{ stone: 100, gold: 60 }, { stone: 160, gold: 120 }],
    upgradeTime: [20, 30],
    sight: 8,
    territory: 4,
    attack: { damage: [12, 17, 23], range: [5.5, 6, 7], cooldown: 1.5 },
    placement: 'any',
    buildable: true,
    levelInfo: ['Ataque básico', 'Más daño', 'Más daño y alcance'],
  },
  techCenter: {
    type: 'techCenter',
    name: 'Centro tecnológico',
    description: 'Investiga mejoras y desbloquea el tanque.',
    size: 2,
    hp: 650,
    hpPerLevel: 250,
    defense: 3,
    cost: { gold: 150, stone: 120, wood: 100 },
    buildTime: 30,
    maxLevel: 2,
    upgradeCost: [{ gold: 250, stone: 200 }],
    upgradeTime: [40],
    sight: 5,
    territory: 4,
    research: true,
    placement: 'any',
    maxCount: 1,
    buildable: true,
    levelInfo: ['Tecnologías nivel 1, desbloquea tanque', 'Tecnologías nivel 2'],
  },
};

export const BUILDING_TYPES = Object.keys(BUILDING_DEFS) as BuildingType[];

export function buildingMaxHp(type: BuildingType, level: number): number {
  const def = BUILDING_DEFS[type];
  return def.hp + def.hpPerLevel * (level - 1);
}

/** Distancia (casillas) dentro de la que debe haber un yacimiento/bosque para las reglas de colocación. */
export const PLACEMENT_RESOURCE_DISTANCE = 4;

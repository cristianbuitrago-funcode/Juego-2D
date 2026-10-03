// Definición de terrenos. Para añadir un terreno nuevo basta con añadir una entrada al enum y a TERRAIN_DEFS.

export enum Terrain {
  Grass = 0,
  Dirt = 1,
  Road = 2,
  Water = 3,
  Mountain = 4,
  Forest = 5,
  ResourceZone = 6,
  Strategic = 7,
}

export interface TerrainDef {
  name: string;
  /** Multiplicador de velocidad. 0 = intransitable para unidades terrestres. */
  speed: number;
  /** Se puede construir encima. */
  buildable: boolean;
  /** Las unidades en este terreno solo son visibles a corta distancia. */
  hides: boolean;
  color: string;
  minimap: string;
}

export const TERRAIN_DEFS: Record<Terrain, TerrainDef> = {
  [Terrain.Grass]: { name: 'Hierba', speed: 1, buildable: true, hides: false, color: '#5d9b48', minimap: '#5d9b48' },
  [Terrain.Dirt]: { name: 'Tierra', speed: 0.9, buildable: true, hides: false, color: '#a5844f', minimap: '#a5844f' },
  [Terrain.Road]: { name: 'Camino', speed: 1.4, buildable: true, hides: false, color: '#c9b17a', minimap: '#d6c08a' },
  [Terrain.Water]: { name: 'Agua', speed: 0, buildable: false, hides: false, color: '#3a78b5', minimap: '#3a78b5' },
  [Terrain.Mountain]: { name: 'Montaña', speed: 0.35, buildable: false, hides: false, color: '#7d7a76', minimap: '#8a8682' },
  [Terrain.Forest]: { name: 'Bosque', speed: 0.6, buildable: false, hides: true, color: '#2f6b33', minimap: '#2c5e2f' },
  [Terrain.ResourceZone]: { name: 'Zona de recursos', speed: 0.9, buildable: true, hides: false, color: '#8f8a5a', minimap: '#a49c5e' },
  [Terrain.Strategic]: { name: 'Punto estratégico', speed: 1, buildable: false, hides: false, color: '#b9a98a', minimap: '#e6d9a8' },
};

export function terrainDef(t: number): TerrainDef {
  return TERRAIN_DEFS[t as Terrain] ?? TERRAIN_DEFS[Terrain.Grass];
}

export function isPassable(t: number): boolean {
  return terrainDef(t).speed > 0;
}

/** Distancia (en casillas) a la que se detecta una unidad oculta en un bosque. */
export const FOREST_REVEAL_DISTANCE = 2.5;

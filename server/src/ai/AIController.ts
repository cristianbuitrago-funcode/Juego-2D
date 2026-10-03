import { BUILDING_DEFS } from '@shared/constants/buildings';
import { UNIT_DEFS } from '@shared/constants/units';
import type { AIDifficulty, BuildingType, ResourceType, UnitType } from '@shared/types/game';
import type { Command } from '@shared/types/messages';
import { CommandHandler } from '../game/CommandHandler';
import type { BuildingEntity, UnitEntity } from '../game/entities';
import type { GameState } from '../game/GameState';
import { EconomySystem } from '../systems/EconomySystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { VisionSystem } from '../systems/VisionSystem';

interface DifficultyProfile {
  thinkInterval: number;
  econMultiplier: number;
  targetGatherers: number;
  firstWave: number;
  waveSize: number;
  waveGrowth: number;
}

export const AI_PROFILES: Record<AIDifficulty, DifficultyProfile> = {
  easy: { thinkInterval: 1.6, econMultiplier: 0.75, targetGatherers: 5, firstWave: 330, waveSize: 5, waveGrowth: 1 },
  normal: { thinkInterval: 1.0, econMultiplier: 1.0, targetGatherers: 7, firstWave: 240, waveSize: 7, waveGrowth: 2 },
  hard: { thinkInterval: 0.7, econMultiplier: 1.3, targetGatherers: 9, firstWave: 170, waveSize: 9, waveGrowth: 3 },
};

/** Orden de construcción básico de la IA. */
const BUILD_ORDER: BuildingType[] = ['farm', 'barracks', 'lumberMill', 'mine', 'farm', 'tower', 'warehouse', 'farm', 'techCenter', 'barracks', 'tower', 'farm'];

/**
 * IA básica para el modo cooperativo. Usa EXACTAMENTE las mismas órdenes y validaciones
 * que un jugador humano (CommandHandler), así que no puede hacer trampas con los recursos.
 * Simplificación conocida: conoce la posición inicial de las bases enemigas para lanzar oleadas.
 */
export class AIController {
  private timer = 0;
  private waves = 0;
  private nextWaveAt: number;
  private scoutTimer = 0;
  private readonly profile: DifficultyProfile;

  constructor(
    readonly playerId: number,
    difficulty: AIDifficulty,
  ) {
    this.profile = AI_PROFILES[difficulty];
    this.nextWaveAt = this.profile.firstWave;
  }

  get econMultiplier() {
    return this.profile.econMultiplier;
  }

  update(state: GameState, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.profile.thinkInterval;
    const me = state.players.get(this.playerId);
    if (!me || me.eliminated || state.phase !== 'playing') return;
    const cc = state.playerBuildings(this.playerId, 'commandCenter')[0];
    if (!cc) return;
    ResourceSystem.recompute(state);

    const myUnits = state.units.filter((u) => u.owner === this.playerId);
    const gatherers = myUnits.filter((u) => u.type === 'gatherer');
    const army = myUnits.filter((u) => u.type !== 'gatherer' && u.type !== 'scout');

    this.economy(state, cc, gatherers);
    this.build(state, cc, gatherers);
    this.military(state);
    this.upgrades(state);
    this.defend(state, cc, army);
    this.explore(state, myUnits);
    this.attack(state, army);
  }

  private cmd(state: GameState, c: Command) {
    return CommandHandler.handle(state, this.playerId, c);
  }

  private economy(state: GameState, cc: BuildingEntity, gatherers: UnitEntity[]) {
    if (gatherers.length < this.profile.targetGatherers && cc.queue.length < 2) {
      this.cmd(state, { type: 'train', buildingId: cc.id, unit: 'gatherer' });
    }
    const me = state.players.get(this.playerId)!;
    // Asignar recolectores ociosos al recurso más escaso.
    for (const g of gatherers) {
      if (g.order.type !== 'idle') continue;
      const order: ResourceType[] = (['food', 'wood', 'gold', 'stone'] as ResourceType[]).sort((a, b) => me.resources[a] - me.resources[b]);
      for (const r of order) {
        const node = EconomySystem.nearestNode(state, cc.x, cc.y, r, 16);
        if (node) {
          this.cmd(state, { type: 'gather', unitIds: [g.id], targetId: node.id });
          break;
        }
      }
    }
  }

  private build(state: GameState, cc: BuildingEntity, gatherers: UnitEntity[]) {
    const me = state.players.get(this.playerId)!;
    const mine = state.playerBuildings(this.playerId);
    const underConstruction = mine.filter((b) => b.state === 'construction');
    // Ayudar a construir con un recolector.
    for (const b of underConstruction) {
      if (!gatherers.some((g) => g.order.type === 'assist' && g.order.buildingId === b.id) && gatherers.length > 2) {
        this.cmd(state, { type: 'assist', unitIds: [gatherers[0].id], targetId: b.id });
      }
    }
    if (underConstruction.length >= 2) return;

    let next: BuildingType | null = null;
    if (me.popCap - me.pop <= 2 && me.popCap < 100) next = 'farm';
    else {
      const counts = new Map<BuildingType, number>();
      for (const t of BUILD_ORDER) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
        const have = mine.filter((b) => b.type === t).length;
        if (have < (counts.get(t) ?? 0)) {
          next = t;
          break;
        }
      }
    }
    if (!next || !ResourceSystem.canAfford(me, BUILDING_DEFS[next].cost)) return;
    const spot = this.findSpot(state, cc, next);
    if (spot) this.cmd(state, { type: 'build', building: next, tx: spot.x, ty: spot.y });
  }

  private findSpot(state: GameState, cc: BuildingEntity, type: BuildingType): { x: number; y: number } | null {
    const size = BUILDING_DEFS[type].size;
    for (let r = 3; r <= 9; r++) {
      const candidates: { x: number; y: number }[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          candidates.push({ x: Math.floor(cc.x + dx - size / 2), y: Math.floor(cc.y + dy - size / 2) });
        }
      }
      // Orden pseudoaleatorio estable para no amontonar todo en un lado.
      candidates.sort((a, b) => ((a.x * 7 + a.y * 13) % 11) - ((b.x * 7 + b.y * 13) % 11));
      for (const c of candidates) {
        if (CommandHandler.placementError(state, this.playerId, type, c.x, c.y)) continue;
        // Dejar un pasillo libre alrededor.
        if (!this.hasMargin(state, c.x, c.y, size)) continue;
        return c;
      }
    }
    return null;
  }

  private hasMargin(state: GameState, tx: number, ty: number, size: number) {
    for (let y = ty - 1; y <= ty + size; y++)
      for (let x = tx - 1; x <= tx + size; x++) if (state.map.inBounds(x, y) && state.map.occupant[y * state.map.width + x] !== 0) return false;
    return true;
  }

  private military(state: GameState) {
    const me = state.players.get(this.playerId)!;
    for (const b of state.playerBuildings(this.playerId, 'barracks')) {
      if (b.state !== 'active' || b.queue.length >= 2) continue;
      const options: UnitType[] = ['soldier', 'soldier', 'archer', 'tank'];
      const pick = options[(state.tick + b.id) % options.length];
      const available = [pick, 'archer', 'soldier'].find(
        (u) => b.level >= UNIT_DEFS[u as UnitType].requiresLevel && ResourceSystem.canAfford(me, UNIT_DEFS[u as UnitType].cost),
      ) as UnitType | undefined;
      if (available) this.cmd(state, { type: 'train', buildingId: b.id, unit: available });
    }
    // Un explorador al principio.
    const hasScout = state.units.some((u) => u.owner === this.playerId && u.type === 'scout');
    const barracks = state.playerBuildings(this.playerId, 'barracks').find((b) => b.state === 'active');
    if (!hasScout && barracks && state.time > 60 && this.scoutTimer <= 0) {
      this.cmd(state, { type: 'train', buildingId: barracks.id, unit: 'scout' });
      this.scoutTimer = 120;
    }
  }

  private upgrades(state: GameState) {
    if (state.time < 200) return;
    const me = state.players.get(this.playerId)!;
    for (const b of state.playerBuildings(this.playerId)) {
      if (b.state !== 'active' || b.queue.length > 0) continue;
      const def = BUILDING_DEFS[b.type];
      if (b.level >= def.maxLevel || !['barracks', 'farm', 'mine', 'commandCenter'].includes(b.type)) continue;
      const cost = def.upgradeCost[b.level - 1];
      if (ResourceSystem.canAfford(me, cost) && Object.values(me.resources).every((v) => v > 250)) {
        this.cmd(state, { type: 'upgrade', buildingId: b.id });
        return;
      }
    }
    const tc = state.playerBuildings(this.playerId, 'techCenter').find((b) => b.state === 'active' && !b.research);
    if (tc) {
      for (const tech of ['weapons', 'armor', 'tools'] as const) {
        if (this.cmd(state, { type: 'research', buildingId: tc.id, tech }).ok) break;
      }
    }
  }

  private defend(state: GameState, cc: BuildingEntity, army: UnitEntity[]) {
    const team = state.teamOf(this.playerId);
    let threat: UnitEntity | null = null;
    for (const u of state.units) {
      if (!state.areEnemies(this.playerId, u.owner)) continue;
      if (Math.hypot(u.x - cc.x, u.y - cc.y) > 13) continue;
      if (!VisionSystem.sees(state, team, u)) continue;
      threat = u;
      break;
    }
    if (!threat) return;
    const idle = army.filter((u) => u.order.type !== 'attack');
    if (idle.length) this.cmd(state, { type: 'attackMove', unitIds: idle.map((u) => u.id), x: threat.x, y: threat.y });
  }

  private explore(state: GameState, myUnits: UnitEntity[]) {
    this.scoutTimer -= this.profile.thinkInterval;
    for (const s of myUnits.filter((u) => u.type === 'scout' && u.order.type === 'idle')) {
      const x = 2 + ((state.tick * 7919 + s.id * 104729) % (state.map.width - 4));
      const y = 2 + ((state.tick * 6151 + s.id * 7307) % (state.map.height - 4));
      this.cmd(state, { type: 'move', unitIds: [s.id], x, y });
    }
  }

  private attack(state: GameState, army: UnitEntity[]) {
    if (state.time < this.nextWaveAt) return;
    const needed = this.profile.waveSize + this.waves * this.profile.waveGrowth;
    const ready = army.filter((u) => u.order.type === 'idle' || u.order.type === 'hold');
    if (ready.length < needed) return;
    // Objetivo: edificio enemigo visible más cercano o, si no, la base inicial de un enemigo.
    const team = state.teamOf(this.playerId);
    let target: { x: number; y: number } | null = null;
    let bestD = Infinity;
    const from = ready[0];
    for (const b of state.buildings) {
      if (!state.areEnemies(this.playerId, b.owner) || !VisionSystem.sees(state, team, b)) continue;
      const d = Math.hypot(b.x - from.x, b.y - from.y);
      if (d < bestD) {
        bestD = d;
        target = { x: b.x, y: b.y };
      }
    }
    if (!target) {
      for (const p of state.players.values()) {
        if (p.eliminated || !state.areEnemies(this.playerId, p.id)) continue;
        const d = Math.hypot(p.spawn.x - from.x, p.spawn.y - from.y);
        if (d < bestD) {
          bestD = d;
          target = p.spawn;
        }
      }
    }
    if (!target) return;
    this.cmd(state, { type: 'attackMove', unitIds: ready.map((u) => u.id), x: target.x, y: target.y });
    this.waves++;
    this.nextWaveAt = state.time + 120;
    state.emit({ type: 'notify', text: '¡La IA lanza una oleada de ataque!', level: 'warn' });
  }
}

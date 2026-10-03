import { GAME_CONFIG, MAP_SIZES, PLAYER_COLORS } from '@shared/config/gameConfig';
import { GAME_MODES } from '@shared/config/gameModes';
import type { MapData, UnitType } from '@shared/types/game';
import type { Command, GameInit, GameOverInfo, RoomSettings, Snapshot } from '@shared/types/messages';
import { AIController, AI_PROFILES } from '../ai/AIController';
import { SnapshotBuilder } from '../network/SnapshotBuilder';
import { createPlayerState, toPublic } from '../players/PlayerState';
import { CombatSystem } from '../systems/CombatSystem';
import { ControlPointSystem } from '../systems/ControlPointSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { MovementSystem } from '../systems/MovementSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { UnitSystem } from '../systems/UnitSystem';
import { VictorySystem } from '../systems/VictorySystem';
import { VisionSystem } from '../systems/VisionSystem';
import { CommandHandler, type CommandResult } from './CommandHandler';
import { GameState } from './GameState';
import { generateMap } from './MapGenerator';

export interface HumanSeat {
  id: number;
  name: string;
}

/**
 * Una partida en curso. Orquesta los sistemas en orden fijo cada tick (simulación autoritativa).
 */
export class Game {
  readonly state: GameState;
  private readonly ais: AIController[] = [];
  private readonly snapshotters = new Map<number, SnapshotBuilder>();

  constructor(
    readonly roomCode: string,
    readonly settings: RoomSettings,
    humans: HumanSeat[],
    seed = Math.floor(Math.random() * 2 ** 31),
    mapOverride?: MapData,
  ) {
    const mode = GAME_MODES[settings.mode];
    const map = mapOverride ?? generateMap({ size: MAP_SIZES[settings.mapSize], seed, controlPoints: mode.controlPoints });
    this.state = new GameState(map, mode);

    // Plazas: humanos primero; en cooperativo se añaden jugadores IA en el equipo 1.
    const seats: { id: number; name: string; isAI: boolean; team: number }[] = humans.map((h, i) => ({
      id: h.id,
      name: h.name,
      isAI: false,
      team: mode.teams === 'coop' ? 0 : i,
    }));
    if (mode.teams === 'coop') {
      const aiCount = Math.min(map.spawns.length - humans.length, Math.max(1, humans.length));
      const usedIds = new Set(humans.map((h) => h.id));
      let nextId = 0;
      for (let i = 0; i < aiCount; i++) {
        while (usedIds.has(nextId)) nextId++;
        usedIds.add(nextId);
        seats.push({ id: nextId, name: `IA ${i + 1}`, isAI: true, team: 1 });
      }
    }
    // Esquinas: 0 = sup-izq, 1 = inf-der, 2 = sup-der, 3 = inf-izq.
    // En cooperativo los humanos ocupan el lado superior/izquierdo y la IA empieza por la esquina opuesta.
    const humanOrder = mode.teams === 'coop' ? [0, 2, 3, 1] : [0, 1, 2, 3];
    const aiOrder = [1, 3, 2, 0];
    const used = new Set<number>();
    const spawnFor = new Map<number, number>();
    seats.filter((s) => !s.isAI).forEach((s, i) => {
      spawnFor.set(s.id, humanOrder[i]);
      used.add(humanOrder[i]);
    });
    for (const s of seats.filter((x) => x.isAI)) {
      const idx = aiOrder.find((i) => !used.has(i))!;
      used.add(idx);
      spawnFor.set(s.id, idx);
    }

    for (const s of seats) {
      const spawn = map.spawns[spawnFor.get(s.id)!];
      const ai = s.isAI ? new AIController(s.id, settings.aiDifficulty) : null;
      const p = createPlayerState({
        id: s.id,
        name: s.name,
        color: PLAYER_COLORS[s.id % PLAYER_COLORS.length],
        team: s.team,
        isAI: s.isAI,
        spawn,
        econMultiplier: ai ? AI_PROFILES[settings.aiDifficulty].econMultiplier : 1,
      });
      this.state.players.set(p.id, p);
      this.state.initialTeams.add(p.team);
      if (ai) this.ais.push(ai);
      this.spawnBase(p.id, spawn);
      if (!s.isAI) this.snapshotters.set(p.id, new SnapshotBuilder(p.id));
    }
    ResourceSystem.recompute(this.state);
    VisionSystem.update(this.state);
  }

  private spawnBase(playerId: number, spawn: { x: number; y: number }) {
    const st = this.state;
    const cc = st.addBuilding('commandCenter', playerId, Math.floor(spawn.x) - 1, Math.floor(spawn.y) - 1, true);
    let k = 0;
    for (const group of GAME_CONFIG.startUnits) {
      for (let i = 0; i < group.count; i++, k++) {
        const angle = (k / 6) * Math.PI * 2 + 0.4;
        const pos = st.map.nearestWalkable(cc.x + Math.cos(angle) * 2.6, cc.y + Math.sin(angle) * 2.6, 6) ?? { x: cc.x, y: cc.y + 2.5 };
        st.addUnit(group.type as UnitType, playerId, pos.x, pos.y);
      }
    }
  }

  /** Avanza la simulación `dt` segundos. Orden fijo de sistemas. */
  step(dt: number) {
    const st = this.state;
    if (st.phase !== 'playing') return;
    st.time += dt;
    st.tick++;
    for (const b of st.buildings) b.assistCount = 0;
    for (const ai of this.ais) ai.update(st, dt);
    UnitSystem.update(st, dt);
    MovementSystem.separate(st);
    CombatSystem.updateTowers(st, dt);
    ResourceSystem.recompute(st);
    ProductionSystem.update(st, dt);
    EconomySystem.updatePassive(st, dt);
    ControlPointSystem.update(st, dt);
    VictorySystem.update(st, dt);
    VisionSystem.update(st);
  }

  command(playerId: number, cmd: Command): CommandResult {
    return CommandHandler.handle(this.state, playerId, cmd);
  }

  surrender(playerId: number) {
    VictorySystem.surrender(this.state, playerId);
  }

  setConnected(playerId: number, connected: boolean) {
    const p = this.state.players.get(playerId);
    if (!p) return;
    p.connected = connected;
    p.disconnectedAt = connected ? null : this.state.time;
    if (!p.eliminated) {
      this.state.emit({
        type: 'notify',
        text: connected ? `${p.name} se ha reconectado.` : `${p.name} se ha desconectado (${GAME_CONFIG.reconnectGrace}s para volver).`,
        level: connected ? 'info' : 'warn',
      });
    }
  }

  /** Construye los snapshots de todos los humanos y vacía la cola de eventos. */
  flushSnapshots(): Map<number, Snapshot> {
    const out = new Map<number, Snapshot>();
    const events = this.state.events;
    this.state.events = [];
    for (const [id, sb] of this.snapshotters) out.set(id, sb.build(this.state, events));
    return out;
  }

  /** Snapshot completo para un jugador que acaba de (re)conectarse. */
  fullSnapshot(playerId: number): Snapshot | null {
    const sb = this.snapshotters.get(playerId);
    return sb ? sb.build(this.state, [], true) : null;
  }

  initFor(playerId: number): GameInit {
    const st = this.state;
    return {
      roomCode: this.roomCode,
      mode: this.settings.mode,
      you: playerId,
      yourTeam: st.teamOf(playerId),
      players: [...st.players.values()].map(toPublic),
      map: { width: st.map.width, height: st.map.height, tiles: Array.from(st.map.tiles) },
      controlPoints: st.controlPoints.map((c) => ({ ...c })),
      tickRate: GAME_CONFIG.tickRate,
      snapshotRate: GAME_CONFIG.snapshotRate,
    };
  }

  get ended() {
    return this.state.phase === 'ended';
  }

  gameOverInfo(): GameOverInfo {
    const st = this.state;
    const team = st.winner?.team ?? -1;
    return {
      winnerTeam: team,
      winners: [...st.players.values()].filter((p) => p.team === team).map((p) => p.id),
      reason: st.winner?.reason ?? '',
      duration: Math.round(st.time),
      stats: [...st.players.values()].map((p) => ({
        playerId: p.id,
        name: p.name,
        ...p.stats,
        resourcesGathered: Math.floor(p.stats.resourcesGathered),
      })),
    };
  }
}

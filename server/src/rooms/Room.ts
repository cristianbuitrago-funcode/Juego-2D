import { GAME_CONFIG, PLAYER_COLORS } from '@shared/config/gameConfig';
import { GAME_MODES } from '@shared/config/gameModes';
import type { Command, JoinResult, RoomInfo, RoomSettings } from '@shared/types/messages';
import { Game } from '../game/Game';
import { RoomPlayer, type GameSocket } from '../players/RoomPlayer';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Sala multijugador: lobby + partida. Mantiene el bucle de simulación del servidor
 * y envía a cada cliente su snapshot delta filtrado por niebla de guerra.
 */
export class Room {
  settings: RoomSettings = { mode: 'battle', mapSize: 'medium', aiDifficulty: 'normal' };
  players: RoomPlayer[] = [];
  game: Game | null = null;
  private loop: NodeJS.Timeout | null = null;
  private emptySince: number | null = null;

  constructor(
    readonly code: string,
    private readonly onClose: (room: Room) => void,
  ) {}

  get phase(): 'lobby' | 'playing' {
    return this.game ? 'playing' : 'lobby';
  }

  get mode() {
    return GAME_MODES[this.settings.mode];
  }

  info(): RoomInfo {
    return {
      code: this.code,
      phase: this.phase,
      settings: { ...this.settings },
      players: this.players.map((p) => ({
        slot: p.slot,
        name: p.name,
        color: PLAYER_COLORS[p.slot % PLAYER_COLORS.length],
        ready: p.ready,
        isHost: p.isHost,
        connected: p.connected,
      })),
      maxPlayers: this.mode.maxPlayers,
      minPlayers: this.mode.minPlayers,
    };
  }

  broadcastLobby() {
    const info = this.info();
    for (const p of this.players) p.socket?.emit('lobby:state', info);
  }

  // ------------------------------------------------------------------ lobby
  join(socket: GameSocket, name: string): Result<JoinResult> {
    if (this.phase !== 'lobby') return { ok: false, error: 'La partida ya ha comenzado.' };
    if (this.players.length >= this.mode.maxPlayers) return { ok: false, error: 'La sala está llena.' };
    let slot = 0;
    while (this.players.some((p) => p.slot === slot)) slot++;
    const p = new RoomPlayer(slot, name, socket);
    if (this.players.length === 0) p.isHost = true;
    this.players.push(p);
    this.bind(socket, p);
    this.emptySince = null;
    this.broadcastLobby();
    return { ok: true, data: { room: this.info(), slot, token: p.token } };
  }

  rejoin(socket: GameSocket, token: string): Result<JoinResult> {
    const p = this.players.find((x) => x.token === token);
    if (!p) return { ok: false, error: 'No se encontró tu plaza en esta sala.' };
    if (p.socket && p.socket.id !== socket.id && p.socket.connected) p.socket.disconnect(true);
    p.socket = socket;
    this.bind(socket, p);
    this.emptySince = null;
    if (this.game) {
      this.game.setConnected(p.slot, true);
      socket.emit('game:init', this.game.initFor(p.slot));
      const snap = this.game.fullSnapshot(p.slot);
      if (snap) socket.emit('game:snapshot', snap);
    }
    this.broadcastLobby();
    return { ok: true, data: { room: this.info(), slot: p.slot, token: p.token } };
  }

  private bind(socket: GameSocket, p: RoomPlayer) {
    socket.data.roomCode = this.code;
    socket.data.slot = p.slot;
    socket.join(this.code);
  }

  playerFor(socket: GameSocket): RoomPlayer | undefined {
    return this.players.find((p) => p.socket?.id === socket.id);
  }

  setReady(socket: GameSocket, ready: boolean) {
    const p = this.playerFor(socket);
    if (!p || this.phase !== 'lobby') return;
    p.ready = !!ready;
    this.broadcastLobby();
  }

  updateSettings(socket: GameSocket, s: Partial<RoomSettings>) {
    const p = this.playerFor(socket);
    if (!p?.isHost || this.phase !== 'lobby') return;
    const next = { ...this.settings, ...s };
    if (this.players.length > GAME_MODES[next.mode].maxPlayers) {
      p.socket?.emit('game:rejected', `Hay demasiados jugadores para el modo ${GAME_MODES[next.mode].name}.`);
      return;
    }
    this.settings = next;
    // Cambiar ajustes obliga a confirmar de nuevo.
    for (const pl of this.players) if (!pl.isHost) pl.ready = false;
    this.broadcastLobby();
  }

  /** Abandono explícito o desconexión. */
  leave(socket: GameSocket, explicit: boolean) {
    const p = this.playerFor(socket);
    if (!p) return;
    socket.leave(this.code);
    if (this.game) {
      if (explicit) {
        this.game.surrender(p.slot);
        p.socket = null;
      } else {
        this.game.setConnected(p.slot, false);
      }
      if (!this.players.some((x) => x.connected)) this.emptySince = Date.now();
      return;
    }
    this.players = this.players.filter((x) => x !== p);
    if (p.isHost && this.players.length) this.players[0].isHost = true;
    if (!this.players.length) {
      this.close();
      return;
    }
    this.broadcastLobby();
  }

  start(socket: GameSocket): Result<null> {
    const p = this.playerFor(socket);
    if (!p?.isHost) return { ok: false, error: 'Solo el anfitrión puede iniciar la partida.' };
    if (this.phase !== 'lobby') return { ok: false, error: 'La partida ya está en curso.' };
    const mode = this.mode;
    if (this.players.length < mode.minPlayers) return { ok: false, error: `Se necesitan al menos ${mode.minPlayers} jugadores.` };
    if (this.players.length > mode.maxPlayers) return { ok: false, error: `Máximo ${mode.maxPlayers} jugadores en este modo.` };
    if (!this.players.every((x) => x.ready)) return { ok: false, error: 'Todos los jugadores deben estar listos.' };

    this.game = new Game(
      this.code,
      this.settings,
      this.players.map((x) => ({ id: x.slot, name: x.name })),
    );
    for (const pl of this.players) {
      if (!pl.socket) continue;
      pl.socket.emit('game:init', this.game.initFor(pl.slot));
      const snap = this.game.fullSnapshot(pl.slot);
      if (snap) pl.socket.emit('game:snapshot', snap);
    }
    this.broadcastLobby();
    this.startLoop();
    return { ok: true, data: null };
  }

  command(socket: GameSocket, cmd: Command) {
    const p = this.playerFor(socket);
    if (!p || !this.game) return;
    if (!p.limiter.take()) {
      socket.emit('game:rejected', 'Demasiadas órdenes por segundo.');
      return;
    }
    const res = this.game.command(p.slot, cmd);
    if (!res.ok) socket.emit('game:rejected', res.error);
  }

  surrender(socket: GameSocket) {
    const p = this.playerFor(socket);
    if (p && this.game) this.game.surrender(p.slot);
  }

  // ------------------------------------------------------------------ bucle
  private startLoop() {
    const dt = 1 / GAME_CONFIG.tickRate;
    const every = Math.max(1, Math.round(GAME_CONFIG.tickRate / GAME_CONFIG.snapshotRate));
    let tick = 0;
    this.loop = setInterval(() => {
      const game = this.game;
      if (!game) return;
      try {
        game.step(dt);
      } catch (err) {
        console.error(`[sala ${this.code}] error en la simulación`, err);
      }
      tick++;
      if (tick % every === 0 || game.ended) this.sendSnapshots(game);
      if (game.ended) this.finishGame(game);
      else if (this.emptySince && Date.now() - this.emptySince > GAME_CONFIG.reconnectGrace * 1000) this.close();
    }, 1000 / GAME_CONFIG.tickRate);
    // No impide que el proceso termine (el servidor HTTP ya lo mantiene vivo).
    this.loop.unref?.();
  }

  /** Avanza la simulación manualmente (tests). */
  stepForTest(seconds: number) {
    if (!this.game) return;
    const dt = 1 / GAME_CONFIG.tickRate;
    for (let t = 0; t < seconds; t += dt) this.game.step(dt);
  }

  private sendSnapshots(game: Game) {
    const snaps = game.flushSnapshots();
    for (const p of this.players) {
      const s = snaps.get(p.slot);
      if (s && p.socket?.connected) p.socket.emit('game:snapshot', s);
    }
  }

  private finishGame(game: Game) {
    const info = game.gameOverInfo();
    for (const p of this.players) p.socket?.emit('game:over', info);
    this.stopLoop();
    this.game = null;
    // Volver al lobby con los jugadores conectados.
    this.players = this.players.filter((p) => p.connected);
    for (const p of this.players) p.ready = false;
    if (this.players.length && !this.players.some((p) => p.isHost)) this.players[0].isHost = true;
    if (!this.players.length) return this.close();
    this.broadcastLobby();
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  close() {
    this.stopLoop();
    this.game = null;
    this.onClose(this);
  }
}

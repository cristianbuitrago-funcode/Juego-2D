import { randomBytes } from 'node:crypto';
import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types/messages';
import { RateLimiter } from '../network/validation';

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SocketData {
  roomCode?: string;
  slot?: number;
}

/** Jugador humano dentro de una sala (persistente entre partidas y reconexiones). */
export class RoomPlayer {
  readonly token = randomBytes(16).toString('hex');
  socket: GameSocket | null;
  ready = false;
  isHost = false;
  readonly limiter = new RateLimiter();

  constructor(
    readonly slot: number,
    readonly name: string,
    socket: GameSocket,
  ) {
    this.socket = socket;
  }

  get connected() {
    return this.socket !== null && this.socket.connected;
  }
}

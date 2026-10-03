import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  Command,
  JoinResult,
  RoomSettings,
  ServerToClientEvents,
} from '@shared/types/messages';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckRes<T> = { ok: true; data: T } | { ok: false; error: string };

const SESSION_KEY = 'frontera.session';

/** URL del servidor: mismo origen por defecto; configurable para Android/hosting separado. */
function serverUrl(): string | undefined {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  const fromQuery = new URLSearchParams(location.search).get('server') ?? undefined;
  return fromQuery || fromEnv || undefined;
}

/**
 * Cliente de red. Solo envía INTENCIONES (órdenes) y recibe el estado autoritativo del servidor.
 */
export class NetworkClient {
  readonly socket: GameSocket;
  ping = 0;
  private pingTimer: number | undefined;

  constructor() {
    const url = serverUrl();
    const opts = { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 800 };
    this.socket = url ? io(url, opts) : io(opts);
    this.pingTimer = window.setInterval(() => this.measurePing(), 2000);
  }

  get connected() {
    return this.socket.connected;
  }

  private measurePing() {
    if (!this.socket.connected) return;
    const t = performance.now();
    this.socket.emit('net:ping', t, () => {
      this.ping = Math.round(performance.now() - t);
    });
  }

  private remember(code: string, res: JoinResult) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, token: res.token }));
    } catch {
      /* almacenamiento no disponible */
    }
  }

  savedSession(): { code: string; token: string } | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  forgetSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* nada */
    }
  }

  private call<T>(fn: (ack: (r: AckRes<T>) => void) => void, timeoutMs = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El servidor no responde.')), timeoutMs);
      fn((r) => {
        clearTimeout(timer);
        if (r.ok) resolve(r.data);
        else reject(new Error(r.error));
      });
    });
  }

  async createRoom(name: string, settings: Partial<RoomSettings>): Promise<JoinResult> {
    const res = await this.call<JoinResult>((ack) => this.socket.emit('lobby:create', { name, settings }, ack));
    this.remember(res.room.code, res);
    return res;
  }

  async joinRoom(name: string, code: string): Promise<JoinResult> {
    const res = await this.call<JoinResult>((ack) => this.socket.emit('lobby:join', { name, code }, ack));
    this.remember(res.room.code, res);
    return res;
  }

  async rejoin(code: string, token: string): Promise<JoinResult> {
    return this.call<JoinResult>((ack) => this.socket.emit('lobby:rejoin', { code, token }, ack));
  }

  setReady(ready: boolean) {
    this.socket.emit('lobby:ready', ready);
  }

  updateSettings(s: Partial<RoomSettings>) {
    this.socket.emit('lobby:settings', s);
  }

  start(): Promise<null> {
    return this.call<null>((ack) => this.socket.emit('lobby:start', ack));
  }

  leave() {
    this.socket.emit('lobby:leave');
    this.forgetSession();
  }

  command(cmd: Command) {
    this.socket.emit('game:command', cmd);
  }

  surrender() {
    this.socket.emit('game:surrender');
  }

  dispose() {
    window.clearInterval(this.pingTimer);
    this.socket.disconnect();
  }
}

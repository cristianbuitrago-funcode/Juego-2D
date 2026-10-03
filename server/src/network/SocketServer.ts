import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types/messages';
import type { GameSocket, SocketData } from '../players/RoomPlayer';
import type { RoomManager } from '../rooms/RoomManager';
import { sanitizeCode, sanitizeName, sanitizeSettings, validateCommand } from './validation';

/**
 * Capa de red: Socket.IO sobre WebSocket. Traduce mensajes a llamadas de Room
 * después de validarlos. Nunca confía en datos del cliente.
 */
export function createSocketServer(http: HttpServer, rooms: RoomManager, corsOrigins: string[]) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(http, {
    cors: corsOrigins.length ? { origin: corsOrigins } : undefined,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10000,
    pingTimeout: 8000,
  });

  io.on('connection', (socket: GameSocket) => {
    const room = () => rooms.get(socket.data.roomCode);
    const safeAck = (ack: unknown) => (typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {});

    socket.on('lobby:create', (payload, ack) => {
      const reply = safeAck(ack);
      const name = sanitizeName(payload?.name);
      if (!name) return reply({ ok: false, error: 'Nombre no válido.' });
      room()?.leave(socket, true);
      const r = rooms.create();
      r.settings = { ...r.settings, ...sanitizeSettings(payload?.settings) };
      reply(r.join(socket, name));
    });

    socket.on('lobby:join', (payload, ack) => {
      const reply = safeAck(ack);
      const name = sanitizeName(payload?.name);
      const code = sanitizeCode(payload?.code);
      if (!name) return reply({ ok: false, error: 'Nombre no válido.' });
      if (!code) return reply({ ok: false, error: 'Código no válido.' });
      const r = rooms.get(code);
      if (!r) return reply({ ok: false, error: 'No existe ninguna sala con ese código.' });
      if (room() && room() !== r) room()!.leave(socket, true);
      reply(r.join(socket, name));
    });

    socket.on('lobby:rejoin', (payload, ack) => {
      const reply = safeAck(ack);
      const code = sanitizeCode(payload?.code);
      const token = typeof payload?.token === 'string' ? payload.token : '';
      const r = rooms.get(code ?? undefined);
      if (!r || !token) return reply({ ok: false, error: 'La sala ya no existe.' });
      reply(r.rejoin(socket, token));
    });

    socket.on('lobby:ready', (ready) => room()?.setReady(socket, ready === true));
    socket.on('lobby:settings', (s) => room()?.updateSettings(socket, sanitizeSettings(s)));
    socket.on('lobby:start', (ack) => {
      const reply = safeAck(ack);
      const r = room();
      if (!r) return reply({ ok: false, error: 'No estás en ninguna sala.' });
      reply(r.start(socket));
    });
    socket.on('lobby:leave', () => {
      room()?.leave(socket, true);
      socket.data.roomCode = undefined;
    });

    socket.on('game:command', (raw) => {
      const cmd = validateCommand(raw);
      if (!cmd) {
        socket.emit('game:rejected', 'Orden mal formada.');
        return;
      }
      room()?.command(socket, cmd);
    });
    socket.on('game:surrender', () => room()?.surrender(socket));

    socket.on('net:ping', (t, ack) => {
      if (typeof ack === 'function') ack(typeof t === 'number' ? t : 0);
    });

    socket.on('disconnect', () => room()?.leave(socket, false));
  });

  return io;
}

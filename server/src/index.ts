import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSocketServer } from './network/SocketServer';
import { RoomManager } from './rooms/RoomManager';

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
const http = createServer(app);
const rooms = new RoomManager();
createSocketServer(http, rooms, CORS_ORIGINS);

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
});

// En producción el propio servidor sirve el cliente compilado (dist/client).
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = [path.resolve(here, '../client'), path.resolve(here, '../../dist/client')].find((d) => existsSync(path.join(d, 'index.html')));
if (clientDir) {
  app.use(express.static(clientDir));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('Servidor de juego activo. En desarrollo abre el cliente de Vite (http://localhost:5173).');
  });
}

http.listen(PORT, () => {
  console.log(`[frontera] servidor escuchando en http://localhost:${PORT}`);
});

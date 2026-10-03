import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import { createSocketServer } from '../server/src/network/SocketServer';
import { RoomManager } from '../server/src/rooms/RoomManager';
import type { ClientToServerEvents, GameInit, GameOverInfo, JoinResult, RoomInfo, ServerToClientEvents, Snapshot } from '../shared/types/messages';
import type { EntityState } from '../shared/types/game';

type C = Socket<ServerToClientEvents, ClientToServerEvents>;
let http: Server;
let url = '';
const rooms = new RoomManager();

before(async () => {
  http = createServer();
  createSocketServer(http, rooms, []);
  await new Promise<void>((r) => http.listen(0, r));
  url = `http://localhost:${(http.address() as AddressInfo).port}`;
});
after(() => {
  http.closeAllConnections();
  http.close();
});

function connect(): Promise<C> {
  return new Promise((resolve) => {
    const s: C = ioc(url, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
  });
}
function ack<T>(fn: (cb: (r: { ok: boolean; data?: T; error?: string }) => void) => void): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((r) => fn(r));
}
function once<T>(s: C, ev: keyof ServerToClientEvents, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando ${ev}`)), timeout);
    s.once(ev, ((data: T) => {
      clearTimeout(t);
      resolve(data);
    }) as never);
  });
}
/** Mantiene una vista acumulada del estado a partir de los deltas. */
function track(s: C) {
  const view = { ents: new Map<number, EntityState>(), snaps: 0, me: null as Snapshot['me'] | null, rejected: [] as string[] };
  s.on('game:snapshot', (snap) => {
    view.snaps++;
    if (snap.full) view.ents.clear();
    for (const e of snap.ents) view.ents.set(e.id, e);
    for (const id of snap.rm) view.ents.delete(id);
    if (snap.me) view.me = snap.me;
  });
  s.on('game:rejected', (r) => view.rejected.push(r));
  return view;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('lobby → partida → sincronización → seguridad → reconexión → fin', async () => {
  const a = await connect();
  const b = await connect();

  // Lobby
  const created = await ack<JoinResult>((cb) => a.emit('lobby:create', { name: 'Ana' }, cb as never));
  assert.ok(created.ok);
  const code = created.data!.room.code;
  assert.equal((await ack((cb) => b.emit('lobby:join', { name: 'Beto', code: 'ZZZZZ' }, cb as never))).ok, false);
  const joined = await ack<JoinResult>((cb) => b.emit('lobby:join', { name: 'Beto', code }, cb as never));
  assert.ok(joined.ok);
  const tokenB = joined.data!.token;

  // No se puede empezar sin estar todos listos ni si no eres anfitrión.
  assert.equal((await ack((cb) => a.emit('lobby:start', cb as never))).ok, false);
  b.emit('lobby:ready', true);
  a.emit('lobby:ready', true);
  await wait(100);
  assert.equal((await ack((cb) => b.emit('lobby:start', cb as never))).ok, false);

  const va = track(a);
  const vb = track(b);
  const initA = once<GameInit>(a, 'game:init');
  const initB = once<GameInit>(b, 'game:init');
  assert.ok((await ack((cb) => a.emit('lobby:start', cb as never))).ok);
  const [ia, ib] = await Promise.all([initA, initB]);
  assert.notEqual(ia.you, ib.you);
  assert.equal(ia.map.tiles.length, ia.map.width * ia.map.height);
  await wait(400);
  assert.ok(va.snaps > 0 && vb.snaps > 0);

  // Cada cliente solo ve lo suyo al inicio (niebla de guerra en el servidor).
  assert.ok([...va.ents.values()].every((e) => e.o === ia.you || e.o === -1));
  const myUnitA = [...va.ents.values()].find((e) => e.k === 'unit' && e.o === ia.you && e.t === 'soldier')!;
  const unitB = [...vb.ents.values()].find((e) => e.k === 'unit' && e.o === ib.you)!;

  // Movimiento sincronizado.
  const start = { x: myUnitA.x, y: myUnitA.y };
  a.emit('game:command', { type: 'move', unitIds: [myUnitA.id], x: start.x + 4, y: start.y + 1 });
  await wait(1500);
  const moved = va.ents.get(myUnitA.id)!;
  assert.ok(Math.hypot(moved.x - start.x, moved.y - start.y) > 1.5, 'la unidad debe moverse según el servidor');

  // Trampas: mover unidad ajena, órdenes mal formadas, recursos falsos, construir fuera.
  const bPos = { x: unitB.x, y: unitB.y };
  a.emit('game:command', { type: 'move', unitIds: [unitB.id], x: 1, y: 1 });
  a.emit('game:command', { type: 'train', buildingId: 'x', unit: 'tank' } as never);
  a.emit('game:command', { type: 'giveResources', amount: 99999 } as never);
  a.emit('game:command', { type: 'build', building: 'commandCenter', tx: 10, ty: 10 });
  await wait(600);
  const bNow = vb.ents.get(unitB.id)!;
  assert.ok(Math.hypot(bNow.x - bPos.x, bNow.y - bPos.y) < 1.5, 'no se pueden mover unidades ajenas');
  assert.ok(va.rejected.length >= 3, `rechazos: ${va.rejected.join(' | ')}`);
  assert.equal(va.me!.resources.gold < 1000, true);

  // Desconexión y reconexión con token.
  b.disconnect();
  await wait(300);
  const b2 = await connect();
  const vb2 = track(b2);
  const reinit = once<GameInit>(b2, 'game:init');
  const rj = await ack<JoinResult>((cb) => b2.emit('lobby:rejoin', { code, token: tokenB }, cb as never));
  assert.ok(rj.ok);
  const ri = await reinit;
  assert.equal(ri.you, ib.you);
  await wait(300);
  assert.ok(vb2.ents.size > 0, 'tras reconectar recibe el estado completo');

  // Rendición → fin de partida para ambos y vuelta al lobby.
  const overA = once<GameOverInfo>(a, 'game:over');
  const overB = once<GameOverInfo>(b2, 'game:over');
  const lobbyA = once<RoomInfo>(a, 'lobby:state');
  b2.emit('game:surrender');
  const [oa, ob] = await Promise.all([overA, overB]);
  assert.deepEqual(oa.winners, [ia.you]);
  assert.deepEqual(ob.winners, [ia.you]);
  assert.equal((await lobbyA).phase, 'lobby');

  a.disconnect();
  b2.disconnect();
});

test('límite de órdenes por segundo', async () => {
  const a = await connect();
  const b = await connect();
  const created = await ack<JoinResult>((cb) => a.emit('lobby:create', { name: 'A' }, cb as never));
  await ack((cb) => b.emit('lobby:join', { name: 'B', code: created.data!.room.code }, cb as never));
  a.emit('lobby:ready', true);
  b.emit('lobby:ready', true);
  await wait(50);
  const init = once<GameInit>(a, 'game:init');
  await ack((cb) => a.emit('lobby:start', cb as never));
  await init;
  const v = track(a);
  for (let i = 0; i < 200; i++) a.emit('game:command', { type: 'stop', unitIds: [1] });
  await wait(400);
  assert.ok(v.rejected.some((r) => r.includes('Demasiadas')), 'debe limitar el spam de órdenes');
  a.disconnect();
  b.disconnect();
});

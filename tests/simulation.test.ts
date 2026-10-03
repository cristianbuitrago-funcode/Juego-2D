import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/src/game/Game';
import type { UnitEntity } from '../server/src/game/entities';
import { GAME_CONFIG } from '../shared/config/gameConfig';

const DT = 1 / GAME_CONFIG.tickRate;
const run = (g: Game, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) g.step(DT);
};
const newGame = (mode: 'battle' | 'territory' | 'coop' = 'battle', humans = 2) =>
  new Game('TEST1', { mode, mapSize: 'small', aiDifficulty: 'normal' }, Array.from({ length: humans }, (_, i) => ({ id: i, name: `J${i}` })), 1234);

const unitsOf = (g: Game, owner: number, type?: string) =>
  g.state.units.filter((u) => u.owner === owner && (!type || u.type === type));

test('la partida arranca con base, recursos y unidades para cada jugador', () => {
  const g = newGame();
  for (const id of [0, 1]) {
    assert.equal(g.state.playerBuildings(id, 'commandCenter').length, 1);
    assert.equal(unitsOf(g, id).length, 5);
    assert.deepEqual(g.state.players.get(id)!.resources, GAME_CONFIG.startResources);
  }
  run(g, 5);
  assert.equal(g.state.phase, 'playing');
});

test('movimiento: el servidor calcula la ruta y la unidad llega', () => {
  const g = newGame();
  const s = unitsOf(g, 0, 'soldier')[0];
  const target = { x: s.x + 6, y: s.y + 6 };
  const near = g.state.map.nearestWalkable(target.x, target.y)!;
  assert.deepEqual(g.command(0, { type: 'move', unitIds: [s.id], x: near.x, y: near.y }), { ok: true });
  run(g, 10);
  assert.ok(Math.hypot(s.x - near.x, s.y - near.y) < 1.2, `posición ${s.x},${s.y}`);
});

test('seguridad: no se pueden mover unidades ajenas ni construir fuera del territorio', () => {
  const g = newGame();
  const enemy = unitsOf(g, 1)[0];
  const before = { x: enemy.x, y: enemy.y };
  assert.equal(g.command(0, { type: 'move', unitIds: [enemy.id], x: 1, y: 1 }).ok, false);
  run(g, 2);
  assert.ok(Math.hypot(enemy.x - before.x, enemy.y - before.y) < 1.5);
  const cc1 = g.state.playerBuildings(1, 'commandCenter')[0];
  const r = g.command(0, { type: 'build', building: 'farm', tx: cc1.tx + 4, ty: cc1.ty });
  assert.equal(r.ok, false);
});

test('recursos: el coste se valida y se cobra en el servidor', () => {
  const g = newGame();
  const p = g.state.players.get(0)!;
  const cc = g.state.playerBuildings(0, 'commandCenter')[0];
  const res = g.command(0, { type: 'train', buildingId: cc.id, unit: 'gatherer' });
  assert.ok(res.ok);
  assert.equal(p.resources.food, GAME_CONFIG.startResources.food - 50);
  p.resources.food = 0;
  assert.equal(g.command(0, { type: 'train', buildingId: cc.id, unit: 'gatherer' }).ok, false);
  // No se puede entrenar un tanque en el centro de mando.
  assert.equal(g.command(0, { type: 'train', buildingId: cc.id, unit: 'tank' }).ok, false);
  run(g, 9);
  assert.equal(unitsOf(g, 0, 'gatherer').length, 4);
});

test('recolección: los recolectores traen recursos al centro de mando', () => {
  const g = newGame();
  const p = g.state.players.get(0)!;
  const cc = g.state.playerBuildings(0, 'commandCenter')[0];
  const gold = [...g.state.entities.values()]
    .filter((e) => e.kind === 'resource' && e.type === 'gold')
    .sort((a, b) => Math.hypot(a.x - cc.x, a.y - cc.y) - Math.hypot(b.x - cc.x, b.y - cc.y))[0];
  const gs = unitsOf(g, 0, 'gatherer');
  assert.ok(g.command(0, { type: 'gather', unitIds: gs.map((u) => u.id), targetId: gold.id }).ok);
  const before = p.stats.resourcesGathered;
  run(g, 40);
  assert.ok(p.stats.resourcesGathered - before > 30, `recolectado ${p.stats.resourcesGathered - before}`);
});

test('construcción dentro del territorio y progreso hasta completarse', () => {
  const g = newGame();
  const cc = g.state.playerBuildings(0, 'commandCenter')[0];
  let built = false;
  for (let dy = -5; dy <= 5 && !built; dy++) {
    for (let dx = -5; dx <= 5 && !built; dx++) {
      const r = g.command(0, { type: 'build', building: 'farm', tx: cc.tx + dx, ty: cc.ty + dy });
      if (r.ok) built = true;
    }
  }
  assert.ok(built, 'debería encontrar sitio para una granja');
  const farm = g.state.playerBuildings(0, 'farm')[0];
  assert.equal(farm.state, 'construction');
  run(g, 16);
  assert.equal(farm.state, 'active');
});

test('combate: ataque con alcance, daño, muerte y victoria por destrucción de base', () => {
  const g = newGame();
  const st = g.state;
  const cc1 = st.playerBuildings(1, 'commandCenter')[0];
  // Ejército de prueba junto a la base enemiga.
  const army: UnitEntity[] = [];
  for (let i = 0; i < 8; i++) {
    const p = st.map.nearestWalkable(cc1.x + 3 + (i % 3) * 0.6, cc1.y + 3 + Math.floor(i / 3) * 0.6)!;
    army.push(st.addUnit('tank', 0, p.x, p.y));
  }
  run(g, 0.2);
  // El objetivo debe ser visible para poder atacarlo.
  assert.ok(g.command(0, { type: 'attack', unitIds: army.map((u) => u.id), targetId: cc1.id }).ok);
  const hp0 = cc1.hp;
  run(g, 5);
  assert.ok(cc1.hp < hp0, 'el centro de mando debe recibir daño');
  run(g, 120);
  assert.equal(st.phase, 'ended');
  assert.equal(st.winner?.team, st.players.get(0)!.team);
  assert.ok(st.players.get(1)!.eliminated);
});

test('niebla de guerra: el snapshot no incluye unidades enemigas lejanas', () => {
  const g = newGame();
  const snaps = g.flushSnapshots();
  const s0 = snaps.get(0)!;
  const enemyIds = new Set(unitsOf(g, 1).map((u) => u.id));
  assert.ok(s0.ents.length > 0);
  assert.ok(!s0.ents.some((e) => enemyIds.has(e.id)), 'no debe ver unidades enemigas al inicio');
  // El delta siguiente sin cambios no reenvía entidades quietas.
  const again = g.flushSnapshots().get(0)!;
  assert.ok(again.ents.length < s0.ents.length);
});

test('cooperativo: se crea la IA y juega sola sin errores', () => {
  const g = newGame('coop', 1);
  const ai = [...g.state.players.values()].find((p) => p.isAI)!;
  assert.ok(ai);
  assert.notEqual(ai.team, g.state.players.get(0)!.team);
  run(g, 240);
  const aiBuildings = g.state.playerBuildings(ai.id);
  assert.ok(aiBuildings.length >= 3, `la IA debería construir (tiene ${aiBuildings.length})`);
  assert.ok(unitsOf(g, ai.id).length >= 6, 'la IA debería crear unidades');
});

test('control territorial: capturar un punto otorga puntuación', () => {
  const g = newGame('territory');
  const st = g.state;
  const cp = st.controlPoints[0];
  const p = st.map.nearestWalkable(cp.x, cp.y)!;
  st.addUnit('soldier', 0, p.x, p.y);
  run(g, 12);
  assert.equal(cp.owner, st.players.get(0)!.team);
  assert.ok(st.players.get(0)!.score > 1);
});

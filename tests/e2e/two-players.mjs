// Prueba E2E con dos navegadores reales conectados al mismo servidor.
// Uso: npm run build && npm start (en otra terminal) && node tests/e2e/two-players.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPlayer(name, viewport = { width: 1366, height: 768 }, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(URL);
  await page.fill('input[placeholder="Tu nombre"]', name);
  return page;
}

const host = await newPlayer('Ana');
await host.click('button:has-text("Crear partida")');
await host.waitForSelector('.room-code');
const code = (await host.textContent('.room-code')).trim();
console.log('Sala creada:', code);

const guest = await newPlayer('Beto', { width: 900, height: 700 });
await guest.fill('.code-input', code);
await guest.click('button:has-text("Unirse")');
await guest.waitForSelector('.room-code');
await host.waitForSelector('text=Beto');
await host.screenshot({ path: `${OUT}/01-lobby.png` });

await guest.click('text=¡Estoy listo!');
await host.click('text=¡Estoy listo!');
await host.waitForTimeout(300);
await host.click('text=Comenzar partida');
await host.waitForSelector('#hud:not(.hidden) .topbar');
await guest.waitForSelector('#hud:not(.hidden) .topbar');
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/02-game-host.png` });
await guest.screenshot({ path: `${OUT}/03-game-guest.png` });

// Selección por área de las unidades iniciales del anfitrión (alrededor del centro de la pantalla).
await host.mouse.move(230, 220);
await host.mouse.down();
await host.mouse.move(470, 480, { steps: 8 });
await host.mouse.up();
await host.waitForTimeout(400);
const selected = await host.textContent('.selection');
console.log('Selección:', selected?.slice(0, 80));
await host.screenshot({ path: `${OUT}/04-selection.png` });

// Orden de movimiento con clic derecho.
await host.mouse.click(560, 470, { button: 'right' });
await host.waitForTimeout(2500);
await host.screenshot({ path: `${OUT}/05-moved.png` });

// Construir una granja desde el menú.
await host.keyboard.press('Escape');
await host.waitForTimeout(200);
await host.keyboard.press('Escape');
await host.click('.overlay >> text=Continuar').catch(() => {});
await host.mouse.click(683, 500); // deseleccionar
await host.click('.actions button:has-text("Granja")');
// Probar varias posiciones hasta que sea válida
let placed = false;
for (const [x, y] of [[560, 260], [800, 250], [560, 480], [820, 480], [500, 380]]) {
  await host.mouse.move(x, y);
  await host.waitForTimeout(120);
  await host.mouse.click(x, y);
  await host.waitForTimeout(300);
  if (!(await host.locator('.actions .btn.on').count())) {
    placed = true;
    break;
  }
}
console.log('Granja colocada:', placed);
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/06-build.png` });

const res = await host.textContent('.resources');
console.log('Recursos anfitrión:', res);
console.log('Errores de consola:', errors.length ? errors : 'ninguno');
await browser.close();
process.exit(errors.length ? 1 : 0);

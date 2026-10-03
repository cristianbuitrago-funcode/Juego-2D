// Prueba E2E táctil (móvil) en modo cooperativo contra la IA.
// Uso: npm run build && npm start (en otra terminal) && node tests/e2e/mobile-coop.mjs [url]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 915, height: 412 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL);
await page.fill('input[placeholder="Tu nombre"]', 'Movil');
await page.selectOption('.box select', 'coop');
await page.tap('button:has-text("Crear partida")');
await page.waitForSelector('.room-code');
await page.tap('text=¡Estoy listo!');
await page.waitForTimeout(300);
await page.tap('text=Comenzar partida');
await page.waitForSelector('#hud:not(.hidden) .topbar');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/10-mobile-game.png` });

// Botón "Ejército" de la barra táctil y toque en el terreno para mover.
await page.tap('.touch-bar button:has-text("Ejército")');
await page.waitForTimeout(300);
const sel = await page.textContent('.selection');
console.log('Selección táctil:', sel?.slice(0, 60));
await page.touchscreen.tap(600, 150);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/11-mobile-move.png` });

// Menú de pausa → rendirse → pantalla de derrota.
await page.tap('.topbar button[title^="Menú"]');
await page.tap('text=Rendirse');
await page.tap('button:has-text("Sí")');
await page.waitForSelector('.end-overlay', { timeout: 5000 });
await page.screenshot({ path: `${OUT}/12-mobile-defeat.png` });
await page.tap('text=Volver a la sala');
await page.waitForSelector('.room-code');
console.log('De vuelta en la sala:', await page.textContent('.room-code'));
console.log('Errores de consola:', errors.length ? errors : 'ninguno');
await browser.close();
process.exit(errors.length ? 1 : 0);

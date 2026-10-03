import { BUILDING_DEFS, PLACEMENT_RESOURCE_DISTANCE } from '@shared/constants/buildings';
import { Terrain, terrainDef } from '@shared/constants/terrain';
import { UNIT_DEFS } from '@shared/constants/units';
import type { BuildingType, UnitType } from '@shared/types/game';
import type { Command } from '@shared/types/messages';
import { distToRect } from '@shared/utils/math';
import { audio } from '../assets/AudioManager';
import type { Effects } from '../components/Effects';
import type { Camera } from './Camera';
import type { ClientEntity, ClientWorld } from './ClientWorld';
import type { Selection } from './Selection';
import { settings } from './Settings';

export interface InputHost {
  send(cmd: Command): void;
  togglePause(): void;
  isPaused(): boolean;
  notify(text: string, level?: 'info' | 'warn' | 'error'): void;
  /** Posición de la última alerta (para Espacio). */
  lastAlert(): { x: number; y: number } | null;
}

type CommandMode = 'attack' | 'move' | null;

const EDGE = 14;
const CAMERA_SPEED = 900;
const LONG_PRESS_MS = 420;
const TAP_SLOP = 12;

/**
 * Entrada de ratón, teclado y táctil → selección, cámara y órdenes.
 * Las órdenes se envían al servidor, que es quien las valida y ejecuta.
 */
export class InputController {
  placement: BuildingType | null = null;
  placementTile: { tx: number; ty: number } | null = null;
  commandMode: CommandMode = null;
  selectionBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  hoverId: number | null = null;
  /** Selección múltiple en táctil (botón del HUD). */
  touchMultiSelect = false;

  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private boxStart: { x: number; y: number } | null = null;
  private panDrag: { x: number; y: number } | null = null;
  private lastClick = { time: 0, id: -1 };
  private touches = new Map<number, { x: number; y: number; startX: number; startY: number; t: number }>();
  private touchMode: 'none' | 'tap' | 'pan' | 'box' | 'pinch' = 'none';
  private longPressTimer: number | undefined;
  private pinch: { dist: number; mx: number; my: number } | null = null;
  private lastGroupKey = { n: -1, time: 0 };
  private disposers: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: ClientWorld,
    private readonly camera: Camera,
    private readonly sel: Selection,
    private readonly fx: Effects,
    private readonly host: InputHost,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on(canvas, 'pointerdown', (e) => this.onPointerDown(e));
    on(window, 'pointermove', (e) => this.onPointerMove(e));
    on(window, 'pointerup', (e) => this.onPointerUp(e));
    on(window, 'pointercancel', (e) => this.onPointerUp(e));
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(document.documentElement, 'mouseleave', () => (this.mouse.inside = false));
  }

  dispose() {
    for (const d of this.disposers) d();
    window.clearTimeout(this.longPressTimer);
  }

  // ------------------------------------------------------------------ actualización por fotograma
  update(dt: number) {
    if (this.host.isPaused()) return;
    let dx = 0;
    let dy = 0;
    const unitsSelected = this.sel.myUnits().length > 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
    if ((this.keys.has('KeyA') && !unitsSelected) || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (settings.edgeScroll && this.mouse.inside && !this.boxStart && !this.panDrag) {
      if (this.mouse.x <= EDGE) dx -= 1;
      if (this.mouse.x >= window.innerWidth - EDGE) dx += 1;
      if (this.mouse.y <= EDGE) dy -= 1;
      if (this.mouse.y >= window.innerHeight - EDGE) dy += 1;
    }
    if (dx || dy) this.camera.pan(dx * CAMERA_SPEED * settings.cameraSpeed * dt, dy * CAMERA_SPEED * settings.cameraSpeed * dt);
    if (this.placement && this.mouse.inside) this.updatePlacementTile(this.mouse.x, this.mouse.y);
  }

  // ------------------------------------------------------------------ ratón
  private onPointerDown(e: PointerEvent) {
    audio.unlock();
    if (this.host.isPaused()) return;
    if (e.pointerType === 'touch') return this.onTouchDown(e);
    this.mouse = { x: e.clientX, y: e.clientY, inside: true };
    const tile = this.camera.screenToTile(e.clientX, e.clientY);
    if (e.button === 1) {
      e.preventDefault();
      this.panDrag = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 2) {
      if (this.placement || this.commandMode) {
        this.cancelModes();
        return;
      }
      this.issueAt(tile.x, tile.y, this.world.entityAt(tile.x, tile.y, 0.15), null);
      return;
    }
    if (e.button !== 0) return;
    if (this.placement) {
      this.placeBuilding(e.shiftKey);
      return;
    }
    if (this.commandMode) {
      this.issueAt(tile.x, tile.y, this.world.entityAt(tile.x, tile.y, 0.15), this.commandMode);
      if (!e.shiftKey) this.commandMode = null;
      return;
    }
    this.boxStart = { x: e.clientX, y: e.clientY };
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return this.onTouchMove(e);
    this.mouse = { x: e.clientX, y: e.clientY, inside: true };
    if (this.panDrag) {
      this.camera.pan(this.panDrag.x - e.clientX, this.panDrag.y - e.clientY);
      this.panDrag = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.boxStart) {
      const moved = Math.hypot(e.clientX - this.boxStart.x, e.clientY - this.boxStart.y) > 6;
      if (moved || this.selectionBox) this.selectionBox = { x0: this.boxStart.x, y0: this.boxStart.y, x1: e.clientX, y1: e.clientY };
    }
    if (e.target === this.canvas) {
      const t = this.camera.screenToTile(e.clientX, e.clientY);
      this.hoverId = this.world.entityAt(t.x, t.y, 0.1)?.id ?? null;
      this.canvas.style.cursor = this.cursorFor();
    } else this.hoverId = null;
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'touch') return this.onTouchUp(e);
    if (e.button === 1) {
      this.panDrag = null;
      return;
    }
    if (e.button !== 0 || !this.boxStart) return;
    if (this.selectionBox) {
      this.selectInBox(this.selectionBox, e.shiftKey);
    } else {
      const t = this.camera.screenToTile(e.clientX, e.clientY);
      this.clickSelect(t.x, t.y, e.shiftKey);
    }
    this.boxStart = null;
    this.selectionBox = null;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.camera.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }

  private cursorFor(): string {
    if (this.placement) return 'copy';
    if (this.commandMode === 'attack') return 'crosshair';
    if (this.commandMode === 'move') return 'cell';
    const h = this.hoverId !== null ? this.world.entities.get(this.hoverId) : null;
    if (h && this.world.isEnemy(h) && this.sel.myUnits().length) return 'crosshair';
    return h ? 'pointer' : 'default';
  }

  // ------------------------------------------------------------------ táctil
  private onTouchDown(e: PointerEvent) {
    e.preventDefault();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: performance.now() });
    if (this.touches.size === 1) {
      this.touchMode = 'tap';
      window.clearTimeout(this.longPressTimer);
      // Mantener pulsado → selección por área.
      this.longPressTimer = window.setTimeout(() => {
        if (this.touchMode !== 'tap') return;
        this.touchMode = 'box';
        this.selectionBox = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
        navigator.vibrate?.(20);
      }, LONG_PRESS_MS);
    } else if (this.touches.size === 2) {
      window.clearTimeout(this.longPressTimer);
      this.touchMode = 'pinch';
      this.selectionBox = null;
      const [a, b] = [...this.touches.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  private onTouchMove(e: PointerEvent) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const px = t.x;
    const py = t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.touchMode === 'pinch' && this.touches.size >= 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.pinch.dist > 0) this.camera.zoomAt(mx, my, dist / this.pinch.dist);
      this.camera.pan(this.pinch.mx - mx, this.pinch.my - my);
      this.pinch = { dist, mx, my };
      return;
    }
    if (this.touchMode === 'box' && this.selectionBox) {
      this.selectionBox.x1 = e.clientX;
      this.selectionBox.y1 = e.clientY;
      return;
    }
    if (this.touchMode === 'tap' && Math.hypot(e.clientX - t.startX, e.clientY - t.startY) > TAP_SLOP) {
      this.touchMode = 'pan';
      window.clearTimeout(this.longPressTimer);
    }
    if (this.touchMode === 'pan') this.camera.pan(px - e.clientX, py - e.clientY);
    if (this.placement) this.updatePlacementTile(e.clientX, e.clientY);
  }

  private onTouchUp(e: PointerEvent) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    window.clearTimeout(this.longPressTimer);
    if (!t) return;
    if (this.touchMode === 'box' && this.selectionBox) {
      this.selectInBox(this.selectionBox, this.touchMultiSelect);
      this.selectionBox = null;
    } else if (this.touchMode === 'tap') {
      this.onTap(e.clientX, e.clientY);
    }
    if (this.touches.size === 0) {
      this.touchMode = 'none';
      this.pinch = null;
    } else if (this.touchMode === 'pinch' && this.touches.size === 1) {
      this.touchMode = 'pan';
    }
  }

  /** Toque: seleccionar / mover / atacar / recolectar según lo que haya debajo. */
  private onTap(sx: number, sy: number) {
    const tile = this.camera.screenToTile(sx, sy);
    if (this.placement) {
      this.updatePlacementTile(sx, sy);
      this.placeBuilding(false);
      return;
    }
    const target = this.world.entityAt(tile.x, tile.y, 0.35);
    if (this.commandMode) {
      this.issueAt(tile.x, tile.y, target, this.commandMode);
      this.commandMode = null;
      return;
    }
    const hasUnits = this.sel.myUnits().length > 0;
    if (target && this.world.isMine(target)) {
      if (this.touchMultiSelect) this.sel.toggle(target.id);
      else if (hasUnits && target.k === 'building' && (target.s === 'construction' || target.hp < target.mhp) && this.sel.myUnits().some((u) => u.t === 'gatherer')) {
        this.issueAt(tile.x, tile.y, target, null);
        return;
      } else this.sel.set([target.id]);
      audio.play('select');
      return;
    }
    if (hasUnits || this.sel.myBuildings().length) {
      this.issueAt(tile.x, tile.y, target, null);
      return;
    }
    if (target) {
      this.sel.set([target.id]);
      audio.play('select');
    } else this.sel.clear();
  }

  // ------------------------------------------------------------------ teclado
  private onKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Escape') {
      if (this.placement || this.commandMode) this.cancelModes();
      else this.host.togglePause();
      e.preventDefault();
      return;
    }
    if (this.host.isPaused()) return;
    this.keys.add(e.code);
    const units = this.sel.myUnitIds();
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        this.sel.saveGroup(n);
        this.host.notify(`Grupo ${n} guardado (${this.sel.groups.get(n)?.length ?? 0} unidades).`);
      } else if (this.sel.recallGroup(n)) {
        const now = performance.now();
        if (this.lastGroupKey.n === n && now - this.lastGroupKey.time < 350) this.centerOnSelection();
        this.lastGroupKey = { n, time: now };
        audio.play('select');
      }
      return;
    }
    switch (e.code) {
      case 'KeyA':
        if (units.length) this.setCommandMode('attack');
        break;
      case 'KeyM':
        if (units.length) this.setCommandMode('move');
        break;
      case 'KeyX':
        this.orderSimple('stop');
        break;
      case 'KeyH':
        this.orderSimple('hold');
        break;
      case 'KeyR':
        this.orderSimple('retreat');
        break;
      case 'Space': {
        e.preventDefault();
        const alert = this.host.lastAlert();
        if (alert) this.camera.centerOnTile(alert.x, alert.y);
        else this.centerOnBase();
        break;
      }
      case 'KeyQ':
        this.selectArmy();
        break;
      case 'Equal':
      case 'NumpadAdd':
        this.camera.zoomAt(this.camera.viewW / 2, this.camera.viewH / 2, 1.15);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        this.camera.zoomAt(this.camera.viewW / 2, this.camera.viewH / 2, 1 / 1.15);
        break;
    }
  }

  // ------------------------------------------------------------------ acciones públicas (HUD)
  setCommandMode(mode: CommandMode) {
    this.placement = null;
    this.commandMode = mode;
    this.canvas.style.cursor = this.cursorFor();
  }

  startPlacement(type: BuildingType) {
    this.commandMode = null;
    this.placement = type;
    this.placementTile = null;
    if (this.mouse.inside) this.updatePlacementTile(this.mouse.x, this.mouse.y);
    else this.updatePlacementTile(this.camera.viewW / 2, this.camera.viewH / 2);
  }

  cancelModes() {
    this.placement = null;
    this.placementTile = null;
    this.commandMode = null;
    this.canvas.style.cursor = 'default';
  }

  orderSimple(type: 'stop' | 'hold' | 'retreat') {
    const ids = this.sel.myUnitIds();
    if (!ids.length) return;
    this.host.send({ type, unitIds: ids });
    audio.play('command');
  }

  centerOnBase() {
    const cc = [...this.world.entities.values()].find((e) => this.world.isMine(e) && e.t === 'commandCenter');
    if (cc) this.camera.centerOnTile(cc.rx, cc.ry);
  }

  centerOnSelection() {
    const ents = this.sel.entities();
    if (!ents.length) return;
    const x = ents.reduce((s, e) => s + e.rx, 0) / ents.length;
    const y = ents.reduce((s, e) => s + e.ry, 0) / ents.length;
    this.camera.centerOnTile(x, y);
  }

  selectArmy() {
    const ids = [...this.world.entities.values()].filter((e) => e.k === 'unit' && this.world.isMine(e) && e.t !== 'gatherer').map((e) => e.id);
    this.sel.set(ids);
    if (ids.length) audio.play('select');
  }

  // ------------------------------------------------------------------ selección
  private selectInBox(b: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) {
    const a = this.camera.screenToTile(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const c = this.camera.screenToTile(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const ids: number[] = [];
    for (const e of this.world.entities.values()) {
      if (e.k !== 'unit' || !this.world.isMine(e)) continue;
      if (e.rx >= a.x && e.rx <= c.x && e.ry >= a.y && e.ry <= c.y) ids.push(e.id);
    }
    if (additive) this.sel.add(ids);
    else this.sel.set(ids);
    if (ids.length) audio.play('select');
  }

  private clickSelect(x: number, y: number, additive: boolean) {
    const target = this.world.entityAt(x, y, 0.1);
    if (!target) {
      if (!additive) this.sel.clear();
      return;
    }
    const now = performance.now();
    const isDouble = this.lastClick.id === target.id && now - this.lastClick.time < 350;
    this.lastClick = { time: now, id: target.id };
    if (isDouble && target.k === 'unit' && this.world.isMine(target)) {
      // Doble clic: todas las unidades propias de ese tipo en pantalla.
      const v = this.camera.visibleTiles();
      const ids = [...this.world.entities.values()]
        .filter((e) => e.k === 'unit' && this.world.isMine(e) && e.t === target.t && e.rx >= v.x0 && e.rx <= v.x1 && e.ry >= v.y0 && e.ry <= v.y1)
        .map((e) => e.id);
      this.sel.set(ids);
    } else if (additive && this.world.isMine(target)) this.sel.toggle(target.id);
    else this.sel.set([target.id]);
    audio.play('select');
  }

  // ------------------------------------------------------------------ órdenes
  /** Orden contextual (clic derecho / toque) o forzada por modo (A = atacar, M = mover). */
  issueAt(x: number, y: number, target: ClientEntity | null, mode: CommandMode) {
    const units = this.sel.myUnits();
    const buildings = this.sel.myBuildings();
    const now = performance.now();
    if (!units.length) {
      if (buildings.length) {
        for (const b of buildings) this.host.send({ type: 'rally', buildingId: b.id, x, y });
        this.fx.marker(x, y, '#facc15', now);
        audio.play('command');
      }
      return;
    }
    const ids = units.map((u) => u.id);
    const gatherers = units.filter((u) => UNIT_DEFS[u.t as UnitType].canGather).map((u) => u.id);
    const others = ids.filter((id) => !gatherers.includes(id));

    if (target && target.k !== 'resource' && this.world.isEnemy(target) && !target.ghost && mode !== 'move') {
      this.host.send({ type: 'attack', unitIds: ids, targetId: target.id });
      this.fx.marker(target.rx, target.ry, '#f87171', now);
    } else if (target && target.k === 'resource' && gatherers.length && mode === null) {
      this.host.send({ type: 'gather', unitIds: gatherers, targetId: target.id });
      if (others.length) this.host.send({ type: 'move', unitIds: others, x, y });
      this.fx.marker(target.rx, target.ry, '#fde047', now);
    } else if (target && target.k === 'building' && this.world.isMine(target) && gatherers.length && mode === null && (target.s === 'construction' || target.hp < target.mhp)) {
      this.host.send({ type: 'assist', unitIds: gatherers, targetId: target.id });
      if (others.length) this.host.send({ type: 'move', unitIds: others, x, y });
      this.fx.marker(target.rx, target.ry, '#38bdf8', now);
    } else if (mode === 'attack') {
      this.host.send({ type: 'attackMove', unitIds: ids, x, y });
      this.fx.marker(x, y, '#f87171', now);
    } else {
      this.host.send({ type: 'move', unitIds: ids, x, y });
      this.fx.marker(x, y, '#4ade80', now);
    }
    audio.play('command');
  }

  // ------------------------------------------------------------------ construcción
  private updatePlacementTile(sx: number, sy: number) {
    if (!this.placement) return;
    const size = BUILDING_DEFS[this.placement].size;
    const t = this.camera.screenToTile(sx, sy);
    this.placementTile = { tx: Math.floor(t.x - size / 2 + 0.5), ty: Math.floor(t.y - size / 2 + 0.5) };
  }

  private placeBuilding(keepMode: boolean) {
    if (!this.placement || !this.placementTile) return;
    const { tx, ty } = this.placementTile;
    const err = this.placementError(this.placement, tx, ty);
    if (err) {
      this.host.notify(err, 'warn');
      audio.play('error');
      return;
    }
    this.host.send({ type: 'build', building: this.placement, tx, ty });
    audio.play('build');
    if (!keepMode) this.cancelModes();
  }

  /**
   * Comprobación local SOLO para la vista previa. El servidor vuelve a validarlo todo
   * (un cliente modificado no puede saltarse estas reglas).
   */
  placementError(type: BuildingType, tx: number, ty: number): string | null {
    const w = this.world;
    const def = BUILDING_DEFS[type];
    const terr = w.getTerritory();
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) return 'Fuera del mapa.';
        const i = y * w.width + x;
        if (!terrainDef(w.tiles[i]).buildable) return 'Terreno no edificable.';
        if (terr[i] !== w.me) return 'Solo puedes construir dentro de tu territorio.';
      }
    }
    for (const e of [...w.entities.values(), ...w.ghosts.values()]) {
      if (e.k === 'unit') continue;
      const s = e.k === 'building' ? BUILDING_DEFS[e.t as BuildingType].size : 1;
      if (e.x < tx + def.size && e.x + s > tx && e.y < ty + def.size && e.y + s > ty) return 'La zona está ocupada.';
    }
    if (def.placement === 'nearGoldOrStone') {
      const ok = [...w.entities.values(), ...w.ghosts.values()].some(
        (e) => e.k === 'resource' && (e.t === 'gold' || e.t === 'stone') && distToRect(e.x + 0.5, e.y + 0.5, tx, ty, def.size, def.size) <= PLACEMENT_RESOURCE_DISTANCE,
      );
      if (!ok) return 'La mina debe construirse junto a un yacimiento de oro o piedra.';
    }
    if (def.placement === 'nearForest') {
      const r = PLACEMENT_RESOURCE_DISTANCE;
      let ok = false;
      for (let y = ty - r; y < ty + def.size + r && !ok; y++)
        for (let x = tx - r; x < tx + def.size + r && !ok; x++)
          if (x >= 0 && y >= 0 && x < w.width && y < w.height && w.tiles[y * w.width + x] === Terrain.Forest && distToRect(x + 0.5, y + 0.5, tx, ty, def.size, def.size) <= r) ok = true;
      if (!ok) return 'El aserradero debe construirse cerca de un bosque.';
    }
    return null;
  }
}

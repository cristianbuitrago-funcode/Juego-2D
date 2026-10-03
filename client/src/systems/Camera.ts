import { GAME_CONFIG } from '@shared/config/gameConfig';
import { clamp } from '@shared/utils/math';

const TILE = GAME_CONFIG.tileSize;

/** Cámara 2D con zoom, límites del mapa y conversión pantalla ↔ mundo. */
export class Camera {
  /** Centro de la vista en píxeles del mundo. */
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.45;
  maxZoom = 2.2;
  viewW = 800;
  viewH = 600;

  constructor(
    private readonly mapW: number,
    private readonly mapH: number,
  ) {}

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    // Que el mapa entero quepa como mucho al alejar.
    this.minZoom = Math.max(0.3, Math.min(w / (this.mapW * TILE), h / (this.mapH * TILE)) * 0.9);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clampToMap();
  }

  centerOnTile(tx: number, ty: number) {
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.clampToMap();
  }

  pan(dxScreen: number, dyScreen: number) {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clampToMap();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToMap();
  }

  clampToMap() {
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    const W = this.mapW * TILE;
    const H = this.mapH * TILE;
    // Un pequeño margen permite ver el borde del mapa bajo el HUD.
    const m = 80 / this.zoom;
    this.x = halfW * 2 >= W + 2 * m ? W / 2 : clamp(this.x, halfW - m, W - halfW + m);
    this.y = halfH * 2 >= H + 2 * m ? H / 2 : clamp(this.y, halfH - m, H - halfH + m * 2.2);
  }

  /** Pantalla (px CSS) → mundo (px del mundo). */
  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.viewW / 2) / this.zoom + this.x, y: (sy - this.viewH / 2) / this.zoom + this.y };
  }

  /** Pantalla → casillas (coordenadas continuas). */
  screenToTile(sx: number, sy: number) {
    const w = this.screenToWorld(sx, sy);
    return { x: w.x / TILE, y: w.y / TILE };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  /** Rectángulo visible en casillas. */
  visibleTiles() {
    const a = this.screenToTile(0, 0);
    const b = this.screenToTile(this.viewW, this.viewH);
    return { x0: Math.floor(a.x), y0: Math.floor(a.y), x1: Math.ceil(b.x), y1: Math.ceil(b.y) };
  }
}

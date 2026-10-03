import type { GameOverInfo } from '@shared/types/messages';
import { audio } from '../assets/AudioManager';
import { saveSettings, settings } from '../systems/Settings';
import { clear, formatTime, h, isTouchDevice } from './dom';

/** Contenedor de pantallas superpuestas (#screens). */
export function screensRoot(): HTMLElement {
  return document.getElementById('screens')!;
}

export function overlay(...children: (Node | null)[]): HTMLElement {
  const el = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, ...children));
  screensRoot().append(el);
  return el;
}

export function settingsPanel(onBack: () => void): HTMLElement {
  const slider = (label: string, value: number, onInput: (v: number) => void) => {
    const input = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(value) }) as HTMLInputElement;
    input.addEventListener('input', () => onInput(Number(input.value)));
    return h('label', { class: 'row' }, h('span', {}, label), input);
  };
  const check = (label: string, value: boolean, onChange: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox', checked: value }) as HTMLInputElement;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'row' }, h('span', {}, label), input);
  };
  const apply = () => {
    audio.setVolumes(settings.sfxVolume, settings.musicVolume);
    saveSettings();
  };
  return h(
    'div',
    { class: 'panel-settings' },
    h('h2', {}, 'Configuración'),
    slider('Volumen de efectos', settings.sfxVolume, (v) => {
      settings.sfxVolume = v;
      apply();
      audio.play('select');
    }),
    slider('Volumen de música', settings.musicVolume, (v) => {
      settings.musicVolume = v;
      apply();
    }),
    slider('Velocidad de cámara', settings.cameraSpeed / 2, (v) => {
      settings.cameraSpeed = Math.max(0.2, v * 2);
      apply();
    }),
    check('Mover cámara con los bordes de la pantalla', settings.edgeScroll, (v) => {
      settings.edgeScroll = v;
      apply();
    }),
    check('Mostrar siempre las barras de vida', settings.showHpAlways, (v) => {
      settings.showHpAlways = v;
      apply();
    }),
    h('p', { class: 'note' }, 'Sonidos y música son placeholders sintetizados hasta que se añadan archivos de audio reales.'),
    h('div', { class: 'buttons' }, h('button', { class: 'btn primary', onclick: onBack }, 'Volver')),
  );
}

export function controlsPanel(onBack: () => void): HTMLElement {
  const rows: [string, string][] = [
    ['Clic izquierdo', 'Seleccionar (Shift: añadir/quitar)'],
    ['Arrastrar', 'Selección por área'],
    ['Doble clic', 'Seleccionar todas las unidades de ese tipo en pantalla'],
    ['Clic derecho', 'Mover / atacar enemigo / recolectar / reparar / punto de reunión'],
    ['A + clic', 'Ataque-movimiento (ataca lo que encuentre por el camino)'],
    ['M + clic', 'Mover ignorando enemigos'],
    ['X / H / R', 'Detener / Mantener posición / Retirarse a la base'],
    ['Ctrl+1..9 (o Shift+1..9)', 'Guardar grupo · 1..9 recuperar · doble pulsación centra la cámara'],
    ['Q', 'Seleccionar todo el ejército'],
    ['W A S D / flechas', 'Mover cámara (A solo mueve la cámara si no hay unidades seleccionadas)'],
    ['Bordes de pantalla', 'Mover cámara (se puede desactivar)'],
    ['Rueda / + −', 'Zoom'],
    ['Botón central + arrastrar', 'Arrastrar la cámara'],
    ['Espacio', 'Ir a la última alerta o a la base'],
    ['Esc', 'Cancelar / menú de pausa'],
    ['Minimapa', 'Clic: mover cámara · Clic derecho: enviar unidades'],
  ];
  const touch: [string, string][] = [
    ['Toque', 'Seleccionar unidad propia'],
    ['Toque en terreno', 'Mover unidades seleccionadas'],
    ['Toque en enemigo', 'Atacar'],
    ['Toque en recurso', 'Recolectar (recolectores)'],
    ['Mantener pulsado + arrastrar', 'Selección por área'],
    ['Arrastrar con un dedo', 'Mover cámara'],
    ['Pellizcar', 'Zoom'],
    ['Botones inferiores', 'Multi-selección, ejército, base, órdenes y grupos'],
  ];
  const table = (list: [string, string][]) => h('table', { class: 'controls' }, ...list.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))));
  return h(
    'div',
    {},
    h('h2', {}, 'Controles'),
    isTouchDevice() ? h('div', {}, h('h3', {}, 'Táctil'), table(touch), h('h3', {}, 'Teclado y ratón'), table(rows)) : h('div', {}, table(rows), h('h3', {}, 'Táctil (móvil/tablet)'), table(touch)),
    h('div', { class: 'buttons' }, h('button', { class: 'btn primary', onclick: onBack }, 'Volver')),
  );
}

export interface PauseHandlers {
  onResume(): void;
  onSurrender(): void;
  onExit(): void;
}

/** Menú de pausa. En partidas online la simulación NO se detiene (lo indica el propio menú). */
export class PauseMenu {
  private el: HTMLElement | null = null;

  constructor(private readonly handlers: PauseHandlers) {}

  get open() {
    return !!this.el;
  }

  show() {
    if (this.el) return;
    this.el = overlay();
    this.main();
  }

  hide() {
    this.el?.remove();
    this.el = null;
  }

  private content(node: HTMLElement) {
    const modal = this.el!.querySelector('.modal') as HTMLElement;
    clear(modal);
    modal.append(node);
  }

  private main() {
    this.content(
      h(
        'div',
        {},
        h('h2', {}, 'Pausa'),
        h('p', { class: 'note' }, 'Partida online: la simulación continúa mientras el menú está abierto.'),
        h(
          'div',
          { class: 'menu-buttons' },
          h('button', { class: 'btn primary', onclick: () => this.handlers.onResume() }, 'Continuar'),
          h('button', { class: 'btn', onclick: () => this.content(settingsPanel(() => this.main())) }, 'Configuración'),
          h('button', { class: 'btn', onclick: () => this.content(controlsPanel(() => this.main())) }, 'Controles'),
          h('button', { class: 'btn danger', onclick: () => this.confirm('¿Rendirse? Quedarás eliminado de la partida.', () => this.handlers.onSurrender()) }, 'Rendirse'),
          h('button', { class: 'btn', onclick: () => this.confirm('¿Salir al menú? Abandonarás la partida.', () => this.handlers.onExit()) }, 'Salir al menú'),
        ),
      ),
    );
  }

  private confirm(text: string, fn: () => void) {
    this.content(
      h(
        'div',
        {},
        h('h2', {}, 'Confirmar'),
        h('p', {}, text),
        h('div', { class: 'buttons' }, h('button', { class: 'btn danger', onclick: fn }, 'Sí'), h('button', { class: 'btn', onclick: () => this.main() }, 'No')),
      ),
    );
  }
}

/** Pantalla de victoria o derrota con estadísticas. */
export function showEndScreen(info: GameOverInfo, me: number, won: boolean, onContinue: () => void): HTMLElement {
  const el = overlay(
    h('div', { class: `end ${won ? 'won' : 'lost'}` }, h('h1', {}, won ? '¡Victoria!' : 'Derrota'), h('p', { class: 'reason' }, info.reason), h('p', { class: 'note' }, `Duración: ${formatTime(info.duration)}`)),
    h(
      'table',
      { class: 'stats' },
      h('tr', {}, ...['Jugador', 'Entrenadas', 'Perdidas', 'Bajas', 'Edificios', 'Recursos'].map((t) => h('th', {}, t))),
      ...info.stats.map((s) =>
        h(
          'tr',
          { class: s.playerId === me ? 'me' : '' },
          h('td', {}, s.name, info.winners.includes(s.playerId) ? ' 🏆' : ''),
          h('td', {}, String(s.unitsTrained)),
          h('td', {}, String(s.unitsLost)),
          h('td', {}, String(s.kills)),
          h('td', {}, String(s.buildingsBuilt)),
          h('td', {}, String(s.resourcesGathered)),
        ),
      ),
    ),
    h('div', { class: 'buttons' }, h('button', { class: 'btn primary', onclick: () => onContinue() }, 'Volver a la sala')),
  );
  el.classList.add('end-overlay');
  return el;
}

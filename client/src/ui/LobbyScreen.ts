import { GAME_MODES, GAME_MODE_IDS } from '@shared/config/gameModes';
import { PLAYER_NAME_MAX, ROOM_CODE_LENGTH } from '@shared/config/gameConfig';
import type { AIDifficulty, GameModeId, MapSize } from '@shared/types/game';
import type { RoomInfo } from '@shared/types/messages';
import { audio } from '../assets/AudioManager';
import type { NetworkClient } from '../network/NetworkClient';
import { levelFromXp, loadProfile, saveSettings, settings } from '../systems/Settings';
import { clear, h, toast } from './dom';
import { controlsPanel, screensRoot, settingsPanel } from './Menus';

const MAP_SIZE_LABELS: Record<MapSize, string> = { small: 'Pequeño (48×48)', medium: 'Mediano (64×64)', large: 'Grande (80×80)' };
const DIFF_LABELS: Record<AIDifficulty, string> = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };

/** Menú principal y sala de espera (lobby). */
export class LobbyScreen {
  private el: HTMLElement;
  room: RoomInfo | null = null;
  mySlot = -1;
  private ready = false;

  constructor(private readonly net: NetworkClient) {
    this.el = h('div', { class: 'lobby' });
  }

  show() {
    if (!this.el.isConnected) screensRoot().append(this.el);
    this.render();
  }

  hide() {
    this.el.remove();
  }

  setRoom(room: RoomInfo | null, slot?: number) {
    this.room = room;
    if (slot !== undefined) this.mySlot = slot;
    const me = room?.players.find((p) => p.slot === this.mySlot);
    this.ready = !!me?.ready;
    if (this.el.isConnected) this.render();
  }

  private render() {
    clear(this.el);
    const card = h('div', { class: 'card' });
    this.el.append(h('div', { class: 'brand' }, h('div', { class: 'logo' }, '⚑'), h('h1', {}, 'Frontera'), h('p', {}, 'Estrategia en tiempo real · Multijugador online')), card);
    if (this.room) this.renderRoom(card, this.room);
    else this.renderMenu(card);
    const status = h('div', { class: `conn ${this.net.connected ? 'ok' : 'bad'}` }, this.net.connected ? '● Conectado al servidor' : '● Sin conexión con el servidor…');
    this.el.append(status);
  }

  private nameInput(): HTMLInputElement {
    const input = h('input', { type: 'text', maxlength: String(PLAYER_NAME_MAX), placeholder: 'Tu nombre', value: settings.playerName }) as HTMLInputElement;
    input.addEventListener('input', () => {
      settings.playerName = input.value;
      saveSettings();
    });
    return input;
  }

  private renderMenu(card: HTMLElement) {
    const name = this.nameInput();
    const mode = h('select', {}, ...GAME_MODE_IDS.map((id) => h('option', { value: id }, GAME_MODES[id].name + (GAME_MODES[id].experimental ? ' (experimental)' : '')))) as HTMLSelectElement;
    const modeDesc = h('p', { class: 'note' }, GAME_MODES.battle.description);
    mode.addEventListener('change', () => (modeDesc.textContent = GAME_MODES[mode.value as GameModeId].description));
    const code = h('input', { type: 'text', maxlength: String(ROOM_CODE_LENGTH), placeholder: 'CÓDIGO', class: 'code-input', autocapitalize: 'characters' }) as HTMLInputElement;
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    const getName = () => {
      const n = name.value.trim();
      if (!n) {
        toast('Escribe tu nombre primero.', 'warn');
        name.focus();
        return null;
      }
      return n;
    };
    const create = async () => {
      audio.unlock();
      const n = getName();
      if (!n) return;
      try {
        const res = await this.net.createRoom(n, { mode: mode.value as GameModeId });
        this.setRoom(res.room, res.slot);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    };
    const join = async () => {
      audio.unlock();
      const n = getName();
      if (!n) return;
      if (code.value.length !== ROOM_CODE_LENGTH) return toast(`El código tiene ${ROOM_CODE_LENGTH} caracteres.`, 'warn');
      try {
        const res = await this.net.joinRoom(n, code.value);
        this.setRoom(res.room, res.slot);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    };
    code.addEventListener('keydown', (e) => e.key === 'Enter' && join());

    const profile = loadProfile();
    const lvl = levelFromXp(profile.xp);
    card.append(
      h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
      h('div', { class: 'split' },
        h('div', { class: 'box' }, h('h3', {}, 'Crear partida'), h('label', { class: 'field' }, h('span', {}, 'Modo'), mode), modeDesc, h('button', { class: 'btn primary wide', onclick: create }, 'Crear partida')),
        h('div', { class: 'box' }, h('h3', {}, 'Unirse a partida'), h('label', { class: 'field' }, h('span', {}, 'Código de sala'), code), h('p', { class: 'note' }, 'Pide el código al anfitrión de la sala.'), h('button', { class: 'btn primary wide', onclick: join }, 'Unirse')),
      ),
      h(
        'div',
        { class: 'profile', title: 'Progresión guardada solo en este navegador (placeholder)' },
        h('span', {}, `Nivel ${lvl.level}`),
        h('div', { class: 'xpbar' }, h('div', { style: `width:${Math.round(lvl.progress * 100)}%` })),
        h('span', {}, `${profile.wins} victorias · ${profile.games} partidas`),
      ),
      h('div', { class: 'buttons' }, h('button', { class: 'btn', onclick: () => this.sub(settingsPanel(() => this.render())) }, 'Configuración'), h('button', { class: 'btn', onclick: () => this.sub(controlsPanel(() => this.render())) }, 'Controles')),
    );
  }

  private sub(panel: HTMLElement) {
    clear(this.el);
    this.el.append(h('div', { class: 'card' }, panel));
  }

  private renderRoom(card: HTMLElement, room: RoomInfo) {
    const me = room.players.find((p) => p.slot === this.mySlot);
    const isHost = !!me?.isHost;
    const mode = GAME_MODES[room.settings.mode];
    const copy = () => {
      navigator.clipboard?.writeText(room.code).then(
        () => toast('Código copiado.'),
        () => toast(`Código: ${room.code}`),
      );
    };
    card.append(
      h('div', { class: 'room-head' }, h('div', {}, h('div', { class: 'note' }, 'Código de la sala'), h('div', { class: 'room-code', onclick: copy, title: 'Clic para copiar' }, room.code)), h('button', { class: 'btn small', onclick: copy }, 'Copiar')),
      h('p', { class: 'note' }, 'Comparte este código con tus amigos para que se unan desde su dispositivo.'),
    );

    const list = h('div', { class: 'player-list' });
    for (let i = 0; i < room.maxPlayers; i++) {
      const p = room.players[i];
      if (!p) {
        list.append(h('div', { class: 'player empty' }, 'Esperando jugador…'));
        continue;
      }
      list.append(
        h(
          'div',
          { class: `player ${p.slot === this.mySlot ? 'me' : ''}` },
          h('span', { class: 'dot', style: `--c:${p.color}` }),
          h('span', { class: 'name' }, p.name, p.isHost ? ' 👑' : '', p.slot === this.mySlot ? ' (tú)' : ''),
          !p.connected ? h('span', { class: 'tag' }, 'desconectado') : null,
          h('span', { class: `ready ${p.ready ? 'yes' : 'no'}` }, p.ready ? '✔ Listo' : '… No listo'),
        ),
      );
    }
    if (room.settings.mode === 'coop') list.append(h('div', { class: 'player ai' }, '🤖 Enemigos controlados por la IA (', DIFF_LABELS[room.settings.aiDifficulty], ')'));
    card.append(h('h3', {}, `Jugadores (${room.players.length}/${room.maxPlayers})`), list);

    // Ajustes (solo el anfitrión puede cambiarlos)
    const sel = <T extends string>(value: T, options: Record<T, string>, onChange: (v: T) => void) => {
      const s = h('select', { disabled: !isHost }, ...Object.entries(options).map(([k, v]) => h('option', { value: k, selected: k === value }, v as string))) as HTMLSelectElement;
      s.addEventListener('change', () => onChange(s.value as T));
      return s;
    };
    const modeOptions = Object.fromEntries(GAME_MODE_IDS.map((id) => [id, GAME_MODES[id].name + (GAME_MODES[id].experimental ? ' (exp.)' : '')])) as Record<GameModeId, string>;
    card.append(
      h(
        'div',
        { class: 'settings-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Modo'), sel(room.settings.mode, modeOptions, (v) => this.net.updateSettings({ mode: v }))),
        h('label', { class: 'field' }, h('span', {}, 'Mapa'), sel(room.settings.mapSize, MAP_SIZE_LABELS, (v) => this.net.updateSettings({ mapSize: v }))),
        room.settings.mode === 'coop' ? h('label', { class: 'field' }, h('span', {}, 'Dificultad IA'), sel(room.settings.aiDifficulty, DIFF_LABELS, (v) => this.net.updateSettings({ aiDifficulty: v }))) : null,
      ),
      h('p', { class: 'note' }, mode.description, isHost ? '' : ' (Solo el anfitrión puede cambiar los ajustes.)'),
    );

    const allReady = room.players.every((p) => p.ready);
    const enough = room.players.length >= room.minPlayers;
    const startReason = !enough ? `Se necesitan al menos ${room.minPlayers} jugadores` : !allReady ? 'Esperando a que todos estén listos' : '';
    const readyBtn = h('button', { class: `btn ${this.ready ? '' : 'primary'}`, onclick: () => this.net.setReady(!this.ready) }, this.ready ? 'No estoy listo' : '¡Estoy listo!');
    const startBtn = isHost
      ? h(
          'button',
          {
            class: `btn primary ${startReason ? 'disabled' : ''}`,
            title: startReason,
            onclick: async () => {
              if (startReason) return toast(startReason, 'warn');
              try {
                await this.net.start();
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            },
          },
          'Comenzar partida',
        )
      : null;
    card.append(
      h('div', { class: 'buttons' }, readyBtn, startBtn, h('button', { class: 'btn', onclick: () => this.leave() }, 'Salir')),
    );
    if (startReason) card.append(h('p', { class: 'note center' }, startReason));
  }

  leave() {
    this.net.leave();
    this.setRoom(null);
    this.render();
  }
}

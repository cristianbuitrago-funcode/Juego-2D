import { BUILDING_DEFS } from '@shared/constants/buildings';
import type { BuildingType } from '@shared/types/game';
import type { Command, GameEvent, GameInit, GameOverInfo, Snapshot } from '@shared/types/messages';
import { audio } from './assets/AudioManager';
import { Effects } from './components/Effects';
import { GameRenderer } from './components/GameRenderer';
import { Minimap } from './components/Minimap';
import type { NetworkClient } from './network/NetworkClient';
import { Camera } from './systems/Camera';
import { ClientWorld } from './systems/ClientWorld';
import { InputController } from './systems/InputController';
import { Selection } from './systems/Selection';
import { recordGame, settings } from './systems/Settings';
import { toast } from './ui/dom';
import { Hud } from './ui/Hud';
import { PauseMenu, showEndScreen } from './ui/Menus';
import { TECH_DEFS } from '@shared/constants/units';

/**
 * Una partida en el cliente: une red, estado local, cámara, entrada, renderizado e interfaz.
 * El cliente NO simula la lógica del juego: dibuja lo que dice el servidor e interpola.
 */
export class GameSession {
  readonly world: ClientWorld;
  readonly camera: Camera;
  readonly selection: Selection;
  readonly effects = new Effects();
  private readonly renderer: GameRenderer;
  private readonly input: InputController;
  private readonly minimap: Minimap;
  private readonly hud: Hud;
  private readonly pause: PauseMenu;
  private raf = 0;
  private lastFrame = performance.now();
  private hudTimer = 0;
  private centered = false;
  private alert: { x: number; y: number; at: number } | null = null;
  private ended = false;
  private lastReject = 0;
  private readonly onResize = () => this.resize();

  constructor(
    init: GameInit,
    private readonly net: NetworkClient,
    private readonly onExit: (reason: 'left' | 'ended') => void,
  ) {
    this.world = new ClientWorld(init);
    this.camera = new Camera(this.world.width, this.world.height);
    this.selection = new Selection(this.world);
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.classList.add('active');
    this.renderer = new GameRenderer(canvas, this.world);
    this.input = new InputController(canvas, this.world, this.camera, this.selection, this.effects, {
      send: (cmd) => this.send(cmd),
      togglePause: () => (this.pause.open ? this.pause.hide() : this.pause.show()),
      isPaused: () => this.pause.open || this.ended,
      notify: (t, l) => toast(t, l),
      lastAlert: () => (this.alert && performance.now() - this.alert.at < 15000 ? this.alert : null),
    });
    this.minimap = new Minimap(this.world, this.camera, window.innerWidth < 700 ? 120 : 180);
    this.minimap.onRightClick = (x, y) => this.input.issueAt(x, y, null, null);
    this.pause = new PauseMenu({
      onResume: () => this.pause.hide(),
      onSurrender: () => {
        this.net.surrender();
        this.pause.hide();
      },
      onExit: () => {
        this.net.leave();
        this.dispose();
        this.onExit('left');
      },
    });
    this.hud = new Hud({
      world: this.world,
      selection: this.selection,
      input: this.input,
      minimapCanvas: this.minimap.canvas,
      send: (cmd) => this.send(cmd),
      openPause: () => this.pause.show(),
      ping: () => this.net.ping,
    });
    window.addEventListener('resize', this.onResize);
    this.resize();
    audio.startMusic();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private send(cmd: Command) {
    this.net.command(cmd);
  }

  rejected(reason: string) {
    const now = performance.now();
    if (now - this.lastReject < 400) return;
    this.lastReject = now;
    toast(reason, 'warn', 2500);
    audio.play('error');
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
    this.camera.resize(w, h);
  }

  onSnapshot(s: Snapshot) {
    const events = this.world.applySnapshot(s);
    if (!this.centered) {
      this.centered = true;
      this.input.centerOnBase();
    }
    this.handleEvents(events);
  }

  private handleEvents(events: GameEvent[]) {
    const now = performance.now();
    const w = this.world;
    for (const ev of events) {
      switch (ev.type) {
        case 'attack': {
          const attacker = w.entities.get(ev.from);
          if (ev.ranged) {
            this.effects.projectile(ev.x1, ev.y1, ev.x2, ev.y2, attacker?.k === 'building' ? 'bolt' : 'arrow', now);
            audio.play('arrow', 90);
          } else {
            this.effects.slash(ev.x2, ev.y2, Math.atan2(ev.y2 - ev.y1, ev.x2 - ev.x1), now);
            audio.play('attack', 90);
          }
          this.effects.damage(ev.x2, ev.y2, ev.dmg, now + (ev.ranged ? 200 : 0));
          break;
        }
        case 'death': {
          const color = w.colorOf(ev.o);
          if (ev.kind === 'building') {
            const size = BUILDING_DEFS[ev.t as BuildingType]?.size ?? 2;
            this.effects.burst(ev.x, ev.y, '#78716c', 30, now, 3);
            this.effects.burst(ev.x, ev.y, '#f97316', 14, now, size);
          } else this.effects.burst(ev.x, ev.y, color, 12, now);
          audio.play('death', 120);
          break;
        }
        case 'built':
          audio.play('built');
          break;
        case 'trained':
          audio.play('trained');
          break;
        case 'upgraded':
          audio.play('built');
          break;
        case 'researched':
          audio.play('built');
          toast(`Tecnología mejorada: ${TECH_DEFS[ev.tech].name} ${ev.level}`);
          break;
        case 'captured': {
          const owners = [...w.players.values()].filter((p) => p.team === ev.team).map((p) => p.name);
          const mine = ev.team === w.myTeam;
          toast(`${mine ? '✔' : '⚠'} Punto estratégico capturado por ${owners.join(', ')}`, mine ? 'info' : 'warn');
          audio.play('notify');
          break;
        }
        case 'eliminated':
          if (ev.playerId === w.me) this.hud.showBanner('Has sido eliminado', 4000);
          break;
        case 'notify':
          toast(ev.text, ev.level);
          audio.play(ev.level === 'info' ? 'notify' : 'alert', 300);
          break;
        case 'underAttack':
          this.alert = { x: ev.x, y: ev.y, at: now };
          this.minimap.onAlert = { x: ev.x, y: ev.y, until: now + 4000 };
          this.hud.showBanner('¡Te están atacando! (Espacio para ir)');
          audio.play('alert', 3000);
          break;
      }
    }
  }

  gameOver(info: GameOverInfo) {
    if (this.ended) return;
    this.ended = true;
    this.pause.hide();
    const won = info.winners.includes(this.world.me);
    const myStats = info.stats.find((s) => s.playerId === this.world.me);
    recordGame(won, myStats?.kills ?? 0);
    audio.play(won ? 'victory' : 'defeat');
    showEndScreen(info, this.world.me, won, () => {
      document.querySelector('.end-overlay')?.remove();
      this.dispose();
      this.onExit('ended');
    });
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.input.update(dt);
    this.world.interpolate(now);
    this.renderer.render(
      this.camera,
      this.selection,
      this.effects,
      {
        selectionBox: this.input.selectionBox,
        placement:
          this.input.placement && this.input.placementTile
            ? {
                type: this.input.placement,
                ...this.input.placementTile,
                valid: !this.input.placementError(this.input.placement, this.input.placementTile.tx, this.input.placementTile.ty),
              }
            : null,
        hoverId: this.input.hoverId,
        commandMode: this.input.commandMode,
        showHpAlways: settings.showHpAlways,
      },
      now,
    );
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.15;
      this.hud.update();
      this.minimap.draw(now);
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.hud.dispose();
    this.pause.hide();
    audio.stopMusic();
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.classList.remove('active');
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

import { BUILDING_DEFS, BUILDING_TYPES } from '@shared/constants/buildings';
import { RESOURCE_NAMES, TECH_DEFS, TECH_TYPES, UNIT_DEFS } from '@shared/constants/units';
import { GAME_MODES } from '@shared/config/gameModes';
import { GAME_CONFIG } from '@shared/config/gameConfig';
import type { BuildingType, Cost, TargetPriority, UnitType } from '@shared/types/game';
import { RESOURCE_TYPES } from '@shared/types/game';
import type { Command } from '@shared/types/messages';
import { canAffordCost } from '@shared/utils/math';
import { RESOURCE_COLORS } from '../assets/palette';
import { iconFor } from '../entities/sprites';
import type { ClientEntity, ClientWorld } from '../systems/ClientWorld';
import type { InputController } from '../systems/InputController';
import type { Selection } from '../systems/Selection';
import { clear, formatTime, h, isTouchDevice, toast } from './dom';

export interface HudHost {
  world: ClientWorld;
  selection: Selection;
  input: InputController;
  minimapCanvas: HTMLCanvasElement;
  send(cmd: Command): void;
  openPause(): void;
  ping(): number;
}

const PRIORITY_LABELS: Record<TargetPriority, string> = {
  nearest: 'Más cercano',
  weakest: 'Más débil',
  units: 'Unidades primero',
  buildings: 'Edificios primero',
};

const STATE_LABELS: Record<string, string> = {
  idle: 'En reposo',
  moving: 'Moviéndose',
  attacking: 'Atacando',
  gathering: 'Recolectando',
  returning: 'Llevando recursos',
  building: 'Construyendo/reparando',
  holding: 'Manteniendo posición',
  retreating: 'Retirándose',
  construction: 'En construcción',
  active: 'Activo',
  upgrading: 'Mejorando',
};

function costText(cost: Cost): string {
  return RESOURCE_TYPES.filter((r) => cost[r]).map((r) => `${cost[r]} ${RESOURCE_NAMES[r].toLowerCase()}`).join(', ') || 'Gratis';
}

function costChips(cost: Cost): HTMLElement {
  return h(
    'span',
    { class: 'cost' },
    ...RESOURCE_TYPES.filter((r) => cost[r]).map((r) => h('span', { class: 'chip', style: `--c:${RESOURCE_COLORS[r]}` }, String(cost[r]))),
  );
}

/** Interfaz de partida (DOM superpuesto al canvas). */
export class Hud {
  private root: HTMLElement;
  private resEls = new Map<string, HTMLElement>();
  private popEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private pingEl!: HTMLElement;
  private playersEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private selectionEl!: HTMLElement;
  private ordersEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private lastKeys = { sel: '', orders: '', actions: '' };
  private lastPlayersKey = '';

  constructor(private readonly host: HudHost) {
    this.root = document.getElementById('hud')!;
    clear(this.root);
    this.root.classList.remove('hidden');
    this.build();
  }

  dispose() {
    clear(this.root);
    this.root.classList.add('hidden');
  }

  private build() {
    const top = h('div', { class: 'topbar' });
    const res = h('div', { class: 'resources' });
    for (const r of RESOURCE_TYPES) {
      const val = h('span', { class: 'val' }, '0');
      this.resEls.set(r, val);
      res.append(h('div', { class: 'res', title: RESOURCE_NAMES[r] }, h('span', { class: 'dot', style: `--c:${RESOURCE_COLORS[r]}` }), h('span', { class: 'lbl' }, RESOURCE_NAMES[r]), val));
    }
    this.popEl = h('span', { class: 'val' }, '0/0');
    res.append(h('div', { class: 'res', title: 'Población' }, h('span', { class: 'icon' }, '👥'), h('span', { class: 'lbl' }, 'Población'), this.popEl));
    this.timeEl = h('span', { class: 'time' }, '0:00');
    this.pingEl = h('span', { class: 'ping' }, '');
    top.append(
      res,
      h('div', { class: 'top-right' }, h('span', { class: 'mode' }, GAME_MODES[this.host.world.mode].name), this.timeEl, this.pingEl, h('button', { class: 'btn icon-btn', title: 'Menú (Esc)', onclick: () => this.host.openPause() }, '☰')),
    );

    this.playersEl = h('div', { class: 'players-panel' });
    this.objectiveEl = h('div', { class: 'objective' });
    this.bannerEl = h('div', { class: 'banner hidden' });

    const side = h('div', { class: 'side-panel' }, this.host.minimapCanvas);

    this.selectionEl = h('div', { class: 'panel selection' });
    this.ordersEl = h('div', { class: 'panel orders' });
    this.actionsEl = h('div', { class: 'panel actions' });
    const bottom = h('div', { class: 'bottom-bar' }, this.selectionEl, this.ordersEl, this.actionsEl);

    this.root.append(top, h('div', { class: 'left-col' }, this.playersEl, this.objectiveEl), this.bannerEl, side, bottom);
    if (isTouchDevice()) this.root.append(this.buildTouchBar());
  }

  private buildTouchBar(): HTMLElement {
    const input = this.host.input;
    const multi = h('button', { class: 'btn' }, '☐ Multi');
    multi.addEventListener('click', () => {
      input.touchMultiSelect = !input.touchMultiSelect;
      multi.textContent = input.touchMultiSelect ? '☑ Multi' : '☐ Multi';
      multi.classList.toggle('on', input.touchMultiSelect);
    });
    return h(
      'div',
      { class: 'touch-bar' },
      h('button', { class: 'btn', onclick: () => this.host.selection.clear() }, '✕ Nada'),
      multi,
      h('button', { class: 'btn', onclick: () => input.selectArmy() }, '⚔ Ejército'),
      h('button', { class: 'btn', onclick: () => input.centerOnBase() }, '⌂ Base'),
    );
  }

  showBanner(text: string, ms = 2500) {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('hidden');
    window.clearTimeout((this.bannerEl as unknown as { _t?: number })._t);
    (this.bannerEl as unknown as { _t?: number })._t = window.setTimeout(() => this.bannerEl.classList.add('hidden'), ms);
  }

  /** Se llama varias veces por segundo. Solo reconstruye los paneles si algo relevante cambió. */
  update() {
    const w = this.host.world;
    const priv = w.priv;
    if (priv) {
      for (const r of RESOURCE_TYPES) {
        const el = this.resEls.get(r)!;
        el.textContent = String(priv.resources[r]);
        el.classList.toggle('full', priv.resources[r] >= priv.storageCap);
        el.parentElement!.title = `${RESOURCE_NAMES[r]} (máx. ${priv.storageCap})`;
      }
      this.popEl.textContent = `${priv.pop}/${priv.popCap}`;
      this.popEl.classList.toggle('full', priv.pop >= priv.popCap);
    }
    this.timeEl.textContent = formatTime(w.gameTime());
    const ping = this.host.ping();
    this.pingEl.textContent = ping ? `${ping} ms` : '';
    this.updatePlayers();

    const sel = this.host.selection;
    sel.prune();
    const ents = sel.entities();
    const input = this.host.input;
    const units = sel.myUnits();
    // Cada panel tiene su propia "firma": solo se reconstruye cuando cambia algo que muestra.
    const selKey = JSON.stringify([sel.version, ents.map((e) => [e.id, e.hp, e.s, e.l, e.q, e.rs, e.p, e.c, e.a]), priv?.tech]);
    const ordersKey = JSON.stringify([sel.version, units.length, units[0]?.pr, input.commandMode, [...sel.groups.values()].map((g) => g.length)]);
    const actionsKey = JSON.stringify([
      sel.version,
      sel.myBuildings().map((e) => [e.id, e.s, e.l, e.q?.length, !!e.rs]),
      priv?.resources,
      priv?.pop,
      priv?.popCap,
      priv?.tech,
      input.placement,
      w.spectator,
      [...w.entities.values()].filter((e) => e.k === 'building' && w.isMine(e)).map((e) => `${e.t}${e.s}`).join(),
    ]);
    if (selKey !== this.lastKeys.sel) {
      this.lastKeys.sel = selKey;
      this.renderSelection(ents);
    }
    if (ordersKey !== this.lastKeys.orders) {
      this.lastKeys.orders = ordersKey;
      this.renderOrders();
    }
    if (actionsKey !== this.lastKeys.actions) {
      this.lastKeys.actions = actionsKey;
      this.renderActions();
    }
  }

  private updatePlayers() {
    const w = this.host.world;
    const key = JSON.stringify([...w.players.values()]);
    if (key === this.lastPlayersKey) return;
    this.lastPlayersKey = key;
    clear(this.playersEl);
    const showScore = GAME_MODES[w.mode].victory.some((v) => v.type === 'controlPoints');
    for (const p of w.players.values()) {
      const status = p.eliminated ? 'eliminado' : !p.connected ? 'desconectado' : p.isAI ? 'IA' : '';
      this.playersEl.append(
        h(
          'div',
          { class: `pl ${p.eliminated ? 'out' : ''} ${p.id === w.me ? 'me' : ''}` },
          h('span', { class: 'dot', style: `--c:${p.color}` }),
          h('span', { class: 'name' }, p.name),
          status ? h('span', { class: 'tag' }, status) : null,
          showScore ? h('span', { class: 'score' }, String(p.score)) : null,
        ),
      );
    }
    const mode = GAME_MODES[w.mode];
    const goals: string[] = [];
    for (const v of mode.victory) {
      if (v.type === 'lastTeamStanding') goals.push('Destruye los centros de mando enemigos');
      if (v.type === 'controlPoints') goals.push(`Llega a ${v.score} puntos controlando los obeliscos`);
      if (v.type === 'resources') goals.push(`Recolecta ${v.amount} recursos (llevas ${w.priv?.gathered ?? 0})`);
      if (v.type === 'holdTerritory') goals.push(`Controla el ${v.percent}% del territorio durante ${v.seconds}s`);
    }
    this.objectiveEl.textContent = (w.spectator ? '👁 Modo espectador · ' : '🎯 ') + goals.join(' · ');
  }

  // ------------------------------------------------------------------ selección
  private renderSelection(ents: ClientEntity[]) {
    const w = this.host.world;
    const el = this.selectionEl;
    clear(el);
    if (!ents.length) {
      el.append(h('div', { class: 'empty' }, isTouchDevice() ? 'Toca una unidad o mantén pulsado y arrastra para seleccionar.' : 'Clic para seleccionar, arrastra para seleccionar varias. Clic derecho para dar órdenes.'));
      return;
    }
    if (ents.length === 1) {
      const e = ents[0];
      const color = w.colorOf(e.o);
      const owner = e.o >= 0 ? w.players.get(e.o)?.name ?? '' : 'Neutral';
      if (e.k === 'unit') {
        const def = UNIT_DEFS[e.t as UnitType];
        const tech = w.isMine(e) ? w.priv?.tech : undefined;
        const dmg = Math.round(def.damage * (1 + 0.15 * (tech?.weapons ?? 0)));
        el.append(
          h('div', { class: 'portrait' }, h('img', { src: iconFor('unit', e.t, color), alt: '' })),
          h(
            'div',
            { class: 'info' },
            h('div', { class: 'title' }, def.name, h('span', { class: 'owner', style: `color:${color}` }, ` · ${owner}`)),
            this.hpLine(e),
            h('div', { class: 'stats' }, `⚔ ${dmg}  🛡 ${def.defense + (tech?.armor ?? 0)}  🏃 ${def.speed}  🎯 ${def.range}`),
            h('div', { class: 'state' }, STATE_LABELS[e.s ?? 'idle'] ?? '', e.c ? ` · lleva ${e.c} ${RESOURCE_NAMES[e.ct!].toLowerCase()}` : ''),
            h('div', { class: 'desc' }, def.description),
          ),
        );
      } else if (e.k === 'building') {
        const def = BUILDING_DEFS[e.t as BuildingType];
        el.append(
          h('div', { class: 'portrait' }, h('img', { src: iconFor('building', e.t, color), alt: '' })),
          h(
            'div',
            { class: 'info' },
            h('div', { class: 'title' }, `${def.name} (nivel ${e.l ?? 1})`, h('span', { class: 'owner', style: `color:${color}` }, ` · ${owner}`)),
            this.hpLine(e),
            h('div', { class: 'state' }, STATE_LABELS[e.s ?? 'active'] ?? '', e.p !== undefined && e.s !== 'active' ? ` ${Math.round(e.p * 100)}%` : ''),
            h('div', { class: 'desc' }, def.levelInfo[(e.l ?? 1) - 1] ?? def.description),
            e.q?.length
              ? h('div', { class: 'queue' }, ...e.q.map((q, i) => h('div', { class: 'qitem', title: UNIT_DEFS[q.u].name }, h('img', { src: iconFor('unit', q.u, color), alt: '' }), i === 0 ? h('div', { class: 'qbar', style: `width:${Math.round(q.p * 100)}%` }) : null)))
              : null,
            e.rs ? h('div', { class: 'state' }, `Investigando ${TECH_DEFS[e.rs.tech].name}: ${Math.round(e.rs.p * 100)}%`) : null,
          ),
        );
      } else {
        el.append(
          h('div', { class: 'portrait' }, h('img', { src: iconFor('resource', e.t), alt: '' })),
          h('div', { class: 'info' }, h('div', { class: 'title' }, `Recurso: ${RESOURCE_NAMES[e.t as keyof typeof RESOURCE_NAMES]}`), h('div', { class: 'stats' }, `Quedan ${e.a ?? e.hp} de ${e.mhp}`), h('div', { class: 'desc' }, 'Selecciona recolectores y haz clic derecho (o toca) para recolectar.')),
        );
      }
      return;
    }
    // Varias entidades: cuadrícula de iconos con vida.
    const grid = h('div', { class: 'multi' });
    for (const e of ents.slice(0, 36)) {
      const f = e.hp / e.mhp;
      const cell = h(
        'button',
        { class: 'cell', title: e.k === 'unit' ? UNIT_DEFS[e.t as UnitType].name : BUILDING_DEFS[e.t as BuildingType]?.name ?? e.t, onclick: () => this.host.selection.set([e.id]) },
        h('img', { src: iconFor(e.k === 'unit' ? 'unit' : 'building', e.t, w.colorOf(e.o)), alt: '' }),
        h('div', { class: 'hpb' }, h('div', { style: `width:${Math.round(f * 100)}%;background:${f > 0.6 ? '#22c55e' : f > 0.3 ? '#eab308' : '#ef4444'}` })),
      );
      grid.append(cell);
    }
    el.append(h('div', { class: 'info wide' }, h('div', { class: 'title' }, `${ents.length} seleccionados`), grid));
  }

  private hpLine(e: ClientEntity) {
    const f = Math.max(0, e.hp / e.mhp);
    return h('div', { class: 'hpline' }, h('div', { class: 'hpbar' }, h('div', { style: `width:${Math.round(f * 100)}%;background:${f > 0.6 ? '#22c55e' : f > 0.3 ? '#eab308' : '#ef4444'}` })), h('span', {}, `${e.hp}/${e.mhp}`));
  }

  // ------------------------------------------------------------------ órdenes
  private renderOrders() {
    const el = this.ordersEl;
    clear(el);
    const sel = this.host.selection;
    const units = sel.myUnits();
    const input = this.host.input;
    if (!units.length) {
      el.append(h('div', { class: 'section-title' }, 'Grupos'), this.groupButtons());
      return;
    }
    const btn = (label: string, key: string, active: boolean, fn: () => void, title: string) =>
      h('button', { class: `btn order ${active ? 'on' : ''}`, title: `${title} (${key})`, onclick: fn }, h('span', {}, label), h('kbd', {}, key));
    const ids = units.map((u) => u.id);
    el.append(
      h('div', { class: 'section-title' }, 'Órdenes'),
      h(
        'div',
        { class: 'grid' },
        btn('⚔ Atacar', 'A', input.commandMode === 'attack', () => input.setCommandMode(input.commandMode === 'attack' ? null : 'attack'), 'Ataque-movimiento: elige un punto o un enemigo'),
        btn('➜ Mover', 'M', input.commandMode === 'move', () => input.setCommandMode(input.commandMode === 'move' ? null : 'move'), 'Mover ignorando enemigos'),
        btn('■ Detener', 'X', false, () => input.orderSimple('stop'), 'Detener'),
        btn('⛨ Mantener', 'H', false, () => input.orderSimple('hold'), 'Mantener posición (solo ataca lo que esté a su alcance)'),
        btn('↩ Retirar', 'R', false, () => input.orderSimple('retreat'), 'Retirarse a la base'),
      ),
    );
    const current = units[0].pr ?? 'nearest';
    const select = h('select', { class: 'priority', title: 'Prioridad de objetivo al atacar automáticamente' }) as HTMLSelectElement;
    for (const [k, v] of Object.entries(PRIORITY_LABELS)) select.append(h('option', { value: k, selected: k === current }, v));
    select.addEventListener('change', () => this.host.send({ type: 'setPriority', unitIds: ids, priority: select.value as TargetPriority }));
    el.append(h('label', { class: 'prio-label' }, 'Prioridad: ', select), this.groupButtons());
  }

  private groupButtons(): HTMLElement {
    const sel = this.host.selection;
    const row = h('div', { class: 'groups' });
    for (let n = 1; n <= 3; n++) {
      const count = sel.groups.get(n)?.length ?? 0;
      const b = h('button', { class: 'btn small', title: `Grupo ${n}: clic para seleccionar, doble clic o mantener pulsado para guardar la selección actual (Ctrl/Shift+${n})` }, `${n}${count ? ` (${count})` : ''}`);
      let timer: number | undefined;
      let saved = false;
      const save = () => {
        sel.saveGroup(n);
        saved = true;
        toast(`Grupo ${n} guardado.`);
        this.lastKeys.orders = '';
      };
      b.addEventListener('pointerdown', () => {
        saved = false;
        timer = window.setTimeout(save, 550);
      });
      b.addEventListener('pointerup', () => {
        window.clearTimeout(timer);
        if (!saved) sel.recallGroup(n);
      });
      b.addEventListener('pointerleave', () => window.clearTimeout(timer));
      b.addEventListener('dblclick', save);
      row.append(b);
    }
    return row;
  }

  // ------------------------------------------------------------------ acciones (construir / entrenar / mejorar)
  private renderActions() {
    const el = this.actionsEl;
    clear(el);
    const w = this.host.world;
    if (w.spectator) {
      el.append(h('div', { class: 'empty' }, 'Has sido eliminado. Puedes seguir mirando la partida.'));
      return;
    }
    const buildings = this.host.selection.myBuildings();
    if (buildings.length === 1) return this.renderBuildingActions(buildings[0]);
    this.renderBuildMenu();
  }

  private actionButton(opts: { icon: string; label: string; cost?: Cost; disabledReason?: string | null; active?: boolean; onClick: () => void; title?: string }) {
    const priv = this.host.world.priv;
    const affordable = !opts.cost || !priv || canAffordCost(priv.resources, opts.cost);
    const reason = opts.disabledReason ?? (affordable ? null : 'Recursos insuficientes');
    const b = h(
      'button',
      {
        class: `btn action ${reason ? 'disabled' : ''} ${opts.active ? 'on' : ''}`,
        title: `${opts.title ?? opts.label}${opts.cost ? `\nCoste: ${costText(opts.cost)}` : ''}${reason ? `\n⚠ ${reason}` : ''}`,
        onclick: () => {
          if (reason) toast(reason, 'warn');
          else opts.onClick();
        },
      },
      h('img', { src: opts.icon, alt: '' }),
      h('span', { class: 'lbl' }, opts.label),
      opts.cost ? costChips(opts.cost) : null,
    );
    return b;
  }

  private renderBuildMenu() {
    const w = this.host.world;
    const input = this.host.input;
    const color = w.colorOf(w.me);
    const mine = [...w.entities.values()].filter((e) => e.k === 'building' && w.isMine(e));
    const grid = h('div', { class: 'grid actions-grid' });
    for (const t of BUILDING_TYPES) {
      const def = BUILDING_DEFS[t];
      if (!def.buildable) continue;
      const count = mine.filter((b) => b.t === t).length;
      const limit = def.maxCount !== undefined && count >= def.maxCount ? `Máximo ${def.maxCount}` : null;
      grid.append(
        this.actionButton({
          icon: iconFor('building', t, color),
          label: def.name,
          cost: def.cost,
          disabledReason: limit,
          active: input.placement === t,
          title: `${def.name}: ${def.description}\nTiempo: ${def.buildTime}s`,
          onClick: () => (input.placement === t ? input.cancelModes() : input.startPlacement(t)),
        }),
      );
    }
    this.actionsEl.append(h('div', { class: 'section-title' }, input.placement ? 'Elige dónde construir (Esc/clic derecho cancela)' : 'Construir'), grid);
  }

  private renderBuildingActions(b: ClientEntity) {
    const w = this.host.world;
    const def = BUILDING_DEFS[b.t as BuildingType];
    const color = w.colorOf(w.me);
    const grid = h('div', { class: 'grid actions-grid' });
    const busy = b.s !== 'active' ? (b.s === 'construction' ? 'En construcción' : 'Mejorando') : null;
    const level = b.l ?? 1;
    const priv = w.priv;
    const hasActive = (t: BuildingType) => [...w.entities.values()].some((e) => e.k === 'building' && w.isMine(e) && e.t === t && e.s !== 'construction');

    for (const u of def.trains ?? []) {
      const ud = UNIT_DEFS[u];
      let reason = busy;
      if (!reason && level < ud.requiresLevel) reason = `Requiere ${def.name} nivel ${ud.requiresLevel}`;
      if (!reason && ud.requiresBuilding && !hasActive(ud.requiresBuilding)) reason = `Requiere ${BUILDING_DEFS[ud.requiresBuilding].name}`;
      if (!reason && (b.q?.length ?? 0) >= GAME_CONFIG.maxQueue) reason = 'Cola llena';
      if (!reason && priv && priv.pop + ud.pop > priv.popCap) reason = 'Población máxima: construye granjas';
      grid.append(
        this.actionButton({
          icon: iconFor('unit', u, color),
          label: ud.name,
          cost: ud.cost,
          disabledReason: reason,
          title: `${ud.name}: ${ud.description}\nVida ${ud.hp} · Daño ${ud.damage} · Defensa ${ud.defense} · Velocidad ${ud.speed} · Alcance ${ud.range}\nTiempo: ${ud.trainTime}s · Población ${ud.pop}`,
          onClick: () => this.host.send({ type: 'train', buildingId: b.id, unit: u }),
        }),
      );
    }
    if (def.research) {
      for (const t of TECH_TYPES) {
        const td = TECH_DEFS[t];
        const lvl = priv?.tech[t] ?? 0;
        if (lvl >= td.maxLevel) {
          grid.append(this.actionButton({ icon: techIcon(t), label: `${td.name} ✓`, disabledReason: 'Completada', onClick: () => {} }));
          continue;
        }
        let reason = busy ?? (b.rs ? 'Investigación en curso' : null);
        if (!reason && level < td.requiresLevel[lvl]) reason = `Requiere centro tecnológico nivel ${td.requiresLevel[lvl]}`;
        grid.append(
          this.actionButton({
            icon: techIcon(t),
            label: `${td.name} ${lvl + 1}`,
            cost: td.cost[lvl],
            disabledReason: reason,
            title: `${td.name}: ${td.description}\nTiempo: ${td.time[lvl]}s`,
            onClick: () => this.host.send({ type: 'research', buildingId: b.id, tech: t }),
          }),
        );
      }
    }
    if (level < def.maxLevel) {
      grid.append(
        this.actionButton({
          icon: iconFor('building', b.t, color),
          label: `Mejorar a nivel ${level + 1}`,
          cost: def.upgradeCost[level - 1],
          disabledReason: busy ?? (b.rs ? 'Investigación en curso' : null),
          title: `Nivel ${level + 1}: ${def.levelInfo[level]}\nTiempo: ${def.upgradeTime[level - 1]}s`,
          onClick: () => this.host.send({ type: 'upgrade', buildingId: b.id }),
        }),
      );
    }
    if (b.q?.length) {
      grid.append(h('button', { class: 'btn action', title: 'Cancelar el último de la cola (devuelve los recursos)', onclick: () => this.host.send({ type: 'cancelTrain', buildingId: b.id }) }, h('span', { class: 'big' }, '✕'), h('span', { class: 'lbl' }, 'Cancelar')));
    }
    const hint = def.trains?.length ? 'Clic derecho en el mapa: punto de reunión' : b.hp < b.mhp ? 'Repara con recolectores (clic derecho sobre el edificio)' : '';
    this.actionsEl.append(h('div', { class: 'section-title' }, def.name, hint ? h('span', { class: 'hint' }, ` · ${hint}`) : null), grid);
    if (!grid.children.length) this.actionsEl.append(h('div', { class: 'empty' }, def.description));
  }
}

function techIcon(t: string): string {
  const glyph = t === 'weapons' ? '⚔' : t === 'armor' ? '🛡' : '⚒';
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = '30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(glyph, 32, 34);
  return c.toDataURL();
}

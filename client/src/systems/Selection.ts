import type { ClientEntity, ClientWorld } from './ClientWorld';

/** Selección actual y grupos de control (Ctrl+número para guardar, número para recuperar). */
export class Selection {
  ids = new Set<number>();
  groups = new Map<number, number[]>();
  version = 0;

  constructor(private readonly world: ClientWorld) {}

  set(ids: Iterable<number>) {
    this.ids = new Set(ids);
    this.version++;
  }

  toggle(id: number) {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.version++;
  }

  add(ids: Iterable<number>) {
    for (const id of ids) this.ids.add(id);
    this.version++;
  }

  clear() {
    if (this.ids.size === 0) return;
    this.ids.clear();
    this.version++;
  }

  /** Quita entidades que ya no existen. */
  prune() {
    let changed = false;
    for (const id of this.ids) {
      if (!this.world.entities.has(id)) {
        this.ids.delete(id);
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  entities(): ClientEntity[] {
    return [...this.ids].map((id) => this.world.entities.get(id)).filter((e): e is ClientEntity => !!e);
  }

  /** Unidades propias seleccionadas (las únicas a las que se puede dar órdenes). */
  myUnits(): ClientEntity[] {
    return this.entities().filter((e) => e.k === 'unit' && this.world.isMine(e));
  }

  myUnitIds(): number[] {
    return this.myUnits().map((e) => e.id);
  }

  myBuildings(): ClientEntity[] {
    return this.entities().filter((e) => e.k === 'building' && this.world.isMine(e));
  }

  saveGroup(n: number) {
    const ids = this.myUnitIds();
    if (ids.length) this.groups.set(n, ids);
  }

  recallGroup(n: number): boolean {
    const ids = (this.groups.get(n) ?? []).filter((id) => this.world.entities.has(id));
    this.groups.set(n, ids);
    if (!ids.length) return false;
    this.set(ids);
    return true;
  }
}

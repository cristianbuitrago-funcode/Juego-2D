/** Preferencias del jugador guardadas en el navegador (localStorage). */
export interface GameSettings {
  playerName: string;
  sfxVolume: number;
  musicVolume: number;
  edgeScroll: boolean;
  showHpAlways: boolean;
  cameraSpeed: number;
}

const KEY = 'frontera.settings';
const DEFAULTS: GameSettings = {
  playerName: '',
  sfxVolume: 0.6,
  musicVolume: 0.25,
  edgeScroll: true,
  showHpAlways: false,
  cameraSpeed: 1,
};

function load(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: GameSettings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* sin almacenamiento */
  }
}

// ---------------------------------------------------------------- progresión local
// PLACEHOLDER de progresión: estadísticas guardadas solo en este navegador.
// Una progresión real (cuentas, niveles en servidor) requiere base de datos y autenticación.
export interface LocalProfile {
  games: number;
  wins: number;
  kills: number;
  xp: number;
}

const PROFILE_KEY = 'frontera.profile';

export function loadProfile(): LocalProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? { games: 0, wins: 0, kills: 0, xp: 0, ...JSON.parse(raw) } : { games: 0, wins: 0, kills: 0, xp: 0 };
  } catch {
    return { games: 0, wins: 0, kills: 0, xp: 0 };
  }
}

export function recordGame(won: boolean, kills: number) {
  const p = loadProfile();
  p.games++;
  if (won) p.wins++;
  p.kills += kills;
  p.xp += 50 + (won ? 100 : 0) + kills * 5;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* nada */
  }
}

export function levelFromXp(xp: number): { level: number; progress: number } {
  // Cada nivel requiere 200 XP más que el anterior.
  let level = 1;
  let need = 200;
  let rest = xp;
  while (rest >= need) {
    rest -= need;
    level++;
    need += 200;
  }
  return { level, progress: rest / need };
}

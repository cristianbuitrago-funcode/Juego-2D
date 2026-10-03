/**
 * Arquitectura de sonido. Cada sonido tiene una clave; si existe un archivo en `files`
 * se reproduce ese archivo, si no se usa un PLACEHOLDER sintetizado con WebAudio.
 *
 * Para añadir sonidos reales: coloca los archivos en client/public/audio/ y rellena SOUND_FILES
 * (por ejemplo `select: 'audio/select.ogg'`). No hace falta tocar nada más.
 */
export type SoundKey =
  | 'select'
  | 'command'
  | 'attack'
  | 'arrow'
  | 'hit'
  | 'death'
  | 'build'
  | 'built'
  | 'trained'
  | 'notify'
  | 'error'
  | 'victory'
  | 'defeat'
  | 'alert';

export const SOUND_FILES: Partial<Record<SoundKey | 'music', string>> = {
  // music: 'audio/music.ogg',  // ← placeholder: aún no hay música real
};

type Synth = (ctx: AudioContext, out: GainNode) => void;

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.25, slide = 0): Synth {
  return (ctx, out) => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur);
  };
}

function noise(dur: number, vol = 0.2, filterFreq = 1200): Synth {
  return (ctx, out) => {
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(out);
    src.start(t);
  };
}

function seq(...parts: [Synth, number][]): Synth {
  return (ctx, out) => parts.forEach(([s, delay]) => setTimeout(() => s(ctx, out), delay));
}

const SYNTHS: Record<SoundKey, Synth> = {
  select: tone(660, 0.07, 'triangle', 0.12),
  command: tone(520, 0.08, 'square', 0.06, 120),
  attack: noise(0.08, 0.12, 2500),
  arrow: tone(900, 0.12, 'sine', 0.05, -500),
  hit: noise(0.06, 0.1, 900),
  death: tone(220, 0.35, 'sawtooth', 0.08, -150),
  build: seq([noise(0.05, 0.15, 600), 0], [noise(0.05, 0.15, 600), 140]),
  built: seq([tone(523, 0.12, 'triangle', 0.15), 0], [tone(784, 0.18, 'triangle', 0.15), 110]),
  trained: tone(740, 0.12, 'triangle', 0.12, 80),
  notify: tone(880, 0.1, 'sine', 0.1),
  error: tone(160, 0.15, 'square', 0.08),
  alert: seq([tone(440, 0.12, 'square', 0.08), 0], [tone(440, 0.12, 'square', 0.08), 200]),
  victory: seq([tone(523, 0.2, 'triangle', 0.2), 0], [tone(659, 0.2, 'triangle', 0.2), 180], [tone(784, 0.4, 'triangle', 0.2), 360]),
  defeat: seq([tone(392, 0.25, 'sine', 0.2), 0], [tone(330, 0.25, 'sine', 0.2), 220], [tone(262, 0.5, 'sine', 0.2), 440]),
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private lastPlayed = new Map<SoundKey, number>();
  private buffers = new Map<string, AudioBuffer>();
  private musicNodes: AudioScheduledSourceNode[] = [];
  sfxVolume = 0.6;
  musicVolume = 0.3;

  /** Debe llamarse tras un gesto del usuario (política de autoplay de los navegadores). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);
      this.musicGain.connect(this.ctx.destination);
      this.applyVolumes();
      for (const [key, url] of Object.entries(SOUND_FILES)) if (url) void this.load(key, url);
    } catch {
      this.ctx = null;
    }
  }

  private async load(key: string, url: string) {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      this.buffers.set(key, await this.ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      /* si falla, se usa el placeholder */
    }
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    this.applyVolumes();
  }

  private applyVolumes() {
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume;
    if (this.musicGain) this.musicGain.gain.value = this.musicVolume;
  }

  play(key: SoundKey, minIntervalMs = 60) {
    if (!this.ctx || !this.sfxGain || this.sfxVolume <= 0) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? 0) < minIntervalMs) return;
    this.lastPlayed.set(key, now);
    const buf = this.buffers.get(key);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.sfxGain);
      src.start();
      return;
    }
    SYNTHS[key](this.ctx, this.sfxGain);
  }

  /** Música: archivo si existe; si no, un acorde ambiental muy suave (placeholder). */
  startMusic() {
    if (!this.ctx || !this.musicGain || this.musicNodes.length) return;
    const buf = this.buffers.get('music');
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.musicNodes.push(src);
      return;
    }
    for (const f of [110, 164.8, 220]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.value = 0.025;
      lfo.frequency.value = 0.05 + f / 10000;
      lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain).connect(g.gain);
      o.connect(g).connect(this.musicGain);
      o.start();
      lfo.start();
      this.musicNodes.push(o, lfo);
    }
  }

  stopMusic() {
    for (const n of this.musicNodes) {
      try {
        n.stop();
      } catch {
        /* ya detenido */
      }
    }
    this.musicNodes = [];
  }
}

export const audio = new AudioManager();

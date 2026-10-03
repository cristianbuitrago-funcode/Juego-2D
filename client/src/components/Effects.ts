import { GAME_CONFIG } from '@shared/config/gameConfig';

const TILE = GAME_CONFIG.tileSize;

interface Projectile {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  start: number;
  dur: number;
  kind: 'arrow' | 'bolt';
}
interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  start: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  start: number;
  life: number;
  color: string;
  size: number;
}
interface Marker {
  x: number;
  y: number;
  start: number;
  color: string;
}
interface Slash {
  x: number;
  y: number;
  angle: number;
  start: number;
}

/** Efectos visuales puramente cosméticos (no afectan a la simulación). */
export class Effects {
  private projectiles: Projectile[] = [];
  private texts: FloatText[] = [];
  private particles: Particle[] = [];
  private markers: Marker[] = [];
  private slashes: Slash[] = [];

  projectile(x1: number, y1: number, x2: number, y2: number, kind: 'arrow' | 'bolt', now: number) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    this.projectiles.push({ x1, y1, x2, y2, start: now, dur: 80 + d * 45, kind });
  }

  slash(x: number, y: number, angle: number, now: number) {
    this.slashes.push({ x, y, angle, start: now });
  }

  damage(x: number, y: number, amount: number, now: number, color = '#fecaca') {
    this.texts.push({ x: x + (Math.random() - 0.5) * 0.4, y, text: `-${amount}`, color, start: now });
  }

  text(x: number, y: number, text: string, color: string, now: number) {
    this.texts.push({ x, y, text, color, start: now });
  }

  burst(x: number, y: number, color: string, count: number, now: number, speed = 2.5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.3 + Math.random()) * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, start: now, life: 450 + Math.random() * 400, color, size: 2 + Math.random() * 3 });
    }
  }

  marker(x: number, y: number, color: string, now: number) {
    this.markers.push({ x, y, start: now, color });
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    // Marcadores de orden
    this.markers = this.markers.filter((m) => now - m.start < 600);
    for (const m of this.markers) {
      const t = (now - m.start) / 600;
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(m.x * TILE, m.y * TILE, 4 + t * 12, (4 + t * 12) * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Proyectiles
    this.projectiles = this.projectiles.filter((p) => now - p.start < p.dur);
    for (const p of this.projectiles) {
      const t = (now - p.start) / p.dur;
      const pos = (k: number) => ({
        x: (p.x1 + (p.x2 - p.x1) * k) * TILE,
        y: (p.y1 + (p.y2 - p.y1) * k) * TILE - Math.sin(k * Math.PI) * 10,
      });
      const { x, y } = pos(t);
      const ahead = pos(Math.min(1, t + 0.03));
      const ang = Math.atan2(ahead.y - y, ahead.x - x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      if (p.kind === 'arrow') {
        ctx.strokeStyle = '#3f2a14';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(5, 0);
        ctx.stroke();
        ctx.fillStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(3, -2.5);
        ctx.lineTo(3, 2.5);
        ctx.fill();
      } else {
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(253, 230, 138, 0.35)';
        ctx.beginPath();
        ctx.arc(-4, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Tajos cuerpo a cuerpo
    this.slashes = this.slashes.filter((s) => now - s.start < 200);
    for (const s of this.slashes) {
      const t = (now - s.start) / 200;
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - t)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x * TILE, s.y * TILE, 10, s.angle - 1 + t, s.angle + 0.2 + t);
      ctx.stroke();
    }

    // Partículas
    this.particles = this.particles.filter((p) => now - p.start < p.life);
    for (const p of this.particles) {
      const age = (now - p.start) / 1000;
      const t = (now - p.start) / p.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillRect((p.x + p.vx * age) * TILE, (p.y + p.vy * age + 2 * age * age) * TILE, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Textos flotantes
    this.texts = this.texts.filter((t) => now - t.start < 900);
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.texts) {
      const t = (now - f.start) / 900;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(f.text, f.x * TILE + 1, f.y * TILE - 14 - t * 18 + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x * TILE, f.y * TILE - 14 - t * 18);
    }
    ctx.globalAlpha = 1;
  }
}

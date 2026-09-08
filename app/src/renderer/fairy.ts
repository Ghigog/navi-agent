/**
 * The fairy renderer — canvas, carried over from the NAV-94 spike (`spike/fairy.js`).
 *
 * ADR 0001 measured this against FairyVisuals.gd's 520 lines of Godot drawing: mean frame
 * 0.208 ms, p99 0.6 ms, ~28x headroom against a 60fps budget on CPU raster with no GPU.
 * Rendering was never a reason to stay in Godot.
 */

export const PARTICLE_COUNT = 48;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface StatusLight extends Rgb {
  pulsing: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Triforce emotion tint (emotions.md): courage→green, wisdom→blue, power→red, with overall
 * brightness carrying the love meter. A withdrawn Navi is visibly dimmer.
 */
export function emotionColor(courage: number, wisdom: number, power: number, love: number): Rgb {
  const n = (v: number): number => clamp01((v + 10) / 20);
  const bright = 0.45 + 0.55 * clamp01((love + 1000) / 2000);
  return {
    r: Math.round(255 * n(power) * bright),
    g: Math.round(255 * n(courage) * bright),
    b: Math.round(255 * n(wisdom) * bright),
  };
}

export interface Fairy {
  draw(t: number, dt: number): void;
  setTint(c: Rgb): void;
  setStatusLight(c: StatusLight | null): void;
  readonly particleCount: number;
}

interface Particle {
  a: number;
  r: number;
  speed: number;
  size: number;
  life: number;
}

export interface FairyOptions {
  dpr?: number;
  size?: number;
  tint?: Rgb;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

export function createFairy(canvas: HTMLCanvasElement, opts: FairyOptions = {}): Fairy {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('2d canvas context unavailable');

  const dpr = opts.dpr ?? globalThis.devicePixelRatio ?? 1;
  const size = opts.size ?? 200;
  const rand = opts.random ?? Math.random;

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;

  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
    a: rand() * Math.PI * 2,
    r: 8 + rand() * 26,
    speed: 0.15 + rand() * 0.5,
    size: 0.6 + rand() * 1.9,
    life: rand(),
  }));

  let tint: Rgb = opts.tint ?? { r: 102, g: 178, b: 255 };
  let statusLight: StatusLight | null = null;

  function draw(t: number, dt: number): void {
    ctx!.clearRect(0, 0, size, size);
    const { r, g, b } = tint;
    const breathe = 1 + Math.sin(t * 0.0022) * 0.06;

    // Aura
    const aura = ctx!.createRadialGradient(cx, cy, 2, cx, cy, 42 * breathe);
    aura.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
    aura.addColorStop(0.5, `rgba(${r},${g},${b},0.16)`);
    aura.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx!.fillStyle = aura;
    ctx!.beginPath();
    ctx!.arc(cx, cy, 42 * breathe, 0, Math.PI * 2);
    ctx!.fill();

    // Wings — two arcs flapping out of phase
    const flap = Math.sin(t * 0.011);
    ctx!.save();
    ctx!.globalCompositeOperation = 'lighter';
    for (const dir of [-1, 1]) {
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(dir * (0.5 + flap * 0.42));
      ctx!.beginPath();
      ctx!.ellipse(dir * 12, -4, 15, 7.5, 0, 0, Math.PI * 2);
      ctx!.fillStyle = `rgba(255,255,255,${0.16 + Math.abs(flap) * 0.2})`;
      ctx!.fill();
      ctx!.restore();
    }
    ctx!.restore();

    // Orbiting particles
    ctx!.save();
    ctx!.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      p.a += p.speed * dt * 0.001;
      p.life += dt * 0.0006;
      if (p.life > 1) p.life -= 1;
      const wob = Math.sin(t * 0.003 + p.a * 3) * 3;
      const px = cx + Math.cos(p.a) * (p.r + wob);
      const py = cy + Math.sin(p.a) * (p.r + wob) * 0.8;
      const alpha = 0.25 + Math.sin(p.life * Math.PI) * 0.6;
      ctx!.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      ctx!.beginPath();
      ctx!.arc(px, py, p.size, 0, Math.PI * 2);
      ctx!.fill();
    }
    ctx!.restore();

    // Core
    const core = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 9 * breathe);
    core.addColorStop(0, 'rgba(255,255,255,0.98)');
    core.addColorStop(0.45, `rgba(${r},${g},${b},0.92)`);
    core.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx!.fillStyle = core;
    ctx!.beginPath();
    ctx!.arc(cx, cy, 9 * breathe, 0, Math.PI * 2);
    ctx!.fill();

    // Status light above the core (amber = tool running, purple = thinking)
    if (statusLight) {
      const pulse = statusLight.pulsing ? 0.5 + Math.abs(Math.sin(t * 0.006)) * 0.5 : 1;
      ctx!.fillStyle = `rgba(${statusLight.r},${statusLight.g},${statusLight.b},${pulse.toFixed(3)})`;
      ctx!.beginPath();
      ctx!.arc(cx, cy - 22, 3.2, 0, Math.PI * 2);
      ctx!.fill();
    }
  }

  return {
    draw,
    setTint: (c) => {
      tint = c;
    },
    setStatusLight: (c) => {
      statusLight = c;
    },
    get particleCount() {
      return particles.length;
    },
  };
}

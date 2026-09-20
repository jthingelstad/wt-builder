/**
 * The fun part. A tick on the progress strip turning green gets a small burst
 * of confetti from where it sits; the last one gets the whole strip.
 *
 * PixiJS is loaded on the first burst, never up front: the client is ~100 KB
 * and Pixi is several times that, and an issue can be edited for an hour
 * before anything completes. One transparent canvas over the page, pointer
 * events off, torn down a few seconds after the last particle lands.
 * (Jamie, 2026-09-20: "This is my app and I like fun things.")
 */

type Pixi = typeof import('pixi.js');

interface Particle {
  g: import('pixi.js').Graphics;
  vx: number;
  vy: number;
  spin: number;
  life: number;
  ttl: number;
}

const PALETTE = [0x2f7d4f, 0x5aa76f, 0x9bcaa8, 0xd6e8dc, 0xf2b84b, 0x1a1a1a];

let pixi: Pixi | null = null;
let app: import('pixi.js').Application | null = null;
let particles: Particle[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let starting: Promise<void> | null = null;

async function ensureApp(): Promise<void> {
  if (app) return;
  if (starting) return starting;
  starting = (async () => {
    pixi ??= await import('pixi.js');
    const a = new pixi.Application();
    await a.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    const canvas = a.canvas as HTMLCanvasElement;
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000';
    document.body.appendChild(canvas);
    a.ticker.add((t) => step(t.deltaMS));
    app = a;
  })();
  try { await starting; } finally { starting = null; }
}

function step(dt: number): void {
  if (!app) return;
  const dts = dt / 16.667;
  const floor = window.innerHeight + 40;
  particles = particles.filter((p) => {
    p.life += dt;
    p.vy += 0.32 * dts;             // gravity
    p.vx *= 0.985;                  // drag
    p.g.x += p.vx * dts;
    p.g.y += p.vy * dts;
    p.g.rotation += p.spin * dts;
    p.g.alpha = Math.max(0, 1 - Math.max(0, (p.life - p.ttl * 0.6) / (p.ttl * 0.4)));
    const alive = p.life < p.ttl && p.g.y < floor;
    if (!alive) p.g.destroy();
    return alive;
  });
  if (!particles.length) scheduleTeardown();
}

function scheduleTeardown(): void {
  if (idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (particles.length || !app) return;
    app.canvas.remove();
    app.destroy(true);
    app = null;
  }, 4000);
}

function spawn(x: number, y: number, count: number, spread: number, power: number): void {
  if (!app || !pixi) return;
  for (let i = 0; i < count; i++) {
    const g = new pixi.Graphics();
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
    const size = 3 + Math.random() * 5;
    if (Math.random() < 0.5) g.rect(-size / 2, -size / 2, size, size * 0.6).fill(color);
    else g.circle(0, 0, size / 2).fill(color);
    g.x = x;
    g.y = y;
    // Up and out: an angle in the top half-plane, widened by `spread`.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = power * (0.5 + Math.random());
    app.stage.addChild(g);
    particles.push({
      g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: (Math.random() - 0.5) * 0.3,
      life: 0,
      ttl: 900 + Math.random() * 700,
    });
  }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

/** One tick turned green: a small burst from its centre. */
export async function burstAt(x: number, y: number): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  await ensureApp();
  spawn(x, y, 22, Math.PI * 0.9, 7);
}

/** Every tick is green: the strip erupts, left to right. */
export async function celebrateStrip(rect: DOMRect): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  await ensureApp();
  const y = rect.top + rect.height / 2;
  const columns = 9;
  for (let i = 0; i < columns; i++) {
    const x = rect.left + (rect.width * (i + 0.5)) / columns;
    setTimeout(() => spawn(x, y, 30, Math.PI * 1.1, 10), i * 60);
  }
}

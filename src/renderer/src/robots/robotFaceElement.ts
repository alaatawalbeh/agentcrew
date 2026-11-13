// Animated pixel face, <robot-face state hue size>: a typed port of design/robot-face.js (the design's animation).
// Drawing is unchanged. What's different from the original:
//   - honours prefers-reduced-motion: one still frame per state, no blinking, glitching or eye-tracking
//   - uses the screen's pixel density (1–3x) instead of a fixed 2x
//   - an invalid hue falls back to the default amber instead of drawing black
//   - the canvas is hidden from screen readers (the row or header next to it carries the label)
//   - an unknown state is drawn as idle; a no-op expression is gone
// Everything is drawn on a canvas, so it needs nothing from the CSP beyond the app's own script.

export type FaceState = 'idle' | 'ready' | 'thinking' | 'speaking' | 'approval' | 'error' | 'done';

type RGB = [number, number, number];
type Px = readonly (readonly [number, number])[];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const BG: RGB = [20, 17, 14];
const WHITE: RGB = [255, 246, 232];
const RED: RGB = [229, 83, 61];
const YEL: RGB = [245, 197, 66];
const DEFAULT_HUE: RGB = [240, 166, 74];
const GLOW: Record<FaceState, number> = { idle: 0.22, ready: 0.45, thinking: 0.55, speaking: 0.75, approval: 0.65, error: 0.5, done: 0.6 };
const WOB: Record<FaceState, number> = { idle: 0.15, ready: 0.3, thinking: 0.5, speaking: 1.1, approval: 0.35, error: 0.6, done: 0.35 };
const STATES = new Set<string>(Object.keys(GLOW));
const FPS = 12;

const DONE_EYE: Px = [[0, 1], [1, 0], [2, 1]];
const DONE_EYE_BIG: Px = [[0, 2], [2, 2]];
const ERROR_EYE: Px = [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]];
const ZZZ: Px = [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]];
const SPARKLES: readonly (readonly [number, number, number])[] = [[0.84, 0.16, 0], [0.14, 0.8, 1], [0.88, 0.78, 2]];

function hex(value: string | null): RGB {
  let h = (value ?? '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return DEFAULT_HUE;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const pack = (c: RGB) => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;

const instances = new Set<RobotFaceElement>();
let mouseX = -1e4;
let mouseY = -1e4;
let running = false;
let reducedMotion = false;

class RobotFaceElement extends HTMLElement {
  // Internal fields must not share a name with an attribute (state, hue, size): React 19 sets a custom element's
  // property instead of its attribute when a property by that name exists.
  static get observedAttributes() {
    return ['state', 'hue', 'size'];
  }

  rect: DOMRect | null = null;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d');
  private readonly off = document.createElement('canvas');
  private readonly offCtx = this.off.getContext('2d');
  private img: ImageData | null = null;
  private buf: Uint32Array | null = null;
  private pxSize = 0;
  private pxRatio = 0;
  private lx = 0;
  private ly = 0;
  private readonly t0 = Math.random() * 100;
  private frame = -1;
  private blinkAt = performance.now() + 1500 + Math.random() * 3000;

  constructor() {
    super();
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  connectedCallback() {
    this.style.display = 'block';
    this.style.lineHeight = '0';
    if (!this.canvas.parentNode) this.appendChild(this.canvas);
    this.resize();
    instances.add(this);
    startLoop();
  }

  disconnectedCallback() {
    instances.delete(this);
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.resize();
      this.frame = -1;
    }
  }

  forceRedraw() {
    this.frame = -1;
  }

  private resize() {
    const s = Number(this.getAttribute('size')) || 64;
    const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 2)));
    if (s === this.pxSize && dpr === this.pxRatio) return;
    this.pxSize = s;
    this.pxRatio = dpr;
    this.canvas.width = Math.round(s * dpr);
    this.canvas.height = Math.round(s * dpr);
    this.canvas.style.width = `${s}px`;
    this.canvas.style.height = `${s}px`;
    this.style.width = `${s}px`;
    this.style.height = `${s}px`;
  }

  draw(now: number) {
    if (!this.ctx || !this.offCtx) return;
    const still = reducedMotion;
    const f = still ? 0 : Math.floor((now / 1000) * FPS);
    if (f === this.frame) return;
    this.frame = f;
    const t = still ? this.t0 : now / 1000 + this.t0;
    const chunky = document.documentElement.dataset.pixelGrid === 'chunky';
    const s = this.pxSize;
    const big = s >= 120;
    const N = big ? (chunky ? 24 : 32) : chunky ? 14 : 20;
    if (this.off.width !== N || !this.buf || !this.img) {
      this.off.width = N;
      this.off.height = N;
      this.img = this.offCtx.createImageData(N, N);
      this.buf = new Uint32Array(this.img.data.buffer);
    }
    const buf = this.buf;
    buf.fill(0);
    const raw = this.getAttribute('state') ?? 'idle';
    const st: FaceState = STATES.has(raw) ? (raw as FaceState) : 'idle';
    let hue = hex(this.getAttribute('hue'));
    const blinkOn = still || Math.floor(t * 3) % 2 === 0;
    if (st === 'error') hue = mix(hue, RED, 0.8);
    if (st === 'approval') hue = mix(hue, YEL, blinkOn ? 0.85 : 0.5);
    const dim = st === 'idle' ? 1 : 0;
    const T = [mix(hue, BG, 0.84), mix(hue, BG, 0.62), mix(hue, BG, 0.34), hue, mix(hue, WHITE, 0.62)].map(pack) as [
      number,
      number,
      number,
      number,
      number,
    ];
    const tone = (i: number) => T[Math.max(0, Math.min(4, i)) as 0 | 1 | 2 | 3 | 4];
    const eyeC = pack(st === 'error' ? mix(RED, WHITE, 0.35) : mix(hue, WHITE, 0.82));
    const put = (px: number, py: number, color: number) => {
      const x = px | 0;
      const y = py | 0;
      if (x >= 0 && y >= 0 && x < N && y < N) buf[y * N + x] = color;
    };

    // Body: a wobbling, dithered orb with a glow around it.
    const c = (N - 1) / 2;
    const R0 = N * 0.32 * (1 + (st === 'idle' ? 0.04 : 0.025) * Math.sin(t * (st === 'idle' ? 1.2 : 2.4)));
    const wob = WOB[st];
    const glow = GLOW[st] * (st === 'approval' && blinkOn ? 1.3 : 1);
    const halo = N * 0.13;
    const shift = new Int8Array(N);
    if (!still && st === 'error' && f % 7 < 3) {
      for (let i = 0; i < 3; i++) {
        const y = (Math.random() * N) | 0;
        for (let k = 0; k < 1 + ((Math.random() * 2) | 0); k++) if (y + k < N) shift[y + k] = ((Math.random() * 5) | 0) - 2;
      }
    }
    const amp = st === 'speaking' ? 0.6 + 0.4 * Math.abs(Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1)) : 1;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const sx = x - (shift[y] ?? 0);
        const dx = sx - c;
        const dy = y - c;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const r = R0 + wob * amp * (Math.sin(a * 3 + t * 2.3) * 0.7 + Math.sin(a * 5 - t * 3.1) * 0.45);
        const th = BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5;
        if (d <= r) {
          if (d > r - 1.15) {
            put(x, y, tone((dx + dy < r * 0.4 ? 3 : 2) - dim));
            continue;
          }
          let v = 0.12 + 0.5 * Math.pow(d / r, 2);
          const sd = Math.hypot(dx + r * 0.42, dy + r * 0.42);
          if (sd < r * 0.14) v = 1.4;
          else if (sd < r * 0.3) v += 0.3;
          put(x, y, tone(Math.floor(v * 3 + th) - dim));
        } else if (d < r + halo) {
          const fr = 1 - (d - r) / halo;
          if (th < fr * fr * glow) put(x, y, tone((fr > 0.6 ? 1 : 0) + (st === 'speaking' && fr > 0.6 ? 1 : 0) - dim));
        }
      }
    }

    // Eyes look towards the pointer (up and swaying while thinking).
    let tx = 0;
    let ty = 0;
    const rect = this.rect;
    if (!still && rect && mouseX > -1e3) {
      const sc = rect.width / s || 1;
      const ddx = mouseX - (rect.left + rect.width / 2);
      const ddy = mouseY - (rect.top + rect.height / 2);
      const dist = Math.hypot(ddx, ddy) || 1;
      const m = Math.min(1, dist / (220 * sc));
      tx = (ddx / dist) * m;
      ty = (ddy / dist) * m;
    }
    if (st === 'thinking') {
      tx = still ? 0 : Math.sin(t * 1.3) * 0.8;
      ty = -1;
    }
    if (st === 'idle' || st === 'error') {
      tx *= 0.2;
      ty *= 0.2;
    }
    if (still) {
      this.lx = tx;
      this.ly = ty;
    } else {
      this.lx += (tx - this.lx) * 0.5;
      this.ly += (ty - this.ly) * 0.5;
    }
    const maxO = big ? 2 : 1;
    const ox = Math.round(this.lx * maxO);
    const oy = Math.round(this.ly * maxO);

    const nowMs = performance.now();
    let blink = false;
    if (!still && nowMs > this.blinkAt) {
      if (nowMs - this.blinkAt > 140) this.blinkAt = nowMs + 2200 + Math.random() * 3500;
      else blink = true;
    }

    const H = N / 2;
    const sp = big ? 3 : 2;
    const ew = 2;
    const eh = big ? 4 : 3;
    const ey = Math.round(H - (big ? 3 : 2)) + oy;
    [H - sp - ew + ox, H + sp + ox].forEach((ex, side) => {
      const left = side ? 0 : 1;
      if (st === 'idle') {
        for (let i = 0; i < ew + 1; i++) put(ex - left + i, ey + eh - 1, T[3]);
        return;
      }
      if (st === 'done') {
        for (const [px, py] of DONE_EYE) put(ex - left + px, ey + py + 1, eyeC);
        if (big) for (const [px, py] of DONE_EYE_BIG) put(ex - left + px, ey + py + 1, eyeC);
        return;
      }
      if (st === 'error') {
        for (const [px, py] of ERROR_EYE) put(ex - left + px, ey + py, eyeC);
        return;
      }
      const h = blink ? 1 : eh + (st === 'approval' ? 1 : 0);
      const y0 = ey + (eh - h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < ew; xx++) put(ex + xx, y0 + yy, eyeC);
      if (big && !blink) put(ex + (side ? 0 : 1), y0, T[2]);
    });

    // Mouth.
    const my0 = Math.round(H + (big ? 3 : 2)) + oy;
    if (st === 'speaking') {
      const w = big ? 6 : 4;
      for (let i = 0; i < w; i++) {
        const jitter = still ? 0 : Math.random() * 0.6;
        const hgt = Math.round((Math.sin(t * 15 + i * 1.9) * 0.5 + 0.5) * (big ? 2 : 1) * amp + jitter);
        for (let k = -hgt; k <= hgt; k++) put(H - w / 2 + i + ox, my0 + k, T[4]);
      }
    } else if (st === 'done') {
      const w = big ? 3 : 2;
      put(H - w + ox, my0, T[4]);
      put(H + w - 1 + ox, my0, T[4]);
      for (let i = -w + 1; i < w - 1; i++) put(H + i + ox, my0 + 1, T[4]);
    } else if (st === 'error') {
      const w = big ? 6 : 4;
      for (let i = 0; i < w; i++) put(H - w / 2 + i + ox, my0 + (i % 2), T[4]);
    } else if (st === 'approval') {
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) put(H - 1 + xx + ox, my0 + yy, T[4]);
    } else if (st === 'ready') {
      put(H - 1 + ox, my0, T[3]);
      put(H + ox, my0, T[3]);
    }

    // Extras: orbiting dots, a sleeping "z", the approval "!", sparkles, glitch noise.
    if (st === 'thinking') {
      const rr = R0 + (big ? 2.5 : 2);
      for (let i = 0; i < 4; i++) {
        const a = t * 4.2 - i * 0.32;
        put(Math.round(c + Math.cos(a) * rr), Math.round(c + Math.sin(a) * rr), tone(4 - i));
        const b = a + Math.PI;
        put(Math.round(c + Math.cos(b) * rr), Math.round(c + Math.sin(b) * rr), tone(3 - i));
      }
    }
    if (st === 'idle') {
      const ph = (t * 0.5) % 1;
      const zx = Math.round(N * 0.72 + ph * 2);
      const zy = Math.round(N * 0.26 - ph * N * 0.18);
      if (ph < 0.85) for (const [px, py] of ZZZ) put(zx + px, zy + py, ph > 0.6 ? T[2] : T[3]);
    }
    if (st === 'approval' && blinkOn) {
      const ax = Math.round(N * 0.8);
      const ay = Math.round(N * 0.08);
      for (let i = 0; i < (big ? 4 : 3); i++) put(ax, ay + i, T[4]);
      put(ax, ay + (big ? 5 : 4), T[4]);
    }
    if (st === 'done') {
      for (const [px, py, k] of SPARKLES) {
        if ((f + k * 4) % 12 > 6) continue;
        const sx = Math.round(N * px);
        const sy = Math.round(N * py);
        put(sx, sy, T[4]);
        if (big || (f + k) % 2) {
          put(sx - 1, sy, T[3]);
          put(sx + 1, sy, T[3]);
          put(sx, sy - 1, T[3]);
          put(sx, sy + 1, T[3]);
        }
      }
    }
    if (!still && st === 'error' && f % 5 === 0) for (let i = 0; i < 4; i++) put(Math.random() * N, Math.random() * N, T[3]);

    this.offCtx.putImageData(this.img, 0, 0);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }
}

function loop(now: number) {
  const vh = innerHeight;
  const vw = innerWidth;
  for (const el of instances) {
    const r = el.getBoundingClientRect();
    el.rect = r;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || !r.width) continue;
    el.draw(now);
  }
  if (instances.size) requestAnimationFrame(loop);
  else running = false;
}

function startLoop() {
  if (running) return;
  running = true;
  requestAnimationFrame(loop);
}

/** Registers <robot-face> once. Safe to call more than once. */
export function defineRobotFace(): void {
  if (customElements.get('robot-face')) return;
  window.addEventListener(
    'mousemove',
    (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
    },
    { passive: true },
  );
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  reducedMotion = motion?.matches ?? false;
  motion?.addEventListener?.('change', (event) => {
    reducedMotion = event.matches;
    for (const el of instances) el.forceRedraw();
  });
  customElements.define('robot-face', RobotFaceElement);
}

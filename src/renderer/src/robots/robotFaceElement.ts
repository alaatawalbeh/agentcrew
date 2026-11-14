// Animated pixel face, <robot-face state hue size robot>: grown from design/robot-face.js (the design's animation).
// Every face is a dithered, wobbling head with a glow, drawn on a small pixel grid. The `robot` attribute picks the
// robot's personality (personality.ts): its head shape, eyes, mouth and headgear, how it thinks, sleeps, celebrates,
// asks for you and breaks down, and the fidgets it does while it waits, so no two robots move alike.
// Kept from the first port:
//   - honours prefers-reduced-motion: one still frame per state, no blinking, fidgets, hops or eye-tracking
//   - uses the screen's pixel density (1–3x)
//   - an invalid hue falls back to the default amber; an unknown state is drawn as idle
//   - the canvas is hidden from screen readers (the row or header next to it carries the label)
// Everything is drawn on a canvas, so it needs nothing from the CSP beyond the app's own script.
import { personalityFor, type Fidget, type Personality } from './personality';

export type FaceState = 'idle' | 'ready' | 'thinking' | 'speaking' | 'approval' | 'error' | 'done';

type RGB = [number, number, number];
type Px = readonly (readonly [number, number])[];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const BG: RGB = [20, 17, 14];
const WHITE: RGB = [255, 246, 232];
const RED: RGB = [229, 83, 61];
const YEL: RGB = [245, 197, 66];
const GREY: RGB = [150, 140, 128];
const HEART: RGB = [240, 104, 118];
const CONFETTI: readonly RGB[] = [
  [245, 197, 66],
  [111, 207, 151],
  [139, 147, 255],
  [229, 143, 200],
  [111, 183, 224],
  [255, 246, 232],
];
const DEFAULT_HUE: RGB = [240, 166, 74];
const GLOW: Record<FaceState, number> = { idle: 0.22, ready: 0.45, thinking: 0.55, speaking: 0.75, approval: 0.65, error: 0.5, done: 0.6 };
const WOB: Record<FaceState, number> = { idle: 0.15, ready: 0.3, thinking: 0.5, speaking: 1.1, approval: 0.35, error: 0.6, done: 0.35 };
const STATES = new Set<string>(Object.keys(GLOW));
const FPS = 12;
const BLINK_MS = 140;
const FIDGET_MS: Record<Fidget, number> = { glance: 900, hop: 420, wink: 260, wiggle: 520, 'look-up': 1100 };

const DONE_EYE: Px = [[0, 1], [1, 0], [2, 1]];
const DONE_EYE_BIG: Px = [[0, 2], [2, 2]];
const DONE_EYE_WIDE: Px = [[0, 2], [1, 1], [2, 1], [3, 2]];
const ERROR_EYE: Px = [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]];
const ERROR_EYE_WIDE: Px = [[0, 0], [3, 0], [1, 1], [2, 1], [1, 2], [2, 2], [0, 3], [3, 3]];
const ZZZ: Px = [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]];
const QUESTION: Px = [[0, 0], [1, 0], [2, 1], [1, 2], [1, 4]];
const HEART_PX: Px = [[1, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [2, 3]];
const SPARKLES: readonly (readonly [number, number, number])[] = [[0.84, 0.16, 0], [0.14, 0.8, 1], [0.88, 0.78, 2]];
const STARS: readonly (readonly [number, number])[] = [[0.12, 0.14], [0.86, 0.1], [0.08, 0.6], [0.9, 0.55]];

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
const sign = (v: number) => (v > 0.35 ? 1 : v < -0.35 ? -1 : 0);

const instances = new Set<RobotFaceElement>();
let mouseX = -1e4;
let mouseY = -1e4;
let running = false;
let reducedMotion = false;

class RobotFaceElement extends HTMLElement {
  // Internal fields must not share a name with an attribute (state, hue, size, robot): React 19 sets a custom
  // element's property instead of its attribute when a property by that name exists.
  static get observedAttributes() {
    return ['state', 'hue', 'size', 'robot'];
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
  private persona: Personality = personalityFor(null);
  private blinkAt = performance.now() + 1500 + Math.random() * 3000;
  private fidgetAt = performance.now() + 2500 + Math.random() * 5000;
  private fidget: { kind: Fidget; from: number; until: number; side: number } | null = null;

  constructor() {
    super();
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  connectedCallback() {
    this.style.display = 'block';
    this.style.lineHeight = '0';
    if (!this.canvas.parentNode) this.appendChild(this.canvas);
    this.persona = personalityFor(this.getAttribute('robot'));
    this.resize();
    instances.add(this);
    startLoop();
  }

  disconnectedCallback() {
    instances.delete(this);
  }

  attributeChangedCallback(name: string) {
    if (name === 'robot') this.persona = personalityFor(this.getAttribute('robot'));
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

  /** Blinks (both eyes, or one for a wink) and fidgets, on their own clocks. */
  private moods(st: FaceState, nowMs: number): { blinkL: boolean; blinkR: boolean; fidget: Fidget | null; side: number; k: number } {
    const P = this.persona;
    let blink = false;
    if (nowMs >= this.blinkAt) {
      if (nowMs - this.blinkAt > BLINK_MS) {
        const [lo, hi] = P.blinkEvery;
        const twice = P.doubleBlink && Math.random() < 0.35;
        this.blinkAt = nowMs + (twice ? 90 : lo + Math.random() * (hi - lo));
      } else blink = true;
    }

    const fidgety = st === 'ready' || st === 'done' || st === 'thinking' || st === 'speaking';
    if (this.fidget && (nowMs > this.fidget.until || !fidgety)) this.fidget = null;
    if (fidgety && !this.fidget && nowMs > this.fidgetAt && P.fidgets.length) {
      // Busy robots only hop, wink or wiggle; their eyes are on their work.
      const busy = st === 'thinking' || st === 'speaking';
      const choices = busy ? P.fidgets.filter((k) => k === 'hop' || k === 'wink' || k === 'wiggle') : P.fidgets;
      const kind = choices[Math.floor(Math.random() * choices.length)];
      const [lo, hi] = P.fidgetEvery;
      this.fidgetAt = nowMs + (lo + Math.random() * (hi - lo)) * 1000;
      if (kind) this.fidget = { kind, from: nowMs, until: nowMs + FIDGET_MS[kind], side: Math.random() < 0.5 ? -1 : 1 };
    }
    const f = this.fidget;
    const wink = f?.kind === 'wink';
    return {
      blinkL: blink || (wink && f.side < 0),
      blinkR: blink || (wink && f.side > 0),
      fidget: f?.kind ?? null,
      side: f?.side ?? 1,
      k: f ? Math.min(1, (nowMs - f.from) / (f.until - f.from)) : 0,
    };
  }

  draw(now: number) {
    if (!this.ctx || !this.offCtx) return;
    const P = this.persona;
    const still = reducedMotion;
    const f = still ? 0 : Math.floor((now / 1000) * FPS);
    if (f === this.frame) return;
    this.frame = f;
    const t = still ? this.t0 : now / 1000 + this.t0;
    /** Animation time: lively robots run faster. */
    const ta = t * P.tempo;
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
    const blinkOn = still || Math.floor(ta * 3) % 2 === 0;
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
    const pupilC = pack(mix(BG, hue, 0.12));
    const put = (px: number, py: number, color: number) => {
      const x = Math.round(px);
      const y = Math.round(py);
      if (x >= 0 && y >= 0 && x < N && y < N) buf[y * N + x] = color;
    };
    const nowMs = performance.now();
    const mood = still
      ? { blinkL: false, blinkR: false, fidget: null, side: 1, k: 0 }
      : this.moods(st, nowMs);

    // ---------- the whole head moves: hops, nods, bounces, wiggles ----------
    let bxf = 0;
    let byf = 0;
    let squash = 0;
    if (!still) {
      if (st === 'done' && P.done === 'hop') {
        const ph = (ta * 0.7) % 1;
        if (ph < 0.3) byf = -Math.sin((ph / 0.3) * Math.PI) * (big ? 3 : 2);
        else if (ph < 0.36) squash = 0.1;
        else if (ph < 0.6) byf = -Math.sin(((ph - 0.36) / 0.24) * Math.PI) * (big ? 2 : 1.2);
      }
      if (st === 'approval' && P.alert === 'bounce') byf = -Math.abs(Math.sin(ta * 6)) * (big ? 2.5 : 1.6);
      if (st === 'idle' && P.sleep === 'nod') {
        // Drifts off, head sinking, then jerks awake for a moment.
        const ph = (ta * 0.22) % 1;
        byf = ph < 0.85 ? Math.min(big ? 2 : 1.4, ph * 2.2) : 0;
      }
      if (mood.fidget === 'hop') byf -= Math.sin(mood.k * Math.PI) * (big ? 2 : 1.4);
      if (mood.fidget === 'wiggle') bxf = Math.floor(nowMs / 90) % 2 ? 1 : -1;
    }
    const bx = Math.round(bxf);
    const by = Math.round(byf);

    // ---------- body: a wobbling, dithered head with a glow ----------
    const c = (N - 1) / 2;
    const cx = c + bx;
    const cy = c + by;
    const p = P.shape;
    const shapeScale = p > 2 ? 0.88 + 0.12 * (2 / p) : p < 2 ? 1.07 : 1;
    const ax = P.aspect[0] * (1 + squash);
    const ay = P.aspect[1] * (1 - squash);
    const breathe = (st === 'idle' ? 0.04 : 0.025) * Math.sin(ta * (st === 'idle' ? 1.2 : 2.4));
    const R0 = N * 0.32 * shapeScale * (1 + breathe);
    const wob = WOB[st] * P.wobble;
    const glow = GLOW[st] * (st === 'approval' && blinkOn ? 1.3 : 1);
    const halo = N * 0.13;
    const [L1, L2] = P.lobes;
    const norm =
      p === 2 ? Math.hypot : (x: number, y: number) => Math.pow(Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p), 1 / p);
    const shift = new Int8Array(N);
    if (!still && st === 'error' && P.error === 'glitch' && f % 7 < 3) {
      for (let i = 0; i < 3; i++) {
        const y = (Math.random() * N) | 0;
        for (let k = 0; k < 1 + ((Math.random() * 2) | 0); k++) if (y + k < N) shift[y + k] = ((Math.random() * 5) | 0) - 2;
      }
    }
    const amp = st === 'speaking' ? 0.6 + 0.4 * Math.abs(Math.sin(ta * 6.1) * Math.sin(ta * 2.3 + 1)) : 1;
    const scan = st === 'thinking' && P.think === 'scan';
    const scanY = cy + Math.sin(ta * 2.4) * (R0 * ay - 1.5);
    const rings = st === 'thinking' && P.think === 'sonar' ? [(ta * 0.7) % 1, (ta * 0.7 + 0.5) % 1] : [];

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const sx = x - (shift[y] ?? 0);
        const dx = (sx - cx) / ax;
        const dy = (y - cy) / ay;
        const d = norm(dx, dy);
        const a = Math.atan2(dy, dx);
        const r = R0 + wob * amp * (Math.sin(a * L1 + ta * 2.3) * 0.7 + Math.sin(a * L2 - ta * 3.1) * 0.45);
        const th = BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5;
        if (d <= r) {
          if (d > r - 1.15) {
            put(x, y, tone((dx + dy < r * 0.4 ? 3 : 2) - dim));
            continue;
          }
          if (scan && Math.abs(y - scanY) < 0.6) {
            put(x, y, th < 0.7 ? T[4] : T[3]);
            continue;
          }
          let v = 0.12 + 0.5 * Math.pow(d / r, 2);
          const sd = Math.hypot(dx + r * 0.42, dy + r * 0.42);
          if (sd < r * 0.14) v = 1.4;
          else if (sd < r * 0.3) v += 0.3;
          put(x, y, tone(Math.floor(v * 3 + th) - dim));
          continue;
        }
        let ringed = false;
        for (const ph of rings) {
          const rr = r + 1 + ph * (halo + 3);
          if (Math.abs(d - rr) < 0.6 && th < (1 - ph) * 0.95) {
            put(x, y, tone(ph < 0.45 ? 3 : 2));
            ringed = true;
            break;
          }
        }
        if (ringed) continue;
        if (d < r + halo) {
          const fr = 1 - (d - r) / halo;
          if (th < fr * fr * glow) put(x, y, tone((fr > 0.6 ? 1 : 0) + (st === 'speaking' && fr > 0.6 ? 1 : 0) - dim));
        }
      }
    }

    // ---------- where it looks: the pointer, its work, or a fidget ----------
    let tx = 0;
    let ty = 0;
    const rect = this.rect;
    if (!still && rect && mouseX > -1e3) {
      const sc = rect.width / s || 1;
      const ddx = mouseX - (rect.left + rect.width / 2);
      const ddy = mouseY - (rect.top + rect.height / 2);
      const dist = Math.hypot(ddx, ddy) || 1;
      const m = Math.min(1, (dist / (220 * sc)) * P.curiosity);
      tx = (ddx / dist) * m;
      ty = (ddy / dist) * m;
    }
    if (st === 'thinking') {
      switch (P.think) {
        case 'bubbles':
        case 'ellipsis':
          tx = 0.8;
          ty = -1;
          break;
        case 'scan':
          tx = 0;
          ty = still ? 0 : Math.sin(ta * 2.4);
          break;
        case 'sonar':
          tx = 0;
          ty = 0;
          break;
        default:
          tx = still ? 0 : Math.sin(ta * 1.3) * 0.8;
          ty = -1;
      }
    }
    if (mood.fidget === 'glance') {
      tx = mood.side;
      ty = 0.2;
    } else if (mood.fidget === 'look-up') {
      tx = mood.side * 0.3;
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
    // Eyes with pupils keep still and move their pupils instead.
    const pupils = P.eyes === 'googly' || P.eyes === 'cyclops';
    const lookX = pupils ? 0 : Math.round(this.lx * maxO);
    const lookY = pupils ? 0 : Math.round(this.ly * maxO);
    const plx = sign(this.lx);
    const ply = sign(this.ly);

    // ---------- headgear (drawn before the face, after the body) ----------
    const H = N / 2;
    const mid = Math.round(cx + 0.5);
    const yb = Math.ceil(cy - R0 * ay) - 1;
    const tip =
      st === 'error'
        ? pack(blinkOn ? RED : mix(RED, BG, 0.5))
        : st === 'approval'
          ? pack(blinkOn ? YEL : mix(YEL, BG, 0.5))
          : st === 'idle'
            ? T[2]
            : st === 'thinking'
              ? Math.floor(ta * 6) % 2
                ? T[4]
                : T[2]
              : st === 'speaking'
                ? T[4]
                : T[3];
    const outer = Math.floor(cx - R0 * ax) - 1;
    const mirror = (x: number) => Math.round(2 * cx - x);
    const tall = big ? 3 : 2;
    switch (P.accessory) {
      case 'antenna': {
        const sway = st === 'speaking' && !still ? Math.round(Math.sin(ta * 9) * 0.6) : 0;
        for (let i = 0; i < tall; i++) put(mid, yb - i, T[2]);
        put(mid + sway, yb - tall, tip);
        break;
      }
      case 'twin': {
        const lx = Math.round(cx - 2.5);
        for (const [x, out] of [[lx, -1], [mirror(lx), 1]] as const) {
          put(x, yb, T[2]);
          if (big) put(x + out, yb - 1, T[2]);
          put(x + out * (big ? 2 : 1), yb - (big ? 2 : 1), tip);
        }
        break;
      }
      case 'ears': {
        const lit = st === 'speaking' && amp > 0.8 ? T[4] : T[2];
        for (const x of [outer, mirror(outer)]) {
          for (let yy = Math.floor(cy) - (big ? 3 : 2); yy <= Math.ceil(cy); yy++) put(x, yy, lit);
          put(x, Math.floor(cy) - (big ? 3 : 2), tip);
        }
        break;
      }
      case 'bolts': {
        for (const [x, out] of [[outer, -1], [mirror(outer), 1]] as const) {
          put(x, Math.floor(cy), T[3]);
          put(x, Math.ceil(cy), T[3]);
          put(x + out, Math.floor(cy) + (big ? 1 : 0), tip);
        }
        break;
      }
      case 'halo': {
        const hy = yb - (big ? 3 : 2);
        const glowC = st === 'idle' ? T[2] : st === 'approval' || st === 'error' ? tip : Math.sin(ta * 3) > 0 ? T[4] : T[3];
        for (let x = mid - 3; x <= mid + 2; x++) put(x, hy, glowC);
        put(mid - 4, hy + 1, glowC);
        put(mid + 3, hy + 1, glowC);
        break;
      }
      case 'crest': {
        const heights = big ? [2, 3, 4, 2] : [1, 2, 1];
        heights.forEach((h, i) => {
          const hh = h + (st === 'speaking' && !still ? Math.round(Math.sin(ta * 12 + i * 1.3) * 0.5 + 0.5) : 0);
          const x = mid - 1 + i - (big ? 1 : 0);
          for (let k = 0; k < hh; k++) put(x, yb - k, k === hh - 1 ? tip : T[3]);
        });
        break;
      }
      case 'sprout': {
        const side = still || Math.sin(ta * 1.4) > 0 ? 1 : -1;
        put(mid, yb, T[2]);
        put(mid, yb - 1, T[2]);
        put(mid + side, yb - 2, T[4]);
        put(mid + 2 * side, yb - 2, T[3]);
        put(mid + side, yb - 1, T[3]);
        if (big) put(mid + 2 * side, yb - 3, T[3]);
        break;
      }
      default:
        break;
    }

    // ---------- eyes ----------
    const top = Math.round(H - (big ? 3 : 2)) + by;
    const twoEyes = (ew: number, eh: number, sp: number, y0: number) => {
      [H - sp - ew, H + sp].forEach((x0, side) => {
        const ex = x0 + bx + lookX;
        const ey = y0 + lookY;
        const out = ew === 2 && !side ? 1 : 0;
        if (st === 'idle') {
          for (let i = 0; i < ew + 1; i++) put(ex - out + i, ey + eh - 1, T[3]);
          return;
        }
        if (st === 'done') {
          for (const [px, py] of DONE_EYE) put(ex - out + px, ey + py + 1, eyeC);
          if (big) for (const [px, py] of DONE_EYE_BIG) put(ex - out + px, ey + py + 1, eyeC);
          return;
        }
        if (st === 'error') {
          for (const [px, py] of ERROR_EYE) put(ex - out + px, ey + py, eyeC);
          return;
        }
        const blinking = side ? mood.blinkR : mood.blinkL;
        const wide = st === 'approval' ? 1 : 0;
        const h = blinking ? 1 : eh + wide;
        const yTop = ey + (eh - h);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < ew; xx++) put(ex + xx, yTop + yy, eyeC);
        if (blinking) return;
        if (P.eyes === 'sleepy' && !wide && st !== 'speaking') {
          // Heavy eyelids: the top of each eye stays shut.
          for (let yy = 0; yy < (big ? 2 : 1); yy++) for (let xx = 0; xx < ew; xx++) put(ex + xx, yTop + yy, T[2]);
        } else if (P.eyes === 'googly') {
          const size = big ? 2 : 1;
          const pcx = ex + Math.floor((ew - size) / 2) + (wide ? 0 : plx);
          const pcy = yTop + Math.floor((h - size) / 2) + (wide ? 0 : ply);
          for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) put(pcx + xx, pcy + yy, pupilC);
        } else if (big && P.eyes === 'tall') {
          put(ex + (side ? 0 : 1), yTop, T[2]);
        }
      });
    };

    switch (P.eyes) {
      case 'dot':
        twoEyes(2, big ? 3 : 2, big ? 3 : 2, top + 1);
        break;
      case 'wide':
        twoEyes(3, big ? 3 : 2, big ? 2 : 1, top + 1);
        break;
      case 'googly':
        twoEyes(3, big ? 4 : 3, 1, top);
        break;
      case 'visor': {
        const x0 = Math.round(H - (big ? 6 : 4)) + bx;
        const x1 = Math.round(H + (big ? 5 : 3)) + bx;
        const vy = top + 1;
        const vh = big ? 3 : 2;
        if (st === 'idle') {
          for (let x = x0; x <= x1; x++) put(x, vy + vh - 1, T[1]);
          break;
        }
        const bandC = st === 'error' ? pack(blinkOn ? mix(RED, BG, 0.35) : mix(RED, BG, 0.65)) : T[1];
        for (let yy = 0; yy < vh; yy++) for (let x = x0; x <= x1; x++) put(x, vy + yy, bandC);
        if (st === 'done' || st === 'error') {
          twoEyes(2, big ? 4 : 3, big ? 3 : 2, top);
          break;
        }
        if (st === 'approval') {
          for (let yy = 0; yy < vh; yy++) for (let x = x0; x <= x1; x++) put(x, vy + yy, blinkOn ? eyeC : T[3]);
          break;
        }
        const lightC = mood.blinkL || mood.blinkR ? T[3] : eyeC;
        if (st === 'thinking') {
          // A glint sweeps back and forth along the visor.
          const span = x1 - x0 - 1;
          const gx = x0 + Math.round((Math.sin(ta * 3.2) * 0.5 + 0.5) * span);
          for (let yy = 0; yy < vh; yy++) {
            put(gx, vy + yy, lightC);
            put(gx + 1, vy + yy, lightC);
          }
          break;
        }
        for (const ex of [Math.round(H - (big ? 4 : 3)), Math.round(H + (big ? 2 : 1))]) {
          const x = Math.max(x0, Math.min(x1 - 1, ex + bx + lookX));
          for (let yy = 0; yy < vh; yy++) {
            put(x, vy + yy, lightC);
            put(x + 1, vy + yy, lightC);
          }
        }
        break;
      }
      case 'cyclops': {
        const cs = big ? 6 : 4;
        const x0 = Math.round(H - cs / 2) + bx;
        const y0 = top - 1;
        if (st === 'idle') {
          for (let i = 0; i < cs; i++) put(x0 + i, y0 + cs - 2, T[3]);
          break;
        }
        if (st === 'done') {
          for (const [px, py] of DONE_EYE_WIDE) put(x0 + px + (big ? 1 : 0), y0 + py + 1, eyeC);
          break;
        }
        if (st === 'error') {
          for (const [px, py] of ERROR_EYE_WIDE) put(x0 + px + (big ? 1 : 0), y0 + py + (big ? 1 : 0), eyeC);
          break;
        }
        if (mood.blinkL || mood.blinkR) {
          for (let i = 0; i < cs; i++) put(x0 + i, y0 + Math.floor(cs / 2), eyeC);
          break;
        }
        for (let yy = 0; yy < cs; yy++) {
          for (let xx = 0; xx < cs; xx++) {
            const corner = (xx === 0 || xx === cs - 1) && (yy === 0 || yy === cs - 1);
            if (!corner) put(x0 + xx, y0 + yy, eyeC);
          }
        }
        // A smaller pupil when it's surprised (it needs you).
        const size = st === 'approval' ? (big ? 2 : 1) : big ? 3 : 2;
        const px0 = x0 + Math.floor((cs - size) / 2) + (st === 'approval' ? 0 : plx);
        const py0 = y0 + Math.floor((cs - size) / 2) + (st === 'approval' ? 0 : ply);
        for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) put(px0 + xx, py0 + yy, pupilC);
        break;
      }
      default:
        // tall and sleepy
        twoEyes(2, big ? 4 : 3, big ? 3 : 2, top);
    }

    // ---------- mouth ----------
    const mx = H + bx + lookX;
    const my0 = Math.round(H + (big ? 3 : 2)) + by + lookY;
    if (st === 'speaking') {
      switch (P.mouth) {
        case 'oval': {
          const w = big ? 4 : 3;
          const open = still ? 1 : Math.round(amp * (Math.sin(ta * 11) * 0.5 + 0.5) * (big ? 3 : 2));
          if (open === 0) {
            put(mx - 1, my0, T[4]);
            put(mx, my0, T[4]);
            break;
          }
          for (let yy = 0; yy <= open; yy++) {
            for (let xx = 0; xx < w; xx++) {
              const inner = yy > 0 && yy < open && xx > 0 && xx < w - 1;
              put(mx - Math.floor(w / 2) + xx, my0 + yy, inner ? T[1] : T[4]);
            }
          }
          break;
        }
        case 'wave': {
          const w = big ? 8 : 6;
          for (let i = 0; i < w; i++) {
            const y = my0 + Math.round(Math.sin(ta * 10 - i * 1.3) * amp * (big ? 1.5 : 1));
            put(mx - w / 2 + i, y, T[4]);
          }
          break;
        }
        case 'grill': {
          const w = big ? 8 : 6;
          const beat = Math.floor(ta * 8);
          for (let row = 0; row < 2; row++) {
            for (let i = 0; i < w; i++) {
              const on = (i + row + beat) % 2 === 0;
              put(mx - w / 2 + i, my0 + row, on ? (amp > 0.75 ? T[4] : T[3]) : T[2]);
            }
          }
          break;
        }
        default: {
          const w = big ? 6 : 4;
          for (let i = 0; i < w; i++) {
            const jitter = still ? 0 : Math.random() * 0.6;
            const hgt = Math.round((Math.sin(ta * 15 + i * 1.9) * 0.5 + 0.5) * (big ? 2 : 1) * amp + jitter);
            for (let k = -hgt; k <= hgt; k++) put(mx - w / 2 + i, my0 + k, T[4]);
          }
        }
      }
    } else if (st === 'done') {
      const w = big ? 3 : 2;
      put(mx - w, my0, T[4]);
      put(mx + w - 1, my0, T[4]);
      for (let i = -w + 1; i < w - 1; i++) put(mx + i, my0 + 1, T[4]);
    } else if (st === 'error') {
      const w = big ? 6 : 4;
      for (let i = 0; i < w; i++) put(mx - w / 2 + i, my0 + (i % 2), T[4]);
    } else if (st === 'approval') {
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) put(mx - 1 + xx, my0 + yy, T[4]);
    } else if (st === 'ready' || st === 'thinking') {
      switch (P.mouth) {
        case 'wave':
          // A lopsided, thoughtful little mouth.
          if (st === 'thinking') {
            put(mx + 1, my0, T[3]);
            put(mx + 2, my0, T[3]);
          } else {
            put(mx - 2, my0, T[3]);
            put(mx - 1, my0 + 1, T[3]);
            put(mx, my0 + 1, T[3]);
            put(mx + 1, my0, T[3]);
          }
          break;
        case 'grill': {
          const w = big ? 8 : 6;
          for (let i = 0; i < w; i++) put(mx - w / 2 + i, my0, i % 2 ? T[2] : T[3]);
          break;
        }
        case 'oval':
          if (st === 'thinking') put(mx, my0, T[3]);
          else {
            put(mx - 1, my0, T[3]);
            put(mx, my0, T[3]);
          }
          break;
        default:
          if (st === 'ready') {
            put(mx - 1, my0, T[3]);
            put(mx, my0, T[3]);
          }
      }
    } else if (st === 'idle' && P.mouth === 'grill') {
      for (let i = 0; i < (big ? 8 : 6); i++) put(mx - (big ? 4 : 3) + i, my0, T[1]);
    }

    // ---------- what's around it: each robot's own way of thinking, sleeping, celebrating, asking, failing ----------
    if (st === 'thinking') {
      switch (P.think) {
        case 'orbit': {
          const rr = R0 + (big ? 2.5 : 2);
          for (let i = 0; i < 4; i++) {
            const a = ta * 4.2 - i * 0.32;
            put(cx + Math.cos(a) * rr * ax, cy + Math.sin(a) * rr * ay, tone(4 - i));
            const b = a + Math.PI;
            put(cx + Math.cos(b) * rr * ax, cy + Math.sin(b) * rr * ay, tone(3 - i));
          }
          break;
        }
        case 'bubbles': {
          // Thought bubbles rise, small to large, then start again.
          const ph = still ? 0.9 : (ta * 0.6) % 1;
          const b1x = Math.round(cx + R0 * ax * 0.78);
          const b1y = Math.round(cy - R0 * ay * 0.78) - 1;
          if (ph > 0.12) put(b1x, b1y, T[3]);
          if (ph > 0.38) put(b1x + 1, b1y - 2, T[4]);
          if (ph > 0.62) {
            const sz = big ? 3 : 2;
            for (let yy = 0; yy < sz; yy++) for (let xx = 0; xx < sz; xx++) put(b1x + 2 + xx, b1y - 3 - sz + 1 + yy, T[4]);
          }
          break;
        }
        case 'ellipsis': {
          // Typing dots, filling in one by one.
          const lit = still ? 3 : Math.floor(ta * 3.2) % 4;
          const x0 = Math.round(cx + R0 * ax * 0.75);
          const y0 = Math.round(cy - R0 * ay * 0.8) - 1;
          for (let i = 0; i < 3; i++) {
            const color = i < lit ? T[4] : T[2];
            put(x0 + i * 2, y0, color);
            if (big) {
              put(x0 + i * 2 + 1, y0, color);
              put(x0 + i * 2, y0 - 1, color);
              put(x0 + i * 2 + 1, y0 - 1, color);
            }
          }
          break;
        }
        default:
          // scan and sonar are drawn with the body
          break;
      }
    }

    if (st === 'idle') {
      switch (P.sleep) {
        case 'zzz': {
          const ph = (ta * 0.5) % 1;
          const zx = Math.round(N * 0.72 + ph * 2);
          const zy = Math.round(N * 0.26 - ph * N * 0.18);
          if (ph < 0.85) for (const [px, py] of ZZZ) put(zx + px, zy + py, ph > 0.6 ? T[2] : T[3]);
          break;
        }
        case 'bubble': {
          // A bubble swells at the side of its mouth, then pops.
          const ph = still ? 0.6 : (ta * 0.3) % 1;
          const bcx = Math.round(H + (big ? 5 : 4)) + bx;
          const bcy = Math.round(H + (big ? 4 : 3)) + by;
          if (ph < 0.9) {
            const r = 0.6 + ph * (big ? 2.8 : 1.7);
            if (r < 1) put(bcx, bcy, T[3]);
            else {
              for (let yy = -4; yy <= 4; yy++) {
                for (let xx = -4; xx <= 4; xx++) {
                  if (Math.abs(Math.hypot(xx, yy) - r) < 0.55) put(bcx + xx, bcy + yy, xx + yy < 0 ? T[4] : T[3]);
                }
              }
            }
          } else {
            for (const [px, py] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) put(bcx + px, bcy + py, T[2]);
          }
          break;
        }
        case 'stars': {
          STARS.forEach(([sx, sy], k) => {
            const v = still ? 1 : Math.sin(ta * 1.8 + k * 2.1);
            if (v < 0.2) return;
            const x = Math.round(N * sx);
            const y = Math.round(N * sy);
            put(x, y, v > 0.75 ? T[4] : T[3]);
            if (v > 0.75) {
              put(x - 1, y, T[2]);
              put(x + 1, y, T[2]);
              put(x, y - 1, T[2]);
              put(x, y + 1, T[2]);
            }
          });
          break;
        }
        default:
          // nod: the head movement is the whole show
          break;
      }
    }

    if (st === 'approval') {
      switch (P.alert) {
        case 'question':
          if (blinkOn) {
            const qx = Math.round(N * 0.76);
            const qy = Math.round(N * 0.06);
            for (const [px, py] of QUESTION) put(qx + px, qy + py, T[4]);
          }
          break;
        case 'siren': {
          // A flashing light on top, and beams when it's lit.
          const ly = P.accessory === 'antenna' ? yb - tall : yb;
          const light = pack(blinkOn ? RED : YEL);
          put(mid - 1, ly, light);
          put(mid, ly, light);
          if (blinkOn) {
            put(mid - 3, ly - 1, T[4]);
            put(mid + 2, ly - 1, T[4]);
            put(mid - 4, ly - 1, T[3]);
            put(mid + 3, ly - 1, T[3]);
          }
          break;
        }
        default:
          // bang, and bounce (which also hops)
          if (blinkOn) {
            const bangX = Math.round(N * 0.8);
            const bangY = Math.round(N * 0.08);
            for (let i = 0; i < (big ? 4 : 3); i++) put(bangX, bangY + i, T[4]);
            put(bangX, bangY + (big ? 5 : 4), T[4]);
          }
      }
    }

    if (st === 'done') {
      switch (P.done) {
        case 'confetti': {
          for (let k = 0; k < 8; k++) {
            const fall = ((ta * 0.45 + k * 0.137) % 1) * (N + 4) - 2;
            const x = ((k * 5 + 2 + Math.floor(k / 3)) % N) + (still ? 0 : Math.round(Math.sin(ta * 3 + k) * 0.6));
            put(x, Math.floor(fall), pack(CONFETTI[k % CONFETTI.length] ?? WHITE));
          }
          break;
        }
        case 'heart': {
          const ph = still ? 0.3 : (ta * 0.5) % 1;
          if (ph < 0.8) {
            const hx = Math.round(cx + R0 * ax * 0.35);
            const hy = Math.round(cy - R0 * ay * 0.55 - ph * N * 0.22) - 2;
            const color = pack(mix(HEART, BG, ph * 0.6));
            for (const [px, py] of HEART_PX) put(hx + px, hy + py, color);
          }
          break;
        }
        case 'hop':
          // the hops are the celebration; one sparkle at the top of each
          if (by < -1) put(Math.round(cx + R0 * ax * 0.9), Math.round(cy - R0 * ay), T[4]);
          break;
        default:
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
    }

    if (st === 'error') {
      switch (P.error) {
        case 'smoke': {
          for (let k = 0; k < 3; k++) {
            const ph = still ? 0.2 + k * 0.3 : (ta * 0.45 + k / 3) % 1;
            const px = cx + 2 + ph * 3 + Math.sin(ph * 5 + k) * 0.8;
            const py = yb + 1 - ph * N * 0.35;
            const size = big ? 3 : 2;
            const color = pack(mix(GREY, BG, ph * 0.7));
            for (let yy = 0; yy < size; yy++) {
              for (let xx = 0; xx < size; xx++) {
                const x = Math.round(px) + xx;
                const y = Math.round(py) + yy;
                if ((BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5) < (1 - ph) * 1.1) put(x, y, color);
              }
            }
          }
          break;
        }
        case 'dizzy': {
          // Little stars circling its head.
          const star = pack(YEL);
          const arm = pack(mix(YEL, BG, 0.45));
          for (let k = 0; k < 3; k++) {
            const a = ta * 3.4 + k * 2.094;
            const x = Math.round(cx + Math.cos(a) * R0 * ax * 0.75);
            const y = Math.round(yb + Math.sin(a) * 1.3);
            put(x, y, star);
            if (Math.sin(a) > 0.3) {
              put(x - 1, y, arm);
              put(x + 1, y, arm);
            }
          }
          break;
        }
        default:
          if (!still && f % 5 === 0) for (let i = 0; i < 4; i++) put(Math.random() * N, Math.random() * N, T[3]);
      }
    }

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

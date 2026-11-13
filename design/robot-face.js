(function () {
  if (customElements.get('robot-face')) return;
  const inst = new Set();
  let mx = -1e4, my = -1e4, running = false;
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
  const BG = [20, 17, 14], WHITE = [255, 246, 232], RED = [229, 83, 61], YEL = [245, 197, 66];
  const hex = h => { h = (h || '#f0a64a').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const pack = c => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
  const GLOW = { idle: .22, ready: .45, thinking: .55, speaking: .75, approval: .65, error: .5, done: .6 };
  const WOB = { idle: .15, ready: .3, thinking: .5, speaking: 1.1, approval: .35, error: .6, done: .35 };
  const DPR = 2, FPS = 12;

  class RobotFace extends HTMLElement {
    static get observedAttributes() { return ['state', 'hue', 'size']; }
    constructor() {
      super();
      this.c = document.createElement('canvas');
      this.c.style.imageRendering = 'pixelated';
      this.x = this.c.getContext('2d');
      this.off = document.createElement('canvas');
      this.ox = this.off.getContext('2d');
      this.lx = 0; this.ly = 0; this.t0 = Math.random() * 100; this.frame = -1;
      this.blinkAt = performance.now() + 1500 + Math.random() * 3000;
    }
    connectedCallback() {
      this.style.display = 'block'; this.style.lineHeight = '0';
      if (!this.c.parentNode) this.appendChild(this.c);
      this.resize(); inst.add(this);
      if (!running) { running = true; requestAnimationFrame(loop); }
    }
    disconnectedCallback() { inst.delete(this); }
    attributeChangedCallback() { if (this.isConnected) { this.resize(); this.frame = -1; } }
    resize() {
      const s = +this.getAttribute('size') || 64;
      if (s === this.s) return;
      this.s = s;
      this.c.width = s * DPR; this.c.height = s * DPR;
      this.c.style.width = s + 'px'; this.c.style.height = s + 'px';
      this.style.width = s + 'px'; this.style.height = s + 'px';
    }
    draw(now) {
      const f = Math.floor(now / 1000 * FPS);
      if (f === this.frame) return;
      this.frame = f;
      const t = now / 1000 + this.t0;
      const chunky = document.documentElement.dataset.pixelGrid === 'chunky';
      const s = this.s, big = s >= 120;
      const N = big ? (chunky ? 24 : 32) : (chunky ? 14 : 20);
      if (this.off.width !== N) { this.off.width = N; this.off.height = N; this.img = this.ox.createImageData(N, N); this.buf = new Uint32Array(this.img.data.buffer); }
      const buf = this.buf; buf.fill(0);
      const st = this.getAttribute('state') || 'idle';
      let hue = hex(this.getAttribute('hue'));
      const blinkOn = Math.floor(t * 3) % 2 === 0;
      if (st === 'error') hue = mix(hue, RED, .8);
      if (st === 'approval') hue = mix(hue, YEL, blinkOn ? .85 : .5);
      const dim = st === 'idle' ? 1 : 0;
      const T = [mix(hue, BG, .84), mix(hue, BG, .62), mix(hue, BG, .34), hue, mix(hue, WHITE, .62)].map(pack);
      const tone = i => T[Math.max(0, Math.min(4, i))];
      const eyeC = pack(st === 'error' ? mix(RED, WHITE, .35) : mix(hue, WHITE, .82));
      const put = (x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < N && y < N) buf[y * N + x] = c; };

      const c = (N - 1) / 2;
      const R0 = N * .32 * (1 + (st === 'idle' ? .04 : .025) * Math.sin(t * (st === 'idle' ? 1.2 : 2.4)));
      const wob = WOB[st] ?? .3, glow = (GLOW[st] ?? .4) * (st === 'approval' && blinkOn ? 1.3 : 1);
      const halo = N * .13;
      const shift = new Int8Array(N);
      if (st === 'error' && f % 7 < 3) for (let i = 0; i < 3; i++) { const y = (Math.random() * N) | 0; for (let k = 0; k < 1 + (Math.random() * 2 | 0); k++) if (y + k < N) shift[y + k] = (Math.random() * 5 | 0) - 2; }
      const amp = st === 'speaking' ? .6 + .4 * Math.abs(Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1)) : 1;

      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const sx = x - shift[y], dx = sx - c, dy = y - c, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        const r = R0 + wob * amp * (Math.sin(a * 3 + t * 2.3) * .7 + Math.sin(a * 5 - t * 3.1) * .45);
        const th = BAYER[(y & 3) * 4 + (x & 3)];
        if (d <= r) {
          if (d > r - 1.15) { put(x, y, tone((dx + dy < r * .4 ? 3 : 2) - dim)); continue; }
          let v = .12 + .5 * Math.pow(d / r, 2);
          const sd = Math.hypot(dx + r * .42, dy + r * .42);
          if (sd < r * .14) v = 1.4; else if (sd < r * .3) v += .3;
          put(x, y, tone(Math.floor(v * 3 + th) - dim));
        } else if (d < r + halo) {
          const fr = 1 - (d - r) / halo;
          if (th < fr * fr * glow) put(x, y, tone((fr > .6 ? 1 : 0) + (st === 'speaking' && fr > .6 ? 1 : 0) - dim));
        }
      }

      const rect = this._rect;
      let tx = 0, ty = 0;
      if (rect && mx > -1e3) {
        const sc = rect.width / s || 1;
        const dx = mx - (rect.left + rect.width / 2), dy = my - (rect.top + rect.height / 2);
        const d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / (220 * sc));
        tx = dx / d * m; ty = dy / d * m;
      }
      if (st === 'thinking') { tx = Math.sin(t * 1.3) * .8; ty = -1; }
      if (st === 'idle' || st === 'error') { tx *= .2; ty *= .2; }
      this.lx += (tx - this.lx) * .5; this.ly += (ty - this.ly) * .5;
      const maxO = big ? 2 : 1;
      const ox = Math.round(this.lx * maxO), oy = Math.round(this.ly * maxO);

      const nowMs = performance.now();
      let blink = false;
      if (nowMs > this.blinkAt) { if (nowMs - this.blinkAt > 140) this.blinkAt = nowMs + 2200 + Math.random() * 3500; else blink = true; }

      const H = N / 2, sp = big ? 3 : 2, ew = 2, eh = big ? 4 : 3;
      const ey = Math.round(H - (big ? 3 : 2)) + oy;
      const eyes = [H - sp - ew + ox, H + sp + ox];
      eyes.forEach((ex, side) => {
        if (st === 'idle') { for (let i = 0; i < ew + 1; i++) put(ex - (side ? 0 : 1) + i, ey + eh - 1, T[3]); return; }
        if (st === 'done') { [[0, 1], [1, 0], [2, 1]].forEach(([px, py]) => put(ex - (side ? 0 : 1) + px, ey + py + 1, eyeC)); if (big) [[0, 2], [2, 2]].forEach(([px, py]) => put(ex - (side ? 0 : 1) + px, ey + py + 1, eyeC)); return; }
        if (st === 'error') { [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]].forEach(([px, py]) => put(ex - (side ? 0 : 1) + px, ey + py, eyeC)); return; }
        const h = blink ? 1 : eh + (st === 'approval' ? 1 : 0);
        const y0 = ey + (eh - h) - (st === 'approval' ? 0 : 0);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < ew; xx++) put(ex + xx, y0 + yy, eyeC);
        if (big && !blink) put(ex + (side ? 0 : 1), y0, T[2]);
      });

      const my0 = Math.round(H + (big ? 3 : 2)) + oy;
      if (st === 'speaking') {
        const w = big ? 6 : 4;
        for (let i = 0; i < w; i++) {
          const hgt = Math.round((Math.sin(t * 15 + i * 1.9) * .5 + .5) * (big ? 2 : 1) * amp + Math.random() * .6);
          for (let k = -hgt; k <= hgt; k++) put(H - w / 2 + i + ox, my0 + k, T[4]);
        }
      } else if (st === 'done') {
        const w = big ? 3 : 2;
        put(H - w + ox, my0, T[4]); put(H + w - 1 + ox, my0, T[4]);
        for (let i = -w + 1; i < w - 1; i++) put(H + i + ox, my0 + 1, T[4]);
      } else if (st === 'error') {
        const w = big ? 6 : 4;
        for (let i = 0; i < w; i++) put(H - w / 2 + i + ox, my0 + (i % 2), T[4]);
      } else if (st === 'approval') {
        for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) put(H - 1 + xx + ox, my0 + yy, T[4]);
      } else if (st === 'ready') {
        put(H - 1 + ox, my0, T[3]); put(H + ox, my0, T[3]);
      }

      if (st === 'thinking') {
        const rr = R0 + (big ? 2.5 : 2);
        for (let i = 0; i < 4; i++) {
          const a = t * 4.2 - i * .32;
          put(Math.round(c + Math.cos(a) * rr), Math.round(c + Math.sin(a) * rr), tone(4 - i));
          const b = a + Math.PI;
          put(Math.round(c + Math.cos(b) * rr), Math.round(c + Math.sin(b) * rr), tone(3 - i));
        }
      }
      if (st === 'idle') {
        const ph = (t * .5) % 1, zx = Math.round(N * .72 + ph * 2), zy = Math.round(N * .26 - ph * N * .18);
        if (ph < .85) [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]].forEach(([px, py]) => put(zx + px, zy + py, ph > .6 ? T[2] : T[3]));
      }
      if (st === 'approval' && blinkOn) {
        const ax = Math.round(N * .8), ay = Math.round(N * .08);
        for (let i = 0; i < (big ? 4 : 3); i++) put(ax, ay + i, T[4]);
        put(ax, ay + (big ? 5 : 4), T[4]);
      }
      if (st === 'done') {
        [[.84, .16, 0], [.14, .8, 1], [.88, .78, 2]].forEach(([px, py, k]) => {
          if ((f + k * 4) % 12 > 6) return;
          const sx = Math.round(N * px), sy = Math.round(N * py);
          put(sx, sy, T[4]); if (big || (f + k) % 2) { put(sx - 1, sy, T[3]); put(sx + 1, sy, T[3]); put(sx, sy - 1, T[3]); put(sx, sy + 1, T[3]); }
        });
      }
      if (st === 'error' && f % 5 === 0) for (let i = 0; i < 4; i++) put(Math.random() * N, Math.random() * N, T[3]);

      this.ox.putImageData(this.img, 0, 0);
      const ctx = this.x;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, this.c.width, this.c.height);
      ctx.drawImage(this.off, 0, 0, this.c.width, this.c.height);
    }
  }
  function loop(now) {
    const vh = innerHeight, vw = innerWidth;
    inst.forEach(el => {
      const r = el.getBoundingClientRect(); el._rect = r;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || !r.width) return;
      el.draw(now);
    });
    if (inst.size) requestAnimationFrame(loop); else running = false;
  }
  customElements.define('robot-face', RobotFace);
})();

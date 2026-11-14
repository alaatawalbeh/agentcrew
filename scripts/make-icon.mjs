#!/usr/bin/env node
// Draws the app icon: three of the crew huddled together (Atlas in front, Fern and Ion behind) in the faces' pixel
// style, on the app's dark background. Large sizes show the whole crew; at 48px and below only Atlas is drawn, so the
// icon stays readable in panels and menus. Every robot pixel is a whole number of screen pixels, so it stays crisp.
//   node scripts/make-icon.mjs   (npm run icon)
// Writes resources/icons/<n>x<n>.png for packaging and resources/icon.png (512) for the window.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

// L light, A base, M mid, D shade, E eyes and lamps, K visor and mouth, G/g metal. Body colours are three of the
// crew's hues in the app (Atlas's amber, Fern's green, Ion's blue).
const METAL = { G: '#a89a86', g: '#5e5346' };
const PALETTES = {
  atlas: { L: '#f9d8ac', A: '#f0a64a', M: '#a57336', D: '#684a25', E: '#fff1d9', K: '#2b2014', ...METAL },
  fern: { L: '#b9ecc9', A: '#5cc58f', M: '#3d8a62', D: '#275640', E: '#f2fff6', K: '#173527', ...METAL },
  ion: { L: '#c9ccfb', A: '#7d85ee', M: '#545bb5', D: '#343a78', E: '#f6f7ff', K: '#1f2350', ...METAL },
};

// Atlas in front: antenna lamp, ear bolts, a visor with glowing eyes, a grill mouth. Fern and Ion behind it.
const ATLAS = [
  '......EEL......',
  '......ELM......',
  '.......G.......',
  '.......g.......',
  '..MAAAAAAAAAM..',
  '.MLLLAAAAAAAAD.',
  '.MLAAAAAAAAAAD.',
  '.MAKKKKKKKKKAD.',
  'GMAKEEKKKEEKADg',
  'GMAKEEKKKEEKADg',
  '.MAKKKKKKKKKAD.',
  '.MAAAAAAAAAAAD.',
  '.MAAAKDKDKAAAD.',
  '.MAAAAAAAAAAAD.',
  '..DDDDDDDDDDD..',
];
const FERN = [
  '..EL.......',
  '..LM.......',
  '...G.......',
  '.MAAAAAAAM.',
  'MLLAAAAAAAD',
  'MLAAAAAAAAD',
  'MAEEAAAEEAD',
  'MAEEAAAEEAD',
  'MAAAAAAAAAD',
  'MAAAKKKAAAD',
  'MAAAAAAAAAD',
  '.DDDDDDDDD.',
];
const ION = [
  '...LLLLL...',
  '..M.....M..',
  '...........',
  '.MAAAAAAAM.',
  'MLLAAAAAAAD',
  'MLAAAAAAAAD',
  'MAEEAAAEEAD',
  'MAAAAAAAAAD',
  'MAAAAAAAAAD',
  'MAAAKKKAAAD',
  'MAAAAAAAAAD',
  '.DDDDDDDDD.',
];

/** A picture as rows of colours (null = see-through), from robots placed back to front. */
function compose(width, height, layers) {
  const art = Array.from({ length: height }, () => Array(width).fill(null));
  for (const { rows, palette, x, y } of layers) {
    rows.forEach((row, dy) =>
      [...row].forEach((ch, dx) => {
        if (ch !== '.') art[y + dy][x + dx] = PALETTES[palette][ch];
      }),
    );
  }
  return art;
}

const CREW = compose(25, 19, [
  { rows: FERN, palette: 'fern', x: 0, y: 0 },
  { rows: ION, palette: 'ion', x: 14, y: 0 },
  { rows: ATLAS, palette: 'atlas', x: 5, y: 4 },
]);
// Small sizes: Atlas alone, without the ear bolts and with a shorter antenna, so it can be drawn 1, 2 or 3 pixels
// per art pixel at 16, 32 and 48.
const SMALL_ATLAS = ATLAS.filter((_, i) => i !== 3).map((row) => row.slice(1, -1));
const SOLO = compose(13, 14, [{ rows: SMALL_ATLAS, palette: 'atlas', x: 0, y: 0 }]);

const TOP = [0x2a, 0x23, 0x1b];
const BOTTOM = [0x17, 0x13, 0x0f];
const BORDER = [0x3a, 0x30, 0x26];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** One icon size: an anti-aliased rounded square, then the art at a whole-pixel scale, centred. */
function draw(size) {
  const art = size > 48 ? CREW : SOLO;
  const scale = Math.max(1, Math.floor((size * (size > 48 ? 0.8 : 0.9)) / Math.max(art.length, art[0].length)));
  const ox = Math.round((size - art[0].length * scale) / 2);
  const oy = Math.round((size - art.length * scale) / 2);
  const radius = size * 0.22;
  const border = Math.max(1, Math.round(size / 96));
  const px = new Uint8Array(size * size * 4);
  const SS = 4; // samples per side for the corners
  for (let y = 0; y < size; y++) {
    const colour = mix(TOP, BOTTOM, y / (size - 1));
    for (let x = 0; x < size; x++) {
      let inside = 0;
      let rim = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          const cx = Math.min(Math.max(fx, radius), size - radius);
          const cy = Math.min(Math.max(fy, radius), size - radius);
          const edge = radius - Math.hypot(fx - cx, fy - cy);
          if (edge <= 0) continue;
          inside++;
          if (edge < border) rim++;
        }
      }
      if (!inside) continue;
      const c = mix(colour, BORDER, rim / inside);
      px.set([...c, Math.round((inside / (SS * SS)) * 255)], (y * size + x) * 4);
    }
  }
  art.forEach((row, ay) =>
    row.forEach((c, ax) => {
      if (!c) return;
      const rgb = hex(c);
      for (let y = oy + ay * scale; y < oy + (ay + 1) * scale; y++) {
        for (let x = ox + ax * scale; x < ox + (ax + 1) * scale; x++) px.set([...rgb, 255], (y * size + x) * 4);
      }
    }),
  );
  return png(size, px);
}

// PNG: signature, IHDR, IDAT (filter byte 0 per row), IEND.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = resolve(import.meta.dirname, '..', 'resources');
mkdirSync(join(out, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(join(out, 'icons', `${size}x${size}.png`), draw(size));
}
writeFileSync(join(out, 'icon.png'), draw(512));
console.log('resources/icons/{16,32,48,64,128,256,512}x….png and resources/icon.png written');

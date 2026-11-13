#!/usr/bin/env node
// Draws the app icon from Atlas's pixel face in the design (src/renderer/src/robots/faces.ts): the face on the
// design's dark background, as a 512×512 PNG for packaging.
//   node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { FACES } from '../src/renderer/src/robots/faces.ts';

const SIZE = 512;
const RADIUS = 112;
const BG = [0x1f, 0x1a, 0x15];
const BORDER = [0x3a, 0x30, 0x26];
const face = FACES.atlas;
const scale = Math.floor((SIZE * 0.68) / Math.max(face.width, face.height));
const ox = Math.round((SIZE - face.width * scale) / 2);
const oy = Math.round((SIZE - face.height * scale) / 2);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const pixels = new Uint8Array(SIZE * SIZE * 4);
const put = (x, y, [r, g, b], a = 255) => {
  const i = (y * SIZE + x) * 4;
  pixels.set([r, g, b, a], i);
};

// Rounded square with a 6px border, anti-aliased at the corners.
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const cx = Math.min(Math.max(x + 0.5, RADIUS), SIZE - RADIUS);
    const cy = Math.min(Math.max(y + 0.5, RADIUS), SIZE - RADIUS);
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const edge = RADIUS - d;
    if (edge <= 0) continue;
    put(x, y, edge < 6 ? BORDER : BG, Math.round(Math.min(1, edge) * 255));
  }
}
for (const [x, y, w, h, c] of face.runs) {
  const colour = hex(face.palette[c]);
  for (let py = y * scale; py < (y + h) * scale; py++) {
    for (let px = x * scale; px < (x + w) * scale; px++) put(ox + px, oy + py, colour);
  }
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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  raw.set(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = resolve(import.meta.dirname, '..', 'resources');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.png'), png);
console.log(`resources/icon.png: ${SIZE}×${SIZE}, face at ${scale}px per art pixel`);

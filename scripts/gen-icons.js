'use strict';

// Generates assets/tray-default.png and assets/icon.png with a tiny hand-rolled
// PNG encoder (zlib only — no native deps). The live tray icon is drawn in the
// renderer via canvas; tray-default.png is just the startup placeholder.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- PNG encoder (8-bit RGBA) ---------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- drawing ---------------------------------------------------------------
function insideRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const dx = Math.min(x - rx, rx + w - x);
  const dy = Math.min(y - ry, ry + h - y);
  if (dx >= r || dy >= r) return true;
  const cx = (x < rx + r) ? rx + r : rx + w - r;
  const cy = (y < ry + r) ? ry + r : ry + h - r;
  return Math.hypot(x - cx, y - cy) <= r;
}

function dist(x, y, cx, cy) { return Math.hypot(x - cx, y - cy); }

function render(size, draw) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = draw(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size);
          if (c) { a += c.a; r += c.r * c.a; g += c.g * c.a; b += c.b * c.a; }
        }
      }
      const idx = (y * size + x) * 4;
      const aa = a / (SS * SS);
      if (a > 0) { buf[idx] = Math.round(r / a); buf[idx + 1] = Math.round(g / a); buf[idx + 2] = Math.round(b / a); }
      buf[idx + 3] = Math.round(aa * 255);
    }
  }
  return buf;
}

function trayDraw(x, y, size) {
  const m = 2;
  if (insideRoundRect(x, y, m, m, size - 2 * m, size - 2 * m, size * 0.25)) {
    return { r: 142, g: 142, b: 147, a: 1 };
  }
  return null;
}

function appDraw(x, y, size) {
  const cx = size / 2, cy = size / 2, rad = size * 0.135;
  if (dist(x, y, cx, cy) <= rad) return { r: 47, g: 203, b: 83, a: 1 };
  const m = size * 0.06;
  if (insideRoundRect(x, y, m, m, size - 2 * m, size - 2 * m, size * 0.22)) {
    return { r: 28, g: 28, b: 30, a: 1 };
  }
  return null;
}

// --- write -----------------------------------------------------------------
const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'tray-default.png'), encodePNG(32, 32, render(32, trayDraw)));
fs.writeFileSync(path.join(assetsDir, 'icon.png'), encodePNG(256, 256, render(256, appDraw)));

console.log('Wrote assets/tray-default.png (32x32) and assets/icon.png (256x256)');

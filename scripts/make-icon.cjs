#!/usr/bin/env node
'use strict';

// Generates build/icon.png (512) and build/icon.ico (multi-size) without a
// rasterizer dependency. The mark is a warm arch holding a simple portrait:
// the same shape the app draws, reduced to an icon.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.resolve(__dirname, '..', 'build');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
  const k = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

function over(dst, color, alpha) {
  const a = clamp(alpha, 0, 1);
  dst[0] = dst[0] * (1 - a) + color[0] * a;
  dst[1] = dst[1] * (1 - a) + color[1] * a;
  dst[2] = dst[2] * (1 - a) + color[2] * a;
  dst[3] = dst[3] * (1 - a) + 1 * a;
}

function sdRoundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

function insideArch(x, y, inset = 0) {
  const halfW = 0.325 - inset;
  const centerY = 0.385;
  const bottom = 0.905 - inset;
  if (halfW <= 0) return false;
  if (y >= centerY) {
    return Math.abs(x - 0.5) <= halfW && y <= bottom;
  }
  return Math.hypot(x - 0.5, y - centerY) <= halfW;
}

function insideEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function shade(x, y) {
  const color = [0, 0, 0, 0];

  const mask = sdRoundRect(x, y, 0.5, 0.5, 0.485, 0.485, 0.17);
  if (mask > 0) return color;

  // Warm background, slightly brighter behind the portrait.
  const bgDist = Math.hypot((x - 0.5) * 1.0, (y - 0.38) * 1.15);
  const bgT = clamp(bgDist / 0.72, 0, 1);
  const bg = mix([0.19, 0.12, 0.085], [0.045, 0.032, 0.024], bgT);
  color[0] = bg[0];
  color[1] = bg[1];
  color[2] = bg[2];
  color[3] = 1;

  // A soft pool of light behind the head.
  const halo = clamp(1 - Math.hypot(x - 0.5, y - 0.38) / 0.45, 0, 1);
  over(color, [0.72, 0.42, 0.24], halo * halo * 0.16);

  // Arch interior.
  if (insideArch(x, y, 0.014)) {
    over(color, [0.085, 0.058, 0.043], 0.88);
  }

  // Inner gold hairline.
  if (insideArch(x, y, 0.024) && !insideArch(x, y, 0.027)) {
    over(color, [0.95, 0.76, 0.5], 0.22);
  }

  // Bust and neck sit in front of the arch fill.
  if (y >= 0.555 && y <= 0.64 && Math.abs(x - 0.5) <= 0.058) {
    const t = clamp((y - 0.555) / 0.085, 0, 1);
    over(color, mix([0.86, 0.64, 0.48], [0.62, 0.38, 0.29], t), 1);
  }

  if (y >= 0.575 && y <= 0.92) {
    const width = Math.min(0.365, 0.105 + (y - 0.575) * 1.15);
    if (Math.abs(x - 0.5) <= width) {
      const t = clamp((y - 0.575) / 0.345, 0, 1);
      const bust = mix([0.64, 0.37, 0.27], [0.31, 0.16, 0.12], t);
      over(color, bust, 1);
      const rim = clamp(1 - Math.abs(Math.abs(x - 0.5) - width) / 0.016, 0, 1);
      if (rim > 0) over(color, [0.95, 0.68, 0.42], rim * 0.16);
    }
  }

  // Head.
  if (insideEllipse(x, y, 0.5, 0.405, 0.138, 0.178)) {
    const t = clamp((y - 0.24) / 0.34, 0, 1);
    over(color, mix([0.93, 0.78, 0.62], [0.69, 0.44, 0.33], t), 1);
    const rim = clamp(1 - Math.hypot((x - 0.365) / 0.055, (y - 0.4) / 0.17), 0, 1);
    if (rim > 0) over(color, [1, 0.87, 0.7], rim * 0.12);
  }

  // Hair cap.
  if (insideEllipse(x, y, 0.5, 0.37, 0.15, 0.165) && y < 0.405 + (x - 0.5) * 0.1) {
    const t = clamp((y - 0.23) / 0.18, 0, 1);
    over(color, mix([0.21, 0.12, 0.085], [0.09, 0.055, 0.04], t), 1);
  }

  // Face marks: two calm eyes and a small mouth.
  if (insideEllipse(x, y, 0.455, 0.415, 0.014, 0.009)) over(color, [0.13, 0.085, 0.065], 0.92);
  if (insideEllipse(x, y, 0.545, 0.415, 0.014, 0.009)) over(color, [0.13, 0.085, 0.065], 0.92);
  if (insideEllipse(x, y, 0.5, 0.492, 0.026, 0.008)) over(color, [0.45, 0.22, 0.19], 0.9);

  // Sternum light: the one sign of life in the mark.
  const glowDist = Math.hypot(x - 0.5, y - 0.685);
  if (glowDist < 0.2) {
    const glow = Math.pow(1 - glowDist / 0.2, 2.2);
    over(color, [1, 0.74, 0.46], glow * 0.5);
  }
  if (glowDist < 0.024) {
    over(color, [1, 0.9, 0.72], clamp(1 - glowDist / 0.024, 0, 1) * 0.95);
  }

  // Arch outline, drawn last so it stays crisp.
  if (insideArch(x, y, 0) && !insideArch(x, y, 0.014)) {
    const t = clamp((y - 0.06) / 0.84, 0, 1);
    over(color, mix([0.95, 0.77, 0.49], [0.63, 0.36, 0.22], t), 1);
  }

  // Slight vignette.
  const vignette = clamp((Math.hypot(x - 0.5, y - 0.5) - 0.34) / 0.34, 0, 1);
  over(color, [0.02, 0.015, 0.012], vignette * 0.35);

  return color;
}

function render(size) {
  const buffer = Buffer.alloc(size * size * 4);
  const samples = 3;
  const step = 1 / (size * samples);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px * samples + sx + 0.5) * step;
          const y = (py * samples + sy + 0.5) * step;
          const color = shade(x, y);
          r += color[0];
          g += color[1];
          b += color[2];
          a += color[3];
        }
      }
      const n = samples * samples;
      const i = (py * size + px) * 4;
      buffer[i] = Math.round(clamp(r / n, 0, 1) * 255);
      buffer[i + 1] = Math.round(clamp(g / n, 0, 1) * 255);
      buffer[i + 2] = Math.round(clamp(b / n, 0, 1) * 255);
      buffer[i + 3] = Math.round(clamp(a / n, 0, 1) * 255);
    }
  }
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 2] = 0;
    directory[base + 3] = 0;
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

fs.mkdirSync(OUT, { recursive: true });

const png512 = encodePng(512, render(512));
fs.writeFileSync(path.join(OUT, 'icon.png'), png512);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = encodeIco(sizes.map((size) => ({ size, png: encodePng(size, render(size)) })));
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);

console.log(`[icon] wrote build/icon.png (${png512.length} bytes) and build/icon.ico (${ico.length} bytes)`);

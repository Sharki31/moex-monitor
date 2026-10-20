'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const table = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  table[n] = c;
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [13, 17, 23];
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  const s = size / 512;
  const rect = (x0, y0, x1, y1, col) => {
    for (let y = Math.round(y0 * s); y <= Math.round(y1 * s); y++) {
      if (y < 0 || y >= size) continue;
      for (let x = Math.round(x0 * s); x <= Math.round(x1 * s); x++) {
        if (x < 0 || x >= size) continue;
        const i = (y * size + x) * 4;
        px[i] = col[0];
        px[i + 1] = col[1];
        px[i + 2] = col[2];
        px[i + 3] = 255;
      }
    }
  };
  const green = [38, 166, 154];
  const red = [239, 83, 80];
  rect(100, 300, 180, 390, green);
  rect(133, 240, 147, 430, green);
  rect(216, 210, 296, 330, red);
  rect(249, 150, 263, 390, red);
  rect(332, 110, 412, 240, green);
  rect(365, 70, 379, 300, green);
  return png(size, size, px);
}

const outDir = path.join(__dirname, '..', 'public');
for (const size of [192, 512]) {
  const file = path.join(outDir, 'icon-' + size + '.png');
  fs.writeFileSync(file, makeIcon(size));
  console.log('written', file, fs.statSync(file).size, 'bytes');
}

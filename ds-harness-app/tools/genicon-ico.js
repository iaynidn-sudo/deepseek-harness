'use strict';
// Generates a 256x256 ICO (PNG-embedded) at assets/icon.ico for the packaged exe.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const size = 256;
const rgb = [37, 99, 235];
const raw = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) {
  raw[y * (size * 4 + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const o = y * (size * 4 + 1) + 1 + x * 4;
    raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255;
  }
}
const idat = zlib.deflateSync(raw);
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

// Build ICO wrapping the PNG
const icondir = Buffer.alloc(6);
icondir.writeUInt16LE(0, 0); icondir.writeUInt16LE(1, 2); icondir.writeUInt16LE(1, 4); // reserved, type=1, count=1
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;     // width/height 0 => 256
entry[2] = 0; entry[3] = 0;     // colors / reserved
entry.writeUInt16LE(1, 4);      // planes
entry.writeUInt16LE(32, 6);     // bit count
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);    // offset after icondir(6)+entry(16)=22
const ico = Buffer.concat([icondir, entry, png]);

const out = path.join(__dirname, '..', 'assets', 'icon.ico');
fs.writeFileSync(out, ico);
console.log('wrote', out, ico.length, 'bytes');

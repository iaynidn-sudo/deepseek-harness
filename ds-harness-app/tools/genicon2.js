'use strict';
// 高效生成 DS 应用图标 (1024 png + 多尺寸 ico + icns)
// 采用 SDF(有符号距离场) 一次性生成形状遮罩，复杂度 O(N)，秒级完成。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0, 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// SDF: 圆角矩形（返回到边缘的有符号距离，负=外部）
function sdfRoundRect(px, py, cx0, cy0, cx1, cy1, r) {
  const qx = Math.abs(px - (cx0 + cx1) / 2) - ((cx1 - cx0) / 2 - r);
  const qy = Math.abs(py - (cy0 + cy1) / 2) - ((cy1 - cy0) / 2 - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
// SDF: 圆（用于 D 右侧弧）
function sdfCircle(px, py, ccx, ccy, r) { return Math.hypot(px - ccx, py - ccy) - r; }
// 线段 SDF（用于描边）：点到线段距离
function sdfSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - x0) * dx + (py - y0) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function renderIcon(size) {
  const W = size, H = size;
  const rgba = Buffer.alloc(W * H * 4);
  const pad = size * 0.06;
  const r = size * 0.22;
  const x0 = pad, y0 = pad, x1 = W - pad, y1 = H - pad;
  const aa = Math.max(1, size * 0.006); // 抗锯齿宽度

  // 形状 SDF：圆角矩形 减去 (中心挖空形成字母前的底) —— 这里先画底板，字母后叠加白色
  // 字母几何
  const top = H * 0.32, bot = H * 0.68;
  const cxD = W * 0.35, cxS = W * 0.65;   // 拉开 D/S 间距
  const lw = Math.max(4, size * 0.038);      // 笔画半宽(稍细)
  const rad = (bot - top) / 2 - lw * 1.8;    // D 弧半径(留内空间)
  const dyc = (top + bot) / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dRect = sdfRoundRect(x + 0.5, y + 0.5, x0, y0, x1, y1, r);
      let alpha = clamp((-dRect) / aa, 0, 1); // 矩形填充 alpha
      if (alpha <= 0) continue;

      // 渐变（深蓝->蓝）
      const t = y / H;
      let R = lerp(18, 37, t), G = lerp(40, 99, t), B = lerp(110, 235, t);
      // 顶部高光
      if (dRect > -((y1 - y0) * 0.28)) {
        const hl = (1 - (-dRect) / ((y1 - y0) * 0.28)) * 0.16;
        R += 255 * hl; G += 255 * hl; B += 255 * hl;
      }
      // 内描边高光（边缘 1px 提亮）
      const edge = clamp((aa * 1.5 + dRect) / (aa * 1.5), 0, 1); // dRect 越接近0 越亮
      R = lerp(R, 120, (1 - edge) * 0.25);
      G = lerp(G, 170, (1 - edge) * 0.25);
      B = lerp(B, 255, (1 - edge) * 0.25);

      // 默认底色
      let cr = clamp(R, 0, 255), cg = clamp(G, 0, 255), cb = clamp(B, 0, 255), ca = alpha * 255;

      // 字母 DS（白色），用 SDF 并集
      // D: 左竖 + 右侧半椭圆(非整圆)
      const dStem = sdfSeg(x + 0.5, y + 0.5, cxD, top, cxD, bot) - lw;
      // 半椭圆：x 方向压缩为 radX, y 方向为 radY = (bot-top)/2
      const radX = rad * 0.85;
      const radY = (bot - top) / 2 - lw * 0.5;
      const dArc = Math.hypot((x + 0.5 - cxD) / radX, (y + 0.5 - dyc) / radY) - 1; // 只取 x>0 侧
      let dD = dStem;
      if (x + 0.5 > cxD) dD = Math.min(dD, dArc * Math.min(radX, radY)); // 右侧才用弧
      // S: 7 段折线（经典 S 形：上横→左下斜→中横(短)→右下斜→下横）
      const sw = rad * 0.65;
      const sMid = dyc;
      const spts = [
        [cxS + sw * 0.8, top],     [cxS - sw * 0.3, top],      // 上横(偏右)
        [cxS - sw * 0.3, top],      [cxS - sw * 1.1, sMid * 0.55], // 左下斜弯
        [cxS - sw * 1.1, sMid * 0.55],[cxS + sw * 0.2, sMid],   // 中横(短)
        [cxS + sw * 0.2, sMid],     [cxS + sw * 1.1, bot - (bot-sMid)*0.45], // 右下斜弯
        [cxS + sw * 1.1, bot - (bot-sMid)*0.45],[cxS - sw * 0.8, bot]   // 下横(偏左)
      ];
      let dS = Infinity;
      for (let i = 0; i < spts.length; i += 2) {
        const d = sdfSeg(x + 0.5, y + 0.5, spts[i][0], spts[i][1], spts[i + 1][0], spts[i + 1][1]) - lw;
        if (d < dS) dS = d;
      }
      const dLetter = Math.min(dD, dS);
      const la = clamp((-dLetter) / aa, 0, 1);
      if (la > 0) {
        // 字母内轻微阴影提升立体感
        const sh = la * 0.12;
        cr = lerp(cr, 255, la); cg = lerp(cg, 255, la); cb = lerp(cb, 255, la);
        ca = alpha * 255; // 保持不透明
        // 字母底部微调阴影已由底色覆盖
        void sh;
      }
      const i = (y * W + x) * 4;
      rgba[i] = cr; rgba[i + 1] = cg; rgba[i + 2] = cb; rgba[i + 3] = ca;
    }
  }
  return encodePNG(W, H, rgba);
}

const ASSETS = path.join(__dirname, '..', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

const t0 = Date.now();
const png1024 = renderIcon(1024);
fs.writeFileSync(path.join(ASSETS, 'icon.png'), png1024);
console.log('icon.png', png1024.length, (Date.now() - t0) + 'ms');

// ICO
function makeICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = [], imgData = [];
  let offset = 6 + pngs.length * 16;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e); imgData.push(p.data); offset += p.data.length;
  }
  return Buffer.concat([header, ...entries, ...imgData]);
}
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoPngs = icoSizes.map(s => ({ size: s, data: renderIcon(s) }));
fs.writeFileSync(path.join(ASSETS, 'icon.ico'), makeICO(icoPngs));
console.log('icon.ico done', (Date.now() - t0) + 'ms');

// ICNS
function makeICNS(entries) {
  let body = Buffer.alloc(0);
  for (const [type, data] of entries) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length + 8, 0);
    body = Buffer.concat([body, t, len, data]);
  }
  const header = Buffer.from('icns', 'ascii');
  const total = Buffer.alloc(4); total.writeUInt32BE(body.length + 8, 0);
  return Buffer.concat([header, total, body]);
}
const icnsEntries = [
  ['ic14', renderIcon(32)],
  ['ic11', renderIcon(64)],
  ['ic12', renderIcon(128)],
  ['ic07', renderIcon(128)],
  ['ic08', renderIcon(256)],
  ['ic13', renderIcon(512)],
  ['ic09', renderIcon(512)],
  ['ic10', renderIcon(1024)],
];
fs.writeFileSync(path.join(ASSETS, 'icon.icns'), makeICNS(icnsEntries));
console.log('icon.icns done', (Date.now() - t0) + 'ms');
console.log('ALL_DONE');

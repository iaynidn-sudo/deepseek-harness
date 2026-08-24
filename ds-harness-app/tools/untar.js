// 纯 Node.js 解压 tar.gz（避免 Windows tar 路径问题）
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const src = process.argv[2];
const dest = process.argv[3];
const outBin = process.argv[4];

if (!src || !dest || !outBin) {
  console.error('Usage: node untar.js <tar.gz> <extractDir> <outputNode>');
  process.exit(1);
}

const raw = fs.readFileSync(src);
console.log('Read', raw.length, 'bytes, decompressing...');

zlib.gunzip(raw, (err, data) => {
  if (err) { console.error('gunzip:', err.message); process.exit(1); }
  // Simple tar parser (ustar format)
  let pos = 0;
  const headerSize = 512;
  const files = [];
  while (pos < data.length - headerSize) {
    const name = data.slice(pos, pos + 100).toString('ascii').replace(/\0.*$/, '');
    if (!name || name.length === 0) { pos += headerSize; continue; }
    const sizeStr = data.slice(pos + 124, pos + 124 + 11).toString('ascii').replace(/\0.*$/, '');
    const size = parseInt(sizeStr, 8) || 0;
    const type = String.fromCharCode(data[pos + 156]); // '0' or '\0' = file
    if (type === '0' || type === '\0') {
      files.push({ name, size, start: pos + headerSize });
    }
    pos += headerSize + Math.ceil(size / 512) * 512;
  }

  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  for (const f of files) {
    // Only extract 'node' binary and skip leading directory
    const parts = f.name.split('/');
    const baseName = parts[parts.length - 1];
    if (baseName === 'node' && !f.name.includes('/lib/')) {
      const fdata = data.slice(f.start, f.start + f.size);
      fs.writeFileSync(outBin, fdata);
      fs.chmodSync(outBin, 0o755);
      console.log('EXTRACTED node ->', outBin, fdata.length, 'bytes');
      return;
    }
  }
  // Fallback: find any file named 'node'
  for (const f of files) {
    if (f.name.endsWith('/node') && !f.name.includes('/lib/')) {
      const fdata = data.slice(f.start, f.start + f.size);
      fs.writeFileSync(outBin, fdata);
      fs.chmodSync(outBin, 0o755);
      console.log('EXTRACTED (fallback)', f.name, '->', outBin, fdata.length, 'bytes');
      return;
    }
  }
  console.error('node binary not found in archive. Files:', files.map(f => f.name).join(', '));
  process.exit(1);
});

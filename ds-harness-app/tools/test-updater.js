'use strict';
// 自动更新核心逻辑端到端测试（复用 main.js 的实现逻辑）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const os = require('os');

// ---- 从 main.js 复制的纯函数 ----
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000, headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('JSON 解析失败')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', (e) => reject(e));
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/octet-stream', 'User-Agent': 'ds-harness-updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { received += c.length; if (onProgress) onProgress(received, total); });
      res.pipe(out);
      out.on('finish', () => resolve(dest));
      out.on('error', reject);
      req.on('error', reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error('下载超时')));
  });
}

function parseTar(buf) {
  const out = [];
  let pos = 0;
  let pendingLongName = null;
  while (pos + 512 <= buf.length) {
    const header = buf.slice(pos, pos + 512);
    let name = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeStr = header.slice(124, 136).toString('utf8').replace(/[^0-7]/g, '');
    const size = parseInt(sizeStr || '0', 8);
    const modeStr = header.slice(100, 108).toString('utf8').replace(/[^0-7]/g, '');
    const mode = parseInt(modeStr || '0', 8);
    const type = header[156];
    const prefix = header.slice(345, 500).toString('utf8').replace(/\0.*$/, '');
    const dataStart = pos + 512;
    const dataEnd = dataStart + size;
    if (type === 76) {
      pendingLongName = buf.slice(dataStart, dataEnd).toString('utf8').replace(/\0.*$/, '');
      pos = Math.ceil(dataEnd / 512) * 512;
      continue;
    }
    const fullName = pendingLongName || (prefix ? prefix + '/' + name : name);
    pendingLongName = null;
    if (type === 48 || type === 0) {
      out.push({ name: fullName, mode, type: 0, data: buf.slice(dataStart, dataEnd) });
    } else if (type === 53) {
      out.push({ name: fullName, mode, type: 5 });
    }
    pos = Math.ceil(dataEnd / 512) * 512;
  }
  return out;
}

function extractTgz(tgzPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.readFile(tgzPath, (err, raw) => {
      if (err) return reject(err);
      zlib.gunzip(raw, (gErr, data) => {
        if (gErr) return reject(gErr);
        try {
          const entries = parseTar(data);
          fs.mkdirSync(destDir, { recursive: true });
          for (const f of entries) {
            let rel = f.name.replace(/^package\//, '');
            if (!rel) continue;
            const parts = rel.split('/');
            if (parts.some((p) => p === '..')) continue;
            const outPath = path.join(destDir, ...parts);
            if (f.type === 5) { fs.mkdirSync(outPath, { recursive: true }); continue; }
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, f.data);
            if (f.mode) { try { fs.chmodSync(outPath, f.mode & 0o777); } catch (e) {} }
          }
          resolve(destDir);
        } catch (e) { reject(e); }
      });
    });
  });
}

// ---- 测试 ----
async function main() {
  console.log('[1] 查询 @deepseek-ai/dsh 最新版本...');
  const meta = await fetchJson('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest');
  const latest = meta.version;
  const tarball = meta.dist && meta.dist.tarball;
  console.log('    latest =', latest);
  console.log('    tarball =', tarball);
  if (!tarball) throw new Error('无 tarball 字段');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-upd-'));
  const tgzPath = path.join(tmp, 'dsh.tgz');
  console.log('[2] 下载 tarball...');
  await downloadFile(tarball, tgzPath, (recv, total) => {
    const pct = total ? Math.round(recv / total * 100) : 0;
    process.stdout.write('\r    下载 ' + pct + '% (' + (recv / 1048576).toFixed(1) + '/' + (total / 1048576).toFixed(1) + ' MB)   ');
  });
  console.log('\n    下载完成:', (fs.statSync(tgzPath).size / 1048576).toFixed(2) + ' MB');

  console.log('[3] 解压...');
  const extractDir = path.join(tmp, 'pkg');
  await extractTgz(tgzPath, extractDir);

  console.log('[4] 校验版本...');
  const pkgPath = path.join(extractDir, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error('package.json 缺失');
  const pkgVer = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  console.log('    包内版本 =', pkgVer, '| 期望 =', latest, '|', pkgVer === latest ? 'PASS' : 'FAIL');
  if (pkgVer !== latest) throw new Error('版本不一致');

  const binPath = path.join(extractDir, 'lib', 'bin.js');
  console.log('[5] 关键文件 bin.js:', fs.existsSync(binPath) ? 'EXISTS ✓' : 'MISSING ✗');
  const fileCount = fs.readdirSync(extractDir, { recursive: true }).length;
  console.log('[6] 解压文件数:', fileCount);
  console.log('\n===== ALL TESTS PASSED =====');
}

main().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });

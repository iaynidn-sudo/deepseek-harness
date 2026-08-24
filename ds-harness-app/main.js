'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const https = require('https');

const DSH_PORT = parseInt(process.env.DSH_PORT || '3080', 10);
const DSH_HOST = '127.0.0.1';
const ROOT = __dirname;
const IS_WIN = process.platform === 'win32';
const NODE_BIN = path.join(ROOT, 'bin', IS_WIN ? 'node.exe' : 'node');
const DSH_BIN = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const DSH_HOME = path.join(ROOT, '.dsh');
const DSH_PKG = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const SETTINGS_PATH = path.join(ROOT, 'settings.json');
const APP_VERSION = require('./package.json').version;
const NPM_LATEST_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest';

let dshProc = null;
let mainWin = null;
let splashWin = null;
let tray = null;
let settingsWin = null;
let helpWin = null;
let quitting = false;

// ---------------------------------------------------------------------------
// Settings (persisted JSON)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  autoUpdate: true,          // 是否启用启动时的自动更新检测
  apiKey: '',                // 可选：DeepSeek API Key
  checkOnStartup: true       // 同 autoUpdate，保留以兼容语义
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      return Object.assign({}, DEFAULT_SETTINGS, raw);
    }
  } catch (e) { /* fall through to defaults */ }
  return Object.assign({}, DEFAULT_SETTINGS);
}

function saveSettings(s) {
  const merged = Object.assign(loadSettings(), s || {});
  // only persist known keys
  const out = {
    autoUpdate: !!merged.autoUpdate,
    apiKey: typeof merged.apiKey === 'string' ? merged.apiKey : '',
    checkOnStartup: !!merged.checkOnStartup
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(out, null, 2), 'utf8');
  // if api key changed, push into .env so dsh picks it up on next start
  if ('apiKey' in (s || {})) {
    try {
      const envPath = path.join(ROOT, '.env');
      let content = '';
      if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
      content = content.replace(/^\s*DEEPSEEK_API_KEY\s*=.*$/m, '');
      content = content.split(/\r?\n/).filter(Boolean).join('\n');
      if (out.apiKey) content += (content ? '\n' : '') + 'DEEPSEEK_API_KEY=' + out.apiKey;
      content += '\n';
      fs.writeFileSync(envPath, content, 'utf8');
    } catch (e) { /* ignore */ }
  }
  return out;
}

let settings = loadSettings();

// ---------------------------------------------------------------------------
// Version / update detection
// ---------------------------------------------------------------------------
function getLocalDshVersion() {
  try {
    if (fs.existsSync(DSH_PKG)) return require(DSH_PKG).version || 'unknown';
  } catch (e) {}
  return 'unknown';
}

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

// 下载文件到本地（自动跟随 302 重定向，支持进度回调）
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

// 解析 tar 归档（ustar 格式，支持 GNU 长文件名 / prefix）
function parseTar(buf) {
  const out = [];
  let pos = 0;
  let pendingLongName = null;
  while (pos + 512 <= buf.length) {
    const header = buf.slice(pos, pos + 512);
    let name = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break; // 零块结束
    const sizeStr = header.slice(124, 136).toString('utf8').replace(/[^0-7]/g, '');
    const size = parseInt(sizeStr || '0', 8);
    const modeStr = header.slice(100, 108).toString('utf8').replace(/[^0-7]/g, '');
    const mode = parseInt(modeStr || '0', 8);
    const type = header[156];
    const prefix = header.slice(345, 500).toString('utf8').replace(/\0.*$/, '');
    const dataStart = pos + 512;
    const dataEnd = dataStart + size;
    if (type === 76) { // 'L' GNU 长文件名
      pendingLongName = buf.slice(dataStart, dataEnd).toString('utf8').replace(/\0.*$/, '');
      pos = Math.ceil(dataEnd / 512) * 512;
      continue;
    }
    const fullName = pendingLongName || (prefix ? prefix + '/' + name : name);
    pendingLongName = null;
    if (type === 48 || type === 0) { // '0' 普通文件
      out.push({ name: fullName, mode, type: 0, data: buf.slice(dataStart, dataEnd) });
    } else if (type === 53) { // '5' 目录
      out.push({ name: fullName, mode, type: 5 });
    }
    pos = Math.ceil(dataEnd / 512) * 512;
  }
  return out;
}

// 解压 tar.gz 到目录（安全：拒绝路径穿越），返回是否成功
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
            let rel = f.name.replace(/^package\//, ''); // npm tarball 统一 package/ 前缀
            if (!rel) continue;
            const parts = rel.split('/');
            if (parts.some((p) => p === '..')) continue; // 防御路径穿越
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

// Returns { updateAvailable, local, latest, error }
async function checkUpdate() {
  const local = getLocalDshVersion();
  try {
    const data = await fetchJson(NPM_LATEST_URL);
    const latest = data.version || 'unknown';
    const updateAvailable = local !== 'unknown' && latest !== 'unknown' && local !== latest;
    return { updateAvailable, local, latest };
  } catch (e) {
    return { updateAvailable: false, local, latest: 'unknown', error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (mainWin) { mainWin.show(); mainWin.focus(); }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isPortOpen(port, host = DSH_HOST) {
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    s.setTimeout(1500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function loadEnvFile(env) {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* ignore */ }
}

function startDsh() {
  let nodeBin = NODE_BIN;
  if (!fs.existsSync(nodeBin)) {
    // Mac/Linux: 尝试系统 node
    if (!IS_WIN) {
      const which = require('child_process').execSync('which node 2>/dev/null || echo ""').toString().trim();
      if (which) nodeBin = which;
    }
  }
  if (!fs.existsSync(nodeBin) || !fs.existsSync(DSH_BIN)) {
    return Promise.reject(new Error('未找到内置 node 或 dsh，请保持文件夹结构完整'));
  }
  // 自愈：Mac/Linux 解压后可能丢失执行权限位，主动补 755
  if (!IS_WIN) {
    try { fs.chmodSync(nodeBin, 0o755); } catch (e) { /* ignore */ }
  }
  const env = Object.assign({}, process.env);
  delete env.NODE_OPTIONS;            // strip any injected safe-delete shim
  env.DSH_HOME = DSH_HOME;
  loadEnvFile(env);                   // .env may carry DEEPSEEK_API_KEY etc.
  dshProc = spawn(nodeBin, [DSH_BIN, 'web', '--host', DSH_HOST, '--port', String(DSH_PORT)], {
    env, cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  dshProc._spawnError = null;
  dshProc.on('error', (err) => {     // EACCES / ENOENT 等：立即记录，避免干等超时
    dshProc._spawnError = err;
    console.error('[dsh] spawn error:', err);
  });
  dshProc.stdout.on('data', () => {});
  dshProc.stderr.on('data', (d) => { console.error('[dsh]', d.toString()); });
  dshProc.on('exit', (code) => { if (!quitting) console.log('[dsh] exited with', code); });
  return Promise.resolve();
}

function waitForDsh(timeoutMs = 180000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function loop() {
      // 进程 spawn 失败（如权限不足）或已退出且端口未开 → 快速失败，给出可操作的提示
      if (dshProc) {
        if (dshProc._spawnError) {
          return reject(new Error('无法启动内置 node：' + dshProc._spawnError.message +
            '（Mac 请先双击 fix-gatekeeper.command，或重新解压安装包）'));
        }
        if (dshProc.exitCode !== null) {
          return reject(new Error('dsh 进程异常退出（code=' + dshProc.exitCode + '），请通过托盘「重启 dsh 服务」重试'));
        }
      }
      isPortOpen(DSH_PORT).then((open) => {
        if (open) return resolve(true);
        if (Date.now() - t0 > timeoutMs) return reject(new Error('dsh 启动超时（' + (timeoutMs / 1000) + 's），请检查网络后重试'));
        setTimeout(loop, 1500);
      });
    })();
  });
}

function ensureIcon() {
  const iconPath = path.join(ROOT, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) return iconPath;
  try {
    const size = 64;
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
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, png);
    return iconPath;
  } catch (e) { return null; }
}

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function createWindow(startErr) {
  const iconPath = ensureIcon();
  mainWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    title: 'DeepSeek Harness',
    icon: iconPath || undefined,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (startErr) {
    // dsh 未能启动：加载本地错误页，明确展示原因与解决步骤
    mainWin.loadFile(path.join(ROOT, 'error.html'), { query: { msg: startErr.message } });
  } else {
    mainWin.loadURL(`http://${DSH_HOST}:${DSH_PORT}`);
    mainWin.webContents.on('did-fail-load', (_e, _code, _desc, url) => {
      if (url && url.startsWith('http') && mainWin) {
        const msg = '无法连接本地 dsh 服务，请检查服务是否被占用或通过托盘「重启 dsh 服务」重试。';
        mainWin.loadFile(path.join(ROOT, 'error.html'), { query: { msg } });
      }
    });
  }
  // 兜底：15 秒内页面未就绪也强制显示窗口（避免永远白屏/无窗口）
  const forceShowTimer = setTimeout(() => {
    if (mainWin && !mainWin.isVisible()) { mainWin.show(); }
  }, 15000);
  mainWin.once('ready-to-show', () => {
    clearTimeout(forceShowTimer);
    if (mainWin) mainWin.show();
  });
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
}

function showSplash() {
  splashWin = new BrowserWindow({
    width: 440, height: 340, frame: false, resizable: false,
    transparent: false, alwaysOnTop: true, center: true
  });
  splashWin.loadFile(path.join(ROOT, 'splash.html'));
}

function closeSplash() {
  if (splashWin) { splashWin.close(); splashWin = null; }
}

function createSettingsWindow() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 600, resizable: false, center: true,
    title: '设置 - DeepSeek Harness',
    parent: mainWin || undefined, modal: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile(path.join(ROOT, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function createHelpWindow() {
  if (helpWin) { helpWin.show(); helpWin.focus(); return; }
  helpWin = new BrowserWindow({
    width: 640, height: 680, resizable: true, center: true,
    title: '帮助 - DeepSeek Harness',
    parent: mainWin || undefined, modal: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  helpWin.loadFile(path.join(ROOT, 'help.html'));
  helpWin.on('closed', () => { helpWin = null; });
}

let updateWin = null;
let updating = false;

function createUpdateWindow(latest) {
  if (updateWin) { updateWin.show(); updateWin.focus(); return updateWin; }
  updateWin = new BrowserWindow({
    width: 480, height: 300, resizable: false, center: true,
    title: '正在更新 - DeepSeek Harness',
    parent: mainWin || undefined, modal: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  updateWin.loadFile(path.join(ROOT, 'update.html'), { query: { version: latest } });
  updateWin.on('closed', () => { updateWin = null; });
  return updateWin;
}

function setUpdateStatus(status, detail) {
  if (updateWin && !updateWin.isDestroyed()) {
    updateWin.webContents.executeJavaScript(`setStatus(${JSON.stringify(status)}, ${JSON.stringify(detail || '')})`).catch(() => {});
  }
}

// 停止 dsh 进程并等待完全退出（Windows 上替换文件前必须）
function stopDshAndWait() {
  return new Promise((resolve) => {
    if (!dshProc || dshProc.exitCode !== null) return resolve();
    const done = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(done, 4000);
    dshProc.once('exit', done);
    try { dshProc.kill(); } catch (e) { done(); }
  });
}

// 自动更新：下载 dsh 最新 tarball → 解压 → 备份替换 → 重启 dsh
async function performAutoUpdate(latest) {
  if (updating) return;
  updating = true;
  const tmpRoot = path.join(ROOT, '.update-tmp');
  const dshDir = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh');
  const bakDir = path.join(ROOT, 'node_modules', '@deepseek-ai', '.dsh.bak');
  const win = createUpdateWindow(latest);
  try {
    // 1. 获取最新版元数据（含 tarball 地址）
    setUpdateStatus('fetch', '获取最新版本信息…');
    const meta = await fetchJson(NPM_LATEST_URL);
    const tarball = (meta.dist && meta.dist.tarball) || `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${latest}.tgz`;
    const targetVersion = meta.version || latest;

    // 2. 下载
    setUpdateStatus('download', '准备下载…');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tgzPath = path.join(tmpRoot, 'dsh.tgz');
    await downloadFile(tarball, tgzPath, (recv, total) => {
      const pct = total ? Math.min(100, Math.round(recv / total * 100)) : 0;
      setUpdateStatus('download', `下载中 ${pct}%（${(recv / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB）`);
    });

    // 3. 解压并校验版本
    setUpdateStatus('extract', '解压更新包…');
    const extractDir = path.join(tmpRoot, 'pkg');
    await extractTgz(tgzPath, extractDir);
    const pkgPath = path.join(extractDir, 'package.json');
    if (!fs.existsSync(pkgPath)) throw new Error('更新包结构异常（缺少 package.json）');
    const pkgVer = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    if (pkgVer !== targetVersion) throw new Error('更新包版本校验失败（' + pkgVer + ' ≠ ' + targetVersion + '）');

    // 4. 停 dsh → 备份旧包 → 替换 → 清理备份
    setUpdateStatus('install', '安装更新…');
    await stopDshAndWait();
    if (fs.existsSync(bakDir)) fs.rmSync(bakDir, { recursive: true, force: true });
    if (fs.existsSync(dshDir)) fs.renameSync(dshDir, bakDir);
    fs.renameSync(extractDir, dshDir);
    try { if (fs.existsSync(bakDir)) fs.rmSync(bakDir, { recursive: true, force: true }); } catch (e) { /* 残留备份无害 */ }
    try { if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

    // 5. 重启 dsh
    setUpdateStatus('restart', '正在重启 dsh 服务…');
    dshProc = null;
    try {
      await startDsh();
      await waitForDsh();
    } catch (e) {
      // 启动失败：回滚到旧包再试一次
      setUpdateStatus('rollback', '启动异常，回滚到旧版本…');
      await stopDshAndWait();
      if (fs.existsSync(dshDir)) fs.rmSync(dshDir, { recursive: true, force: true });
      if (fs.existsSync(bakDir)) fs.renameSync(bakDir, dshDir);
      dshProc = null;
      await startDsh();
      await waitForDsh();
    }
    if (mainWin) { mainWin.loadURL(`http://${DSH_HOST}:${DSH_PORT}`); mainWin.show(); }
    if (updateWin) { updateWin.close(); updateWin = null; }
    dialog.showMessageBox({ type: 'info', title: '更新完成', message: `dsh 已更新到 v${targetVersion} 并自动重启。` });
  } catch (e) {
    console.error('[update] 失败:', e);
    setUpdateStatus('error', e.message || String(e));
  } finally {
    updating = false;
  }
}

async function promptUpdateIfNeeded() {
  if (!settings.autoUpdate) return;            // 用户关闭了自动更新检测
  let info;
  try { info = await checkUpdate(); } catch (e) { return; }
  if (!info.updateAvailable) return;
  if (!mainWin) return;
  const choice = dialog.showMessageBoxSync(mainWin, {
    type: 'info',
    title: '发现新版本',
    message: `检测到 dsh 引擎有新版本\n\n当前：${info.local}\n最新：${info.latest}`,
    detail: '点击「立即更新」将自动下载并安装，完成后自动重启生效，全程无需手动操作。',
    buttons: ['立即更新', '稍后'],
    defaultId: 0,
    cancelId: 1
  });
  if (choice === 0) {
    performAutoUpdate(info.latest);
  }
}

function createTray() {
  const p = ensureIcon();
  const img = p ? nativeImage.createFromPath(p) : nativeImage.createFromDataURL(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  tray = new Tray(img);
  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
    { label: '刷新页面', click: () => { if (mainWin) mainWin.reload(); } },
    { label: '重启 dsh 服务', click: () => restartDsh() },
    { type: 'separator' },
    { label: '设置', click: () => createSettingsWindow() },
    { label: '帮助', click: () => createHelpWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; if (dshProc) try { dshProc.kill(); } catch (e) {} app.quit(); } }
  ]);
  tray.setToolTip('DeepSeek Harness');
  tray.setContextMenu(menu);
  tray.on('click', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
}

async function restartDsh() {
  try { if (dshProc) dshProc.kill(); } catch (e) {}
  dshProc = null;
  try {
    await startDsh();
    await waitForDsh();
    if (mainWin) { mainWin.show(); mainWin.loadURL(`http://${DSH_HOST}:${DSH_PORT}`); }
  } catch (e) {
    if (mainWin) {
      mainWin.loadFile(path.join(ROOT, 'error.html'), { query: { msg: e.message } });
      mainWin.show();
    }
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('restart-dsh', () => restartDsh());
ipcMain.on('open-settings', () => createSettingsWindow());
ipcMain.on('open-help', () => createHelpWindow());
ipcMain.on('open-release-page', () => shell.openExternal('https://www.npmjs.com/package/@deepseek-ai/dsh'));

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (e, s) => saveSettings(s));
ipcMain.handle('get-app-version', () => APP_VERSION);
ipcMain.handle('get-local-dsh-version', () => getLocalDshVersion());
ipcMain.handle('check-update', () => checkUpdate());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  const already = await isPortOpen(DSH_PORT);
  let startErr = null;
  if (!already) {
    try {
      await startDsh();
      await waitForDsh();
    } catch (e) {
      startErr = e;
      console.error('[boot] dsh 启动失败:', e.message);
      if (splashWin) splashWin.webContents.executeJavaScript(`showError(${JSON.stringify(e.message)})`).catch(() => {});
      // 关键：失败也继续 → 关闭 splash、建立主窗口（显示错误页）、托盘可用，可重试
    }
  }
  createWindow(startErr);
  closeSplash();
  createTray();
  // 启动后异步检测版本更新（不阻塞主流程）
  promptUpdateIfNeeded();
}

app.whenReady().then(async () => {
  showSplash();
  await boot();
});

app.on('window-all-closed', () => { /* keep running in tray */ });

app.on('before-quit', () => { quitting = true; if (dshProc) try { dshProc.kill(); } catch (e) {} });

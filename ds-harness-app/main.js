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
    // Mac: 尝试系统 node
    if (!IS_WIN) {
      const which = require('child_process').execSync('which node 2>/dev/null || echo ""').toString().trim();
      if (which) nodeBin = which;
    }
  }
  if (!fs.existsSync(nodeBin) || !fs.existsSync(DSH_BIN)) {
    return Promise.reject(new Error('未找到内置 node 或 dsh，请保持文件夹结构完整'));
  }
  const env = Object.assign({}, process.env);
  delete env.NODE_OPTIONS;            // strip any injected safe-delete shim
  env.DSH_HOME = DSH_HOME;
  loadEnvFile(env);                   // .env may carry DEEPSEEK_API_KEY etc.
  dshProc = spawn(nodeBin, [DSH_BIN, 'web', '--host', DSH_HOST, '--port', String(DSH_PORT)], {
    env, cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
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
      isPortOpen(DSH_PORT).then((open) => {
        if (open) return resolve(true);
        if (Date.now() - t0 > timeoutMs) return reject(new Error('dsh 启动超时'));
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
function createWindow() {
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
  mainWin.loadURL(`http://${DSH_HOST}:${DSH_PORT}`);
  mainWin.once('ready-to-show', () => { if (mainWin) mainWin.show(); });
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

async function promptUpdateIfNeeded() {
  if (!settings.autoUpdate) return;            // 用户关闭了自动更新检测
  let info;
  try { info = await checkUpdate(); } catch (e) { return; }
  if (!info.updateAvailable) return;
  if (!mainWin) return;
  const choice = dialog.showMessageBoxSync(mainWin, {
    type: 'info',
    title: '发现新版本',
    message: `检测到 @deepseek-ai/dsh 有新版本\n\n当前：${info.local}\n最新：${info.latest}`,
    detail: '本客户端为自包含离线包，更新需重新下载打包。是否打开更新说明页面？',
    buttons: ['打开更新页', '忽略'],
    defaultId: 0,
    cancelId: 1
  });
  if (choice === 0) {
    shell.openExternal('https://www.npmjs.com/package/@deepseek-ai/dsh');
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
    if (mainWin) mainWin.webContents.executeJavaScript(`alert('重启 dsh 失败: ${e.message}')`).catch(() => {});
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
  if (!already) {
    try {
      await startDsh();
      await waitForDsh();
    } catch (e) {
      if (splashWin) splashWin.webContents.executeJavaScript(`showError(${JSON.stringify(e.message)})`).catch(() => {});
    }
  }
  createWindow();
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

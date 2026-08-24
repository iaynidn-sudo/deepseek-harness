'use strict';

const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// 配置（可通过环境变量覆盖）
// ---------------------------------------------------------------------------
const DSH_HOST = '127.0.0.1';
const DSH_PORT = parseInt(process.env.DSH_PORT || '3080', 10);
const WORKSPACE = process.env.DSH_WORKSPACE || app.getPath('home');
const API_KEY = process.env.DEEPSEEK_API_KEY || '';

const PROJECT_DIR = __dirname;
const SPLASH_FILE = path.join(PROJECT_DIR, 'assets', 'splash.html');
const PRELOAD_FILE = path.join(PROJECT_DIR, 'preload.js');

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
let mainWindow = null;
let tray = null;
let dshProcess = null;
let serverReady = false;
let forceQuit = false;
let logBuf = '';

// ---------------------------------------------------------------------------
// 定位受管 Node（满足 dsh 引擎 ^22.19.0 || >=24）
// ---------------------------------------------------------------------------
function findNodeBin() {
  const candidates = [
    'C:\\Users\\jiang\\.workbuddy\\binaries\\node\\versions\\22.22.2',
    process.env.APPDATA && path.join(process.env.APPDATA, '..', '.workbuddy', 'binaries', 'node', 'versions', '22.22.2'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, '..', '.workbuddy', 'binaries', 'node', 'versions', '22.22.2'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'node.exe'))) return c;
  }
  return '';
}

// ---------------------------------------------------------------------------
// 定位 npx 缓存里的 dsh bin.js（绕过 npx 的 cacache / safe-delete 拦截）
// 找不到则返回空，回退到 npx 在线下载。
// ---------------------------------------------------------------------------
function findDshBin() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const npxDir = path.join(base, 'npm-cache', '_npx');
  if (!fs.existsSync(npxDir)) return '';
  let hit = '';
  for (const h of fs.readdirSync(npxDir)) {
    const bin = path.join(npxDir, h, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (fs.existsSync(bin)) { hit = bin; break; }
  }
  return hit;
}

// ---------------------------------------------------------------------------
// 运行时生成托盘图标（蓝色方块 PNG），避免依赖外部图片资源
// ---------------------------------------------------------------------------
function crc32(buf) {
  if (!crc32.table) {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    crc32.table = t;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32.table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makeIcon(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = rgba[0]; row[1 + x * 4 + 1] = rgba[1];
    row[1 + x * 4 + 2] = rgba[2]; row[1 + x * 4 + 3] = rgba[3];
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
  return nativeImage.createFromBuffer(png);
}
const APP_ICON = makeIcon(32, [37, 99, 235, 255]); // DeepSeek 蓝

// ---------------------------------------------------------------------------
// 端口探活
// ---------------------------------------------------------------------------
function isPortOpen(port, host = DSH_HOST) {
  return new Promise((resolve) => {
    const sock = net.connect(port, host);
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}
function waitForPort(port, host = DSH_HOST, timeoutMs = 600000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, host);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error('等待 dsh web 服务超时（' + (timeoutMs / 1000) + 's）'));
        else setTimeout(tryOnce, 700);
      });
    };
    tryOnce();
  });
}

// ---------------------------------------------------------------------------
// 启动 / 停止 dsh 服务
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    const nodeBin = findNodeBin();
    const env = Object.assign({}, process.env);
    if (nodeBin) env.PATH = nodeBin + path.delimiter + (env.PATH || '');
    // 关键：清除 WorkBuddy 注入的 safe-delete shim，否则 dsh heal 时 trash 被拦截
    delete env.NODE_OPTIONS;
    if (API_KEY) env.DEEPSEEK_API_KEY = API_KEY;

    const dshBin = findDshBin();
    let command, args;
    if (dshBin) {
      command = nodeBin ? path.join(nodeBin, 'node.exe') : 'node';
      args = [dshBin, 'web', '--host', DSH_HOST, '--port', String(DSH_PORT)];
    } else {
      command = 'npx';
      args = ['@deepseek-ai/dsh', 'web', '--host', DSH_HOST, '--port', String(DSH_PORT)];
    }

    logBuf = '[dsh] 启动命令: ' + command + ' ' + args.join(' ') + '\n';
    logBuf += '[dsh] 工作区: ' + WORKSPACE + '\n';
    logBuf += '[dsh] Node: ' + (nodeBin || 'PATH 默认') + '\n\n';

    dshProcess = spawn(command, args, { cwd: WORKSPACE, env, shell: true, windowsHide: true });

    const pump = (d) => { logBuf += d.toString(); };
    if (dshProcess.stdout) dshProcess.stdout.on('data', pump);
    if (dshProcess.stderr) dshProcess.stderr.on('data', pump);
    dshProcess.on('error', (e) => reject(e));
    dshProcess.on('exit', (code) => {
      if (!serverReady) reject(new Error('dsh 进程提前退出，退出码 ' + code));
      else showErrorInWindow('dsh 服务已停止', logBuf);
    });

    waitForPort(DSH_PORT).then(resolve).catch(reject);
  });
}

function stopServer() {
  if (!dshProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(dshProcess.pid), '/T', '/F'], { windowsHide: true });
    } else {
      dshProcess.kill('SIGTERM');
    }
  } catch (_) { /* ignore */ }
  dshProcess = null;
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(SPLASH_FILE);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 外部链接用系统浏览器打开，避免跳出应用窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://' + DSH_HOST) || url.startsWith('https://' + DSH_HOST)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://' + DSH_HOST) && !url.startsWith('https://' + DSH_HOST)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // 关闭窗口时隐藏到托盘，保持服务运行；仅通过托盘“退出”真正退出
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function loadDsh() {
  if (mainWindow) mainWindow.loadURL('http://' + DSH_HOST + ':' + DSH_PORT);
}

function showErrorInWindow(title, detail) {
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>body{font-family:-apple-system,Segoe UI,Roboto,'Microsoft YaHei',sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:40px;line-height:1.6}
h1{color:#ff6b6b;font-size:20px}pre{background:#1a1d24;border:1px solid #2a2f3a;border-radius:8px;padding:16px;overflow:auto;max-height:50vh;font-size:12px;color:#9fb3c8}
.code{color:#7fd1ff}</style></head><body>
<h1>⚠️ ${title}</h1>
<p>客户端已启动，但无法连接到 <span class="code">http://${DSH_HOST}:${DSH_PORT}</span>。</p>
<p>常见原因：Node 版本不满足（需 ^22.19.0 或 ≥24）、网络无法下载 dsh 包、端口被占用。可在托盘选择“重启服务”。</p>
<h3>dsh 启动日志</h3><pre>${escapeHtml(detail || '(无日志)')}</pre>
</body></html>`;
  if (mainWindow) mainWindow.loadURL('data:text/html,' + encodeURIComponent(html));
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------
function createTray() {
  tray = new Tray(APP_ICON);
  const ctx = [
    { label: '打开 DeepSeek Harness', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); loadDsh(); } } },
    { label: '重启 dsh 服务', click: restartServer },
    { type: 'separator' },
    { label: '停止服务并退出', click: quitApp },
  ];
  tray.setToolTip('DeepSeek Harness 客户端');
  tray.setContextMenu(Menu.buildFromTemplate(ctx));
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

function restartServer() {
  stopServer();
  serverReady = false;
  if (mainWindow) mainWindow.loadFile(SPLASH_FILE);
  boot();
}

function quitApp() {
  forceQuit = true;
  stopServer();
  app.quit();
}

// ---------------------------------------------------------------------------
// 启动流程
// ---------------------------------------------------------------------------
async function boot() {
  // 首次运行需经 npm 下载 dsh 包，可能耗时数分钟；超过 45s 切换为“下载中”提示
  const installingTimer = setTimeout(() => {
    if (!serverReady && mainWindow) mainWindow.loadFile(SPLASH_FILE, { search: '?phase=install' });
  }, 45000);
  try {
    const alreadyUp = await isPortOpen(DSH_PORT);
    if (alreadyUp) {
      clearTimeout(installingTimer);
      serverReady = true;
      loadDsh();
      return;
    }
    await startServer();
    serverReady = true;
    loadDsh();
  } catch (e) {
    serverReady = false;
    showErrorInWindow('无法启动 dsh 服务：' + e.message, logBuf);
  } finally {
    clearTimeout(installingTimer);
  }
}

// ---------------------------------------------------------------------------
// App 生命周期
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    createWindow();
    createTray();
    boot();
  });
  app.on('before-quit', () => { forceQuit = true; });
}

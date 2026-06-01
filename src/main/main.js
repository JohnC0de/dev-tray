'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain,
  shell, clipboard, screen, powerMonitor,
} = require('electron');

const { PortScanner } = require('./scanner');
const { Store } = require('./store');
const { APP_ID, APP_NAME, ENV_PREFIX, trayTooltip } = require('../shared/brand');

const WIN_WIDTH = 340;
const WIN_DEFAULT_HEIGHT = 290;
const GAP = 8;
const KILL_SUPPRESS_MS = 8000;

app.setAppUserModelId(APP_ID);

// Single instance — a second launch just exits (the tray is already there).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray = null;
let win = null;
let store = null;
let scanner = null;
let poll = null;
let anchor = null; // { x, workArea, edge }
let suppressBlurUntil = 0;
let lastTrayBounds = null;

function workerScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scan-worker.ps1')
    : path.join(__dirname, '..', '..', 'scan-worker.ps1');
}

function assetPath(name) {
  return path.join(__dirname, '..', '..', 'assets', name);
}

// ---------------------------------------------------------------------------
// Polling controller — owns the authoritative dev-server list.
// ---------------------------------------------------------------------------

class Poll {
  constructor() {
    this.entries = [];
    this.error = null;
    this.diagnostics = null;
    this.isScanning = false;
    this.recentlyKilled = new Map(); // port -> ts
    this.timer = null;
    this.paused = false;
    this._resumeTimer = null;
    this._gen = 0; // bumped on pause so a scan started before suspend is discarded
  }

  start() {
    if (this.timer) return;
    this.refresh();
    this._arm();
  }

  _arm() {
    if (this.timer) clearInterval(this.timer);
    const ms = store.refreshInterval * 1000;
    this.timer = setInterval(() => this.refresh(), ms);
  }

  reschedule() { if (this.timer) this._arm(); }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  pause() {
    if (this._resumeTimer) { clearTimeout(this._resumeTimer); this._resumeTimer = null; }
    this.stop();
    this.paused = true;
    this._gen++;            // invalidate any in-flight scan result
    this.isScanning = false; // don't let a stranded scan block post-resume polls
  }

  resume() {
    this.paused = false;
    if (this._resumeTimer) clearTimeout(this._resumeTimer);
    this._resumeTimer = setTimeout(() => {
      this._resumeTimer = null;
      if (!this.paused) this.start();
    }, 1500);
  }

  _send(extra = {}) {
    const payload = {
      entries: this.entries,
      isScanning: this.isScanning,
      error: this.error ? String(this.error) : null,
      diagnostics: this.diagnostics,
      ...extra,
    };
    if (win && !win.isDestroyed()) win.webContents.send('ports:update', payload);
    // Keep the tray tooltip accurate even before the renderer pushes its icon.
    if (tray && !tray.isDestroyed()) {
      const n = this.entries.length;
      tray.setToolTip(trayTooltip(n));
    }
  }

  async refresh() {
    if (this.isScanning || !scanner) return;
    this.isScanning = true;
    const gen = this._gen;
    this._send();

    let res;
    try {
      res = await scanner.scan();
    } catch (e) {
      res = { ok: false, error: (e && e.message) || String(e) };
    } finally {
      this.isScanning = false;
    }

    if (gen !== this._gen) return; // paused/superseded while we were scanning

    if (!res || !res.ok) {
      this.error = res ? res.error : 'scan failed';
      this._send();
      return;
    }

    this.error = null;
    this.diagnostics = res.diagnostics;
    this._prune();
    this.entries = res.ports.filter((p) => !this.recentlyKilled.has(p.port));
    this._send();

    if (process.env[`${ENV_PREFIX}_DEBUG`]) {
      const list = this.entries.map((e) => `:${e.port} ${e.projectName}${e.branch ? ` (${e.branch})` : ''}`).join(', ');
      console.log(`[poll] ${this.entries.length} server(s) in ${res.diagnostics.duration}ms — ${list || '(none)'}`);
    }
  }

  _prune() {
    const cutoff = Date.now() - KILL_SUPPRESS_MS;
    for (const [port, ts] of this.recentlyKilled) {
      if (ts < cutoff) this.recentlyKilled.delete(port);
    }
  }

  kill(pid, port) {
    killTree(pid);
    if (typeof port === 'number') this.recentlyKilled.set(port, Date.now());
    this.entries = this.entries.filter((e) => e.port !== port);
    this._send();
  }

  killAll() {
    for (const e of this.entries) {
      killTree(e.pid);
      this.recentlyKilled.set(e.port, Date.now());
    }
    this.entries = [];
    this._send();
  }
}

function killTree(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return;
  // /T kills the whole tree (dev servers spawn children); /F forces it.
  execFile('taskkill', ['/PID', String(n), '/T', '/F'], { windowsHide: true }, () => {});
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_DEFAULT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('blur', () => {
    if (!win || win.isDestroyed()) return;
    if (Date.now() < suppressBlurUntil) return;
    if (win.webContents.isDevToolsOpened()) return;
    hideWindow();
  });

  win.on('closed', () => { win = null; });

  // Keep it pinned above the taskbar.
  win.setAlwaysOnTop(true, 'screen-saver');
}

function ensureWindow() {
  if (!win || win.isDestroyed()) createWindow();
}

function computeAnchor(trayBounds) {
  const point = (trayBounds && trayBounds.width)
    ? { x: Math.round(trayBounds.x + trayBounds.width / 2), y: Math.round(trayBounds.y + trayBounds.height / 2) }
    : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const wa = display.workArea;
  const edge = point.y >= wa.y + wa.height / 2 ? 'bottom' : 'top';
  let x = Math.round(point.x - WIN_WIDTH / 2);
  x = Math.max(wa.x + GAP, Math.min(x, wa.x + wa.width - WIN_WIDTH - GAP));
  return { x, workArea: wa, edge };
}

function placeWindow(height) {
  if (!anchor) return;
  const h = Math.round(height || win.getBounds().height);
  const { x, workArea, edge } = anchor;
  const y = edge === 'bottom'
    ? workArea.y + workArea.height - h - GAP
    : workArea.y + GAP;
  win.setBounds({ x, y, width: WIN_WIDTH, height: h });
}

function showWindow(trayBounds) {
  ensureWindow();
  anchor = computeAnchor(trayBounds);
  placeWindow(win.getBounds().height || WIN_DEFAULT_HEIGHT);
  suppressBlurUntil = Date.now() + 250;
  win.webContents.send('window:will-show');
  win.show();
  win.focus();
  if (poll) poll.refresh();
}

function hideWindow() {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
}

function toggleWindow(trayBounds) {
  if (win && !win.isDestroyed() && win.isVisible()) hideWindow();
  else showWindow(trayBounds);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray() {
  let img = nativeImage.createFromPath(assetPath('tray-default.png'));
  if (img.isEmpty()) {
    // 1px transparent fallback so the tray still appears.
    img = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  }
  tray = new Tray(img);
  tray.setToolTip(APP_NAME);
  tray.on('click', (_e, bounds) => {
    if (bounds && bounds.width) lastTrayBounds = bounds;
    toggleWindow(bounds);
  });
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: () => showWindow(trayAnchorBounds()) },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: () => quitApp() },
    ]);
    tray.popUpContextMenu(menu);
  });
}

// Best-known tray geometry: the click event gives reliable bounds; tray.getBounds()
// is often empty on Windows, so prefer the last good click bounds.
function trayAnchorBounds() {
  if (lastTrayBounds && lastTrayBounds.width) return lastTrayBounds;
  const b = tray ? tray.getBounds() : null;
  return (b && b.width) ? b : null;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    version: app.getVersion(),
    appName: APP_NAME,
    settings: {
      refreshInterval: store.refreshInterval,
      hasCompletedOnboarding: store.hasCompletedOnboarding,
    },
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
  }));

  ipcMain.handle('settings:setLaunchAtLogin', (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('settings:setRefreshInterval', (_e, seconds) => {
    store.refreshInterval = seconds;
    poll.reschedule();
    return store.refreshInterval;
  });

  ipcMain.handle('settings:completeOnboarding', () => {
    store.hasCompletedOnboarding = true;
    return true;
  });

  ipcMain.on('ports:refresh', () => poll && poll.refresh());
  ipcMain.on('port:kill', (_e, msg) => {
    if (poll && msg && Number.isInteger(msg.pid)) poll.kill(msg.pid, msg.port);
  });
  ipcMain.on('ports:killAll', () => poll && poll.killAll());
  ipcMain.on('port:open', (_e, port) => {
    const p = Number(port);
    if (Number.isInteger(p) && p > 0 && p <= 65535) shell.openExternal(`http://localhost:${p}`);
  });
  ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '')));
  ipcMain.on('shell:openExternal', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('app:quit', () => quitApp());
  ipcMain.on('window:hide', () => hideWindow());

  ipcMain.on('window:resize', (_e, height) => {
    const h = Math.max(120, Math.min(Math.round(Number(height) || WIN_DEFAULT_HEIGHT), 700));
    if (!win || win.isDestroyed()) return;
    if (anchor) placeWindow(h);
    else win.setSize(WIN_WIDTH, h);
  });

  ipcMain.on('tray:update', (_e, payload) => {
    if (!tray || tray.isDestroyed()) return;
    try {
      if (payload && payload.dataURL) {
        const img = nativeImage.createFromDataURL(payload.dataURL);
        if (!img.isEmpty()) tray.setImage(img);
      }
      if (payload && payload.tooltip) tray.setToolTip(payload.tooltip);
    } catch { /* ignore bad icon payloads */ }
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function quitApp() {
  app.isQuitting = true;
  if (scanner) scanner.dispose();
  app.quit();
}

app.on('second-instance', () => {
  showWindow(trayAnchorBounds());
});

app.on('window-all-closed', (e) => {
  // Tray app: don't auto-quit when the popover is merely hidden, but allow a
  // real quit (which sets isQuitting) to proceed.
  if (!app.isQuitting) e.preventDefault();
});

app.whenReady().then(() => {
  store = new Store();
  scanner = new PortScanner(workerScriptPath());
  scanner.on('worker-stderr', (m) => console.error('[scan-worker]', m));

  createWindow();
  createTray();
  registerIpc();

  poll = new Poll();
  poll.start();

  powerMonitor.on('suspend', () => poll && poll.pause());
  powerMonitor.on('resume', () => poll && poll.resume());

  if (process.env[`${ENV_PREFIX}_SHOW`]) runCaptureFlow();
});

// Verification-only: render onboarding + main views and save PNGs so the UI
// can be inspected without clicking the tray. Gated on DEV_TRAY_SHOW.
async function runCaptureFlow() {
  const shot = async (name) => {
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, '..', '..', name), img.toPNG());
      console.log('[capture] wrote', name);
    } catch (e) { console.error('[capture] failed', e); }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await wait(3500);
  showWindow(null);
  await wait(2500);            // let onboarding animation settle
  await shot('.ui-onboard.png');

  store.hasCompletedOnboarding = true;
  win.webContents.reload();    // re-init renderer -> main view
  await wait(1500);
  await poll.refresh();
  await wait(1800);
  await shot('.ui-main.png');
  console.log('[capture] done');
}

app.on('before-quit', () => {
  app.isQuitting = true;
  if (scanner) scanner.dispose();
});

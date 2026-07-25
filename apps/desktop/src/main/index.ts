import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain,
  shell, clipboard, screen, powerMonitor,
} from 'electron';
import { PortScanner, type PortEntry } from './scanner';
import { Store } from './store';
import { APP_ID, APP_NAME, ENV_PREFIX, trayTooltip } from '@dev-tray/core';
import { assetPath, workerScriptPath, repoRootFromMain } from './paths';

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err && err.code === 'EPIPE') return;
    throw err;
  });
}

const WIN_WIDTH = 340;
const WIN_DEFAULT_HEIGHT = 290;
const GAP = 8;
const KILL_SUPPRESS_MS = 8000;

app.setAppUserModelId(APP_ID);

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9333');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let store: Store | null = null;
let scanner: PortScanner | null = null;
let poll: Poll | null = null;
let anchor: { x: number; workArea: Electron.Rectangle; edge: 'bottom' | 'top' } | null = null;
let suppressMoveClear = 0;
let suppressBlurUntil = 0;
let dragSession: { offsetX: number; offsetY: number } | null = null;
let lastTrayBounds: Electron.Rectangle | null = null;

function resolveAssetPath(name: string): string {
  return assetPath(app.isPackaged, app.getAppPath(), name);
}

class Poll {
  entries: PortEntry[] = [];
  error: string | null = null;
  diagnostics: unknown = null;
  isScanning = false;
  recentlyKilled = new Map<number, number>();
  timer: ReturnType<typeof setInterval> | null = null;
  paused = false;
  private _resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private _gen = 0;

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this._arm();
  }

  private _arm(): void {
    if (this.timer) clearInterval(this.timer);
    const ms = (store?.refreshInterval ?? 5) * 1000;
    this.timer = setInterval(() => { void this.refresh(); }, ms);
  }

  reschedule(): void {
    if (this.timer) this._arm();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  pause(): void {
    if (this._resumeTimer) { clearTimeout(this._resumeTimer); this._resumeTimer = null; }
    this.stop();
    this.paused = true;
    this._gen++;
    this.isScanning = false;
  }

  resume(): void {
    this.paused = false;
    if (this._resumeTimer) clearTimeout(this._resumeTimer);
    this._resumeTimer = setTimeout(() => {
      this._resumeTimer = null;
      if (!this.paused) this.start();
    }, 1500);
  }

  private _send(extra: Record<string, unknown> = {}): void {
    const payload = {
      entries: this.entries,
      isScanning: this.isScanning,
      error: this.error ? String(this.error) : null,
      diagnostics: this.diagnostics,
      ...extra,
    };
    if (win && !win.isDestroyed()) win.webContents.send('ports:update', payload);
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(trayTooltip(this.entries.length));
    }
  }

  async refresh(): Promise<void> {
    if (this.isScanning || !scanner) return;
    this.isScanning = true;
    const gen = this._gen;
    this._send();

    let res;
    try {
      res = await scanner.scan();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res = { ok: false as const, error: msg };
    } finally {
      this.isScanning = false;
    }

    if (gen !== this._gen) return;

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

  private _prune(): void {
    const cutoff = Date.now() - KILL_SUPPRESS_MS;
    for (const [port, ts] of this.recentlyKilled) {
      if (ts < cutoff) this.recentlyKilled.delete(port);
    }
  }

  kill(pid: number, port: number): void {
    killTree(pid);
    if (typeof port === 'number') this.recentlyKilled.set(port, Date.now());
    this.entries = this.entries.filter((e) => e.port !== port);
    this._send();
  }

  killAll(): void {
    for (const e of this.entries) {
      killTree(e.pid);
      this.recentlyKilled.set(e.port, Date.now());
    }
    this.entries = [];
    this._send();
  }
}

function killTree(pid: number): void {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return;
  execFile('taskkill', ['/PID', String(n), '/T', '/F'], { windowsHide: true }, () => {});
}

function createWindow(): void {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_DEFAULT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.setMenuBarVisibility(false);

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  win.on('blur', () => {
    if (!win || win.isDestroyed()) return;
    if (dragSession) return;
    if (Date.now() < suppressBlurUntil) return;
    if (win.webContents.isDevToolsOpened()) return;
    hideWindow();
  });

  win.on('move', onWindowMovedByUser);

  win.on('closed', () => { win = null; });
  win.setAlwaysOnTop(true, 'screen-saver');
}

function ensureWindow(): void {
  if (!win || win.isDestroyed()) createWindow();
}

function computeAnchor(trayBounds: Electron.Rectangle | null): typeof anchor {
  const point = (trayBounds && trayBounds.width)
    ? { x: Math.round(trayBounds.x + trayBounds.width / 2), y: Math.round(trayBounds.y + trayBounds.height / 2) }
    : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const wa = display.workArea;
  const edge: 'bottom' | 'top' = point.y >= wa.y + wa.height / 2 ? 'bottom' : 'top';
  let x = Math.round(point.x - WIN_WIDTH / 2);
  x = Math.max(wa.x + GAP, Math.min(x, wa.x + wa.width - WIN_WIDTH - GAP));
  return { x, workArea: wa, edge };
}

function placeWindow(height?: number): void {
  if (!win || !anchor) return;
  const h = Math.round(height || win.getBounds().height);
  const { x, workArea, edge } = anchor;
  const y = edge === 'bottom'
    ? workArea.y + workArea.height - h - GAP
    : workArea.y + GAP;
  suppressMoveClear++;
  win.setBounds({ x, y, width: WIN_WIDTH, height: h });
  setImmediate(() => { suppressMoveClear = Math.max(0, suppressMoveClear - 1); });
}

function onWindowMovedByUser(): void {
  if (suppressMoveClear > 0) return;
  anchor = null;
}

function showWindow(trayBounds: Electron.Rectangle | null): void {
  ensureWindow();
  anchor = computeAnchor(trayBounds);
  placeWindow(win?.getBounds().height || WIN_DEFAULT_HEIGHT);
  suppressBlurUntil = Date.now() + 250;
  win?.webContents.send('window:will-show');
  win?.show();
  win?.focus();
  void poll?.refresh();
}

function hideWindow(): void {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
}

function toggleWindow(trayBounds: Electron.Rectangle | null): void {
  if (win && !win.isDestroyed() && win.isVisible()) hideWindow();
  else showWindow(trayBounds);
}

function createTray(): void {
  let img = nativeImage.createFromPath(resolveAssetPath('tray-default.png'));
  if (img.isEmpty()) {
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
    tray?.popUpContextMenu(menu);
  });
}

function trayAnchorBounds(): Electron.Rectangle | null {
  if (lastTrayBounds && lastTrayBounds.width) return lastTrayBounds;
  const b = tray ? tray.getBounds() : null;
  return (b && b.width) ? b : null;
}

function registerIpc(): void {
  ipcMain.handle('app:init', () => ({
    version: app.getVersion(),
    appName: APP_NAME,
    settings: {
      refreshInterval: store?.refreshInterval,
      hasCompletedOnboarding: store?.hasCompletedOnboarding,
    },
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
  }));

  ipcMain.handle('settings:setLaunchAtLogin', (_e, enabled: unknown) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('settings:setRefreshInterval', (_e, seconds: unknown) => {
    if (store) store.refreshInterval = seconds;
    poll?.reschedule();
    return store?.refreshInterval;
  });

  ipcMain.handle('settings:completeOnboarding', () => {
    if (store) store.hasCompletedOnboarding = true;
    return true;
  });

  ipcMain.on('ports:refresh', () => { void poll?.refresh(); });
  ipcMain.on('port:kill', (_e, msg: { pid?: number; port?: number }) => {
    if (poll && msg && Number.isInteger(msg.pid)) poll.kill(msg.pid!, msg.port!);
  });
  ipcMain.on('ports:killAll', () => poll?.killAll());
  ipcMain.on('port:open', (_e, port: unknown) => {
    const p = Number(port);
    if (Number.isInteger(p) && p > 0 && p <= 65535) shell.openExternal(`http://localhost:${p}`);
  });
  ipcMain.on('clipboard:write', (_e, text: unknown) => clipboard.writeText(String(text ?? '')));
  ipcMain.on('shell:openExternal', (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('app:quit', () => quitApp());
  ipcMain.on('window:hide', () => hideWindow());

  ipcMain.on('window:drag-start', (_e, pos: { screenX?: number; screenY?: number }) => {
    if (!win || win.isDestroyed()) return;
    const screenX = Number(pos?.screenX);
    const screenY = Number(pos?.screenY);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    anchor = null;
    const b = win.getBounds();
    dragSession = { offsetX: screenX - b.x, offsetY: screenY - b.y };
  });

  ipcMain.on('window:drag-move', (_e, pos: { screenX?: number; screenY?: number }) => {
    if (!win || win.isDestroyed() || !dragSession) return;
    const screenX = Number(pos?.screenX);
    const screenY = Number(pos?.screenY);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    win.setPosition(
      Math.round(screenX - dragSession.offsetX),
      Math.round(screenY - dragSession.offsetY),
    );
  });

  ipcMain.on('window:drag-end', () => {
    dragSession = null;
    suppressBlurUntil = Date.now() + 250;
  });

  ipcMain.handle('window:get-bounds', () => (win && !win.isDestroyed() ? win.getBounds() : null));

  ipcMain.on('window:resize', (_e, height: unknown) => {
    const h = Math.max(120, Math.min(Math.round(Number(height) || WIN_DEFAULT_HEIGHT), 700));
    if (!win || win.isDestroyed()) return;
    if (anchor) placeWindow(h);
    else win.setSize(WIN_WIDTH, h);
  });

  ipcMain.on('tray:update', (_e, payload: { dataURL?: string; tooltip?: string }) => {
    if (!tray || tray.isDestroyed()) return;
    try {
      if (payload?.dataURL) {
        const img = nativeImage.createFromDataURL(payload.dataURL);
        if (!img.isEmpty()) tray.setImage(img);
      }
      if (payload?.tooltip) tray.setToolTip(payload.tooltip);
    } catch { /* ignore bad icon payloads */ }
  });
}

function quitApp(): void {
  app.isQuitting = true;
  scanner?.dispose();
  app.quit();
}

app.on('second-instance', () => {
  showWindow(trayAnchorBounds());
});

app.on('window-all-closed', (e) => {
  if (!app.isQuitting) e.preventDefault();
});

app.whenReady().then(() => {
  store = new Store();
  scanner = new PortScanner(workerScriptPath(app.isPackaged, process.resourcesPath));
  scanner.on('worker-stderr', (m) => console.error('[scan-worker]', m));

  createWindow();
  createTray();
  registerIpc();

  poll = new Poll();
  poll.start();

  powerMonitor.on('suspend', () => poll?.pause());
  powerMonitor.on('resume', () => poll?.resume());

  if (process.env[`${ENV_PREFIX}_SHOW`]) void runCaptureFlow();
  if (process.env[`${ENV_PREFIX}_OPEN`] || process.env[`${ENV_PREFIX}_PROBE`]) {
    if (process.env[`${ENV_PREFIX}_PROBE`] && store) store.hasCompletedOnboarding = false;
    showWindow(null);
  }
});

async function runCaptureFlow(): Promise<void> {
  const shot = async (name: string) => {
    try {
      const img = await win!.webContents.capturePage();
      fs.writeFileSync(path.join(repoRootFromMain(), name), img.toPNG());
      console.log('[capture] wrote', name);
    } catch (e) { console.error('[capture] failed', e); }
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  await wait(3500);
  showWindow(null);
  await wait(2500);
  await shot('.ui-onboard.png');

  if (store) store.hasCompletedOnboarding = true;
  win?.webContents.reload();
  await wait(1500);
  await poll?.refresh();
  await wait(1800);
  await shot('.ui-main.png');
  console.log('[capture] done');
}

app.on('before-quit', () => {
  app.isQuitting = true;
  scanner?.dispose();
});

declare module 'electron' {
  interface App {
    isQuitting?: boolean;
  }
}

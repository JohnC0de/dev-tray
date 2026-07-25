import { Effect, Fiber } from 'effect';
import type { BrowserWindow, Tray } from 'electron';
import type { Entry } from '@dev-tray/core';
import { ENV_PREFIX, trayTooltip } from '@dev-tray/core';
import { PortsUpdateSchema } from '@dev-tray/contracts';
import type { ScanPipeline } from './scanner/scan-pipeline.js';
import { getRefreshInterval } from './settings.js';

const KILL_SUPPRESS_MS = 8000;

export interface PollLoopDeps {
  scanPipeline: ScanPipeline;
  getWindow: () => BrowserWindow | null;
  getTray: () => Tray | null;
  killTree: (pid: number) => void;
}

export class PollLoop {
  entries: Entry[] = [];
  error: string | null = null;
  diagnostics: {
    duration: number;
    portsFound: number;
    dataSource: string;
    timestamp: string;
  } | null = null;
  isScanning = false;
  recentlyKilled = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;
  private tickFiber: Fiber.RuntimeFiber<void, unknown> | null = null;

  constructor(private readonly deps: PollLoopDeps) {}

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.arm();
  }

  private arm(): void {
    if (this.timer) clearInterval(this.timer);
    const ms = getRefreshInterval() * 1000;
    this.timer = setInterval(() => void this.refresh(), ms);
  }

  reschedule(): void {
    if (this.timer) this.arm();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.stop();
    this.paused = true;
    this.gen++;
    this.isScanning = false;
    if (this.tickFiber) {
      void Effect.runPromise(Fiber.interrupt(this.tickFiber));
      this.tickFiber = null;
    }
  }

  resume(): void {
    this.paused = false;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (!this.paused) this.start();
    }, 1500);
  }

  private send(extra: Record<string, unknown> = {}): void {
    const payload = PortsUpdateSchema.parse({
      entries: this.entries,
      isScanning: this.isScanning,
      error: this.error,
      diagnostics: this.diagnostics,
      ...extra,
    });
    const win = this.deps.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('ports:update', payload);
    const tray = this.deps.getTray();
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(trayTooltip(this.entries.length));
    }
  }

  async refresh(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;
    const gen = this.gen;
    this.send();

    const self = this;
    const runTick = Effect.gen(function* () {
      const res = yield* Effect.tryPromise(() =>
        self.deps.scanPipeline.run(getRefreshInterval()),
      );
      if (gen !== self.gen) return;
      self.isScanning = false;

      if (!res.ok) {
        self.error = res.error ?? 'scan failed';
        self.send();
        return;
      }

      self.error = null;
      self.diagnostics = res.diagnostics ?? null;
      self.prune();
      self.entries = (res.entries ?? []).filter((e) => !self.recentlyKilled.has(e.port));
      self.send();

      if (process.env[`${ENV_PREFIX}_DEBUG`]) {
        const list = self.entries
          .map(
            (e) =>
              `:${e.port} ${e.projectName}${e.branchCurrent ? ` (${e.branchCurrent})` : ''}`,
          )
          .join(', ');
        console.log(
          `[poll] ${self.entries.length} server(s) in ${res.diagnostics?.duration}ms — ${list || '(none)'}`,
        );
      }
    });

    this.tickFiber = Effect.runFork(runTick);
    await Effect.runPromise(Fiber.join(this.tickFiber));
    this.tickFiber = null;
  }

  private prune(): void {
    const cutoff = Date.now() - KILL_SUPPRESS_MS;
    for (const [port, ts] of this.recentlyKilled) {
      if (ts < cutoff) this.recentlyKilled.delete(port);
    }
  }

  kill(pid: number, port: number): void {
    this.deps.killTree(pid);
    this.recentlyKilled.set(port, Date.now());
    this.entries = this.entries.filter((e) => e.port !== port);
    this.send();
  }

  killAll(): void {
    for (const e of this.entries) {
      this.deps.killTree(e.pid);
      this.recentlyKilled.set(e.port, Date.now());
    }
    this.entries = [];
    this.send();
  }
}

import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { SCAN_SENTINEL, ScanRowSchema, type ScanRow } from '@dev-tray/core';

const SENTINEL = SCAN_SENTINEL;
const SCAN_TIMEOUT_MS = 10_000;

function resolvePwsh(): string {
  for (const exe of ['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell']) {
    try {
      const r = spawnSync('where', [exe], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) {
        return r.stdout.trim().split(/\r?\n/)[0]!.trim();
      }
    } catch {
      /* ignore */
    }
  }
  return 'powershell.exe';
}

export interface RawScanResponse {
  ok: boolean;
  ports?: ScanRow[];
  error?: string;
}

export class PsWorkerScanner extends EventEmitter {
  private _pwsh = resolvePwsh();
  private _proc: ReturnType<typeof spawn> | null = null;
  private _stdoutBuf = '';
  private _respLines: string[] = [];
  private _pending: {
    resolve: (v: RawScanResponse) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private _inflight: Promise<RawScanResponse> | null = null;

  constructor(private readonly workerScriptPath: string) {
    super();
  }

  private _ensureWorker(): void {
    if (this._proc && !this._proc.killed && this._proc.exitCode === null) return;

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(
        this._pwsh,
        ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', this.workerScriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (err) {
      this._onWorkerDown(err as Error, null);
      return;
    }

    proc.stdout!.setEncoding('utf8');
    proc.stderr!.setEncoding('utf8');
    this._stdoutBuf = '';
    this._respLines = [];

    proc.stdout!.on('data', (chunk) => {
      if (this._proc === proc) this._onStdout(String(chunk));
    });
    proc.stderr!.on('data', (chunk) => {
      const msg = String(chunk).trim();
      if (msg) this.emit('worker-stderr', msg);
    });
    proc.stdin!.on('error', () => {});
    proc.on('error', (err) => this._onWorkerDown(err, proc));
    proc.on('exit', (code, signal) =>
      this._onWorkerDown(new Error(`worker exited (code=${code}, signal=${signal})`), proc),
    );

    this._proc = proc;
  }

  private _onWorkerDown(err: Error, proc: ReturnType<typeof spawn> | null): void {
    if (proc && proc !== this._proc) {
      try {
        proc.removeAllListeners();
      } catch {
        /* ignore */
      }
      return;
    }
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT' && !/powershell\.exe$/i.test(this._pwsh)) {
      this._pwsh = 'powershell.exe';
    }
    if (this._proc) {
      try {
        this._proc.removeAllListeners();
      } catch {
        /* ignore */
      }
    }
    this._proc = null;
    this._stdoutBuf = '';
    this._respLines = [];
    if (this._pending) {
      const p = this._pending;
      this._pending = null;
      clearTimeout(p.timer);
      p.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private _onStdout(chunk: string): void {
    this._stdoutBuf += chunk;
    let idx: number;
    while ((idx = this._stdoutBuf.indexOf('\n')) >= 0) {
      const line = this._stdoutBuf.slice(0, idx).replace(/\r$/, '');
      this._stdoutBuf = this._stdoutBuf.slice(idx + 1);
      if (line === SENTINEL) {
        this._finishResponse();
      } else {
        this._respLines.push(line);
      }
    }
  }

  private _finishResponse(): void {
    const lines = this._respLines;
    this._respLines = [];
    if (!this._pending) return;

    const p = this._pending;
    this._pending = null;
    clearTimeout(p.timer);

    const jsonLine = [...lines].reverse().find((l) => l.trim().startsWith('{'));
    if (!jsonLine) {
      p.reject(new Error('worker returned no JSON'));
      return;
    }
    try {
      p.resolve(JSON.parse(jsonLine) as RawScanResponse);
    } catch (e) {
      p.reject(new Error(`failed to parse worker output: ${(e as Error).message}`));
    }
  }

  private _requestRaw(): Promise<RawScanResponse> {
    return new Promise((resolve, reject) => {
      this._ensureWorker();
      if (!this._proc) {
        reject(new Error('failed to start scan worker'));
        return;
      }
      const timer = setTimeout(() => {
        this._pending = null;
        const dead = this._proc;
        this._proc = null;
        this._stdoutBuf = '';
        this._respLines = [];
        if (dead) {
          try {
            dead.removeAllListeners('exit');
            dead.removeAllListeners('error');
          } catch {
            /* ignore */
          }
          try {
            dead.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
        reject(new Error('Port scan timed out'));
      }, SCAN_TIMEOUT_MS);

      this._pending = { resolve, reject, timer };
      try {
        this._proc.stdin!.write('SCAN\n');
      } catch (e) {
        clearTimeout(timer);
        this._pending = null;
        reject(e);
      }
    });
  }

  async scanRaw(): Promise<RawScanResponse> {
    if (this._inflight) return this._inflight;
    this._inflight = this._requestRaw().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  dispose(): void {
    const proc = this._proc;
    this._proc = null;
    if (!proc) return;
    try {
      proc.removeAllListeners('exit');
      proc.removeAllListeners('error');
    } catch {
      /* ignore */
    }
    try {
      proc.stdin!.write('QUIT\n');
    } catch {
      /* ignore */
    }
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}

export function parseScanRows(raw: RawScanResponse): ScanRow[] {
  if (!raw.ok) return [];
  const rows = Array.isArray(raw.ports) ? raw.ports : raw.ports ? [raw.ports] : [];
  return ScanRowSchema.array().parse(rows);
}

import { spawn, spawnSync, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { SCAN_SENTINEL } from '@dev-tray/core';

const SENTINEL = SCAN_SENTINEL;
const SCAN_TIMEOUT_MS = 10000;
const BRANCH_TTL_MS = 30000;

const ALLOWED_FALLBACK = new Set([
  'node', 'bun', 'deno',
  'python', 'python3', 'pythonw',
  'ruby', 'php', 'go', 'java', 'dotnet',
  'uvicorn', 'gunicorn', 'puma', 'rails',
  'mix', 'elixir', 'erl', 'beam', 'beam.smp',
  'air', 'reflex', 'caddy',
]);

const IGNORED_DIR_NAMES = new Set([
  '_build', 'build', 'tmp', 'temp', 'dist', 'deps', 'node_modules', 'bin', '.bin',
  'nodejs', 'node', 'system32', 'syswow64', 'windows', 'windowsapps',
  'program files', 'program files (x86)', 'programdata', 'appdata', 'local', 'roaming', 'microsoft',
]);

const ELECTRON_CHILD_RE = /\s--type=(renderer|gpu-process|utility|zygote|ppapi|ppapi-broker|crashpad-handler|broker|nacl-loader|service)\b/i;

export interface ScanRow {
  port: number;
  pid: number;
  name?: string;
  path?: string;
  cmd?: string;
  cwd?: string;
  start?: string | null;
}

export interface PortEntry {
  id: string;
  port: number;
  pid: number;
  projectName: string;
  branch: string;
  startTime: string | null;
}

export interface ScanDiagnostics {
  duration: number;
  portsFound: number;
  dataSource: string;
  timestamp: string;
}

export type ScanResult =
  | { ok: true; ports: PortEntry[]; diagnostics: ScanDiagnostics }
  | { ok: false; error: string };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function resolvePwsh(): string {
  for (const exe of ['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell']) {
    try {
      const r = spawnSync('where', [exe], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) {
        return r.stdout.trim().split(/\r?\n/)[0].trim();
      }
    } catch { /* ignore */ }
  }
  return 'powershell.exe';
}

export class PortScanner extends EventEmitter {
  private readonly workerScriptPath: string;
  private _pwsh: string;
  private _proc: ChildProcessWithoutNullStreams | null = null;
  private _stdoutBuf = '';
  private _respLines: string[] = [];
  private _pending: PendingRequest | null = null;
  private _inflight: Promise<ScanResult> | null = null;
  private readonly _gitRootCache = new Map<string, string | null>();
  private readonly _branchCache = new Map<string, { branch: string; ts: number }>();

  constructor(workerScriptPath: string) {
    super();
    this.workerScriptPath = workerScriptPath;
    this._pwsh = resolvePwsh();
  }

  private _ensureWorker(): void {
    if (this._proc && !this._proc.killed && this._proc.exitCode === null) return;

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(this._pwsh, [
        '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass',
        '-File', this.workerScriptPath,
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      this._onWorkerDown(err, null);
      return;
    }

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    this._stdoutBuf = '';
    this._respLines = [];

    proc.stdout.on('data', (chunk: string) => { if (this._proc === proc) this._onStdout(chunk); });
    proc.stderr.on('data', (chunk: string) => {
      const msg = String(chunk).trim();
      if (msg) this.emit('worker-stderr', msg);
    });
    proc.stdin.on('error', () => {});
    proc.on('error', (err) => this._onWorkerDown(err, proc));
    proc.on('exit', (code, signal) =>
      this._onWorkerDown(new Error(`worker exited (code=${code}, signal=${signal})`), proc));

    this._proc = proc;
  }

  private _onWorkerDown(err: unknown, proc: ChildProcessWithoutNullStreams | null): void {
    if (proc && proc !== this._proc) {
      try { proc.removeAllListeners(); } catch { /* ignore */ }
      return;
    }
    if (err && typeof err === 'object' && err !== null && 'code' in err
      && (err as NodeJS.ErrnoException).code === 'ENOENT' && !/powershell\.exe$/i.test(this._pwsh)) {
      this._pwsh = 'powershell.exe';
    }
    if (this._proc) {
      try { this._proc.removeAllListeners(); } catch { /* ignore */ }
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
      p.resolve(JSON.parse(jsonLine));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      p.reject(new Error(`failed to parse worker output: ${msg}`));
    }
  }

  private _requestRaw(): Promise<unknown> {
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
          try { dead.removeAllListeners('exit'); dead.removeAllListeners('error'); } catch { /* ignore */ }
          try { dead.kill('SIGKILL'); } catch { /* ignore */ }
        }
        reject(new Error('Port scan timed out'));
      }, SCAN_TIMEOUT_MS);

      this._pending = { resolve, reject, timer };
      try {
        this._proc.stdin.write('SCAN\n');
      } catch (e) {
        clearTimeout(timer);
        this._pending = null;
        reject(e);
      }
    });
  }

  async scan(): Promise<ScanResult> {
    if (this._inflight) return this._inflight;
    this._inflight = this._scanInner().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  private async _scanInner(): Promise<ScanResult> {
    const started = Date.now();
    let raw: { ok?: boolean; error?: string; ports?: ScanRow | ScanRow[] } | undefined;
    try {
      raw = await this._requestRaw() as typeof raw;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
    if (!raw || raw.ok === false) {
      return { ok: false, error: (raw && raw.error) || 'unknown scan error' };
    }

    const rows = Array.isArray(raw.ports) ? raw.ports : (raw.ports ? [raw.ports] : []);
    const ports = await this._resolveProjects(rows);

    return {
      ok: true,
      ports,
      diagnostics: {
        duration: Date.now() - started,
        portsFound: ports.length,
        dataSource: 'powershell',
        timestamp: new Date().toISOString(),
      },
    };
  }

  dispose(): void {
    const proc = this._proc;
    this._proc = null;
    if (!proc) return;
    try { proc.removeAllListeners('exit'); proc.removeAllListeners('error'); } catch { /* ignore */ }
    try { proc.stdin.write('QUIT\n'); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
  }

  private async _resolveProjects(rows: ScanRow[]): Promise<PortEntry[]> {
    const activeDirs = new Set<string>();
    const activeRoots = new Set<string>();
    const resolved: Array<{
      row: ScanRow;
      gitRoot: string | null;
      bestCandidateDir: string | null;
      baseName: string;
    }> = [];

    for (const row of rows) {
      if (!row || typeof row.port !== 'number') continue;
      if (row.cmd && ELECTRON_CHILD_RE.test(row.cmd)) continue;

      const { searchDirs, labelDirs } = this._candidateDirs(row);
      searchDirs.forEach((d) => activeDirs.add(d));

      let gitRoot: string | null = null;
      for (const dir of searchDirs) {
        const root = this._findGitRoot(dir);
        if (root && (!gitRoot || root.length > gitRoot.length)) gitRoot = root;
      }
      let bestCandidateDir: string | null = null;
      for (const dir of labelDirs) {
        if (this._isMeaningfulDir(path.basename(dir))) { bestCandidateDir = dir; break; }
      }
      if (gitRoot) activeRoots.add(gitRoot);

      const baseName = (row.name || '').replace(/\.exe$/i, '');
      if (!gitRoot && !this._shouldKeepFallback(baseName, bestCandidateDir, row.cmd)) {
        continue;
      }

      resolved.push({ row, gitRoot, bestCandidateDir, baseName });
    }

    const uniqueRoots = [...new Set(resolved.map((r) => r.gitRoot).filter(Boolean))] as string[];
    const branchByRoot = new Map<string, string>();
    await Promise.all(uniqueRoots.map(async (root) => {
      branchByRoot.set(root, await this._resolveBranch(root));
    }));

    this._pruneCaches(activeDirs, activeRoots);

    return resolved.map(({ row, gitRoot, bestCandidateDir, baseName }) => {
      const projectName = this._displayName(baseName, bestCandidateDir, gitRoot, row.cmd);
      return {
        id: `${row.port}-${row.pid}`,
        port: row.port,
        pid: row.pid,
        projectName,
        branch: gitRoot ? (branchByRoot.get(gitRoot) || '') : '',
        startTime: row.start || null,
      };
    }).sort((a, b) => a.port - b.port);
  }

  private _candidateDirs(row: ScanRow): { searchDirs: string[]; labelDirs: string[] } {
    const searchDirs: string[] = [];
    const labelDirs: string[] = [];
    const seenS = new Set<string>();
    const seenL = new Set<string>();
    const addS = (d: string | null) => { if (d && !seenS.has(d)) { seenS.add(d); searchDirs.push(d); } };
    const addL = (d: string | null) => { if (d && !seenL.has(d)) { seenL.add(d); labelDirs.push(d); } };

    const cwdDir = row.cwd ? this._dirOf(row.cwd) : null;
    if (cwdDir) { addS(cwdDir); addL(cwdDir); }

    for (const tok of this._extractPaths(row.cmd)) {
      const d = this._dirOf(tok);
      if (d) { addS(d); addL(d); }
    }

    addS(this._dirOf(row.path ?? null));
    return { searchDirs, labelDirs };
  }

  private _extractPaths(cmd?: string): string[] {
    if (!cmd || typeof cmd !== 'string') return [];
    const out: string[] = [];
    const quoted = cmd.match(/"([^"]+)"/g) || [];
    for (const q of quoted) {
      const inner = q.slice(1, -1);
      if (/^[A-Za-z]:[\\/]/.test(inner)) out.push(inner);
    }
    const bare = cmd.match(/[A-Za-z]:[\\/][^\s"]+/g) || [];
    for (const b of bare) out.push(b);
    return out;
  }

  private _dirOf(p: string | null): string | null {
    if (!p || typeof p !== 'string') return null;
    const clean = p.trim().replace(/[",;]+$/, '');
    if (!clean) return null;
    try {
      const st = fs.statSync(clean);
      if (st.isDirectory()) return path.resolve(clean);
      return path.resolve(path.dirname(clean));
    } catch {
      const parent = path.dirname(clean);
      if (parent && parent !== clean && /^[A-Za-z]:[\\/]/.test(parent)) return path.resolve(parent);
      return null;
    }
  }

  private _findGitRoot(startDir: string): string | null {
    if (!startDir) return null;
    if (this._gitRootCache.has(startDir)) return this._gitRootCache.get(startDir) ?? null;

    let current = startDir;
    let result: string | null = null;
    while (true) {
      try {
        if (fs.existsSync(path.join(current, '.git'))) { result = current; break; }
      } catch { /* ignore */ }
      const parent = path.dirname(current);
      if (!parent || parent === current) break;
      current = parent;
    }
    this._gitRootCache.set(startDir, result);
    return result;
  }

  private _resolveBranch(gitRoot: string): Promise<string> {
    const cached = this._branchCache.get(gitRoot);
    if (cached && Date.now() - cached.ts < BRANCH_TTL_MS) {
      return Promise.resolve(cached.branch);
    }
    return new Promise((resolve) => {
      execFile('git', ['-C', gitRoot, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { timeout: 5000, windowsHide: true }, (err, stdout) => {
          let branch = err ? '' : String(stdout).trim();
          if (branch === 'HEAD') branch = '';
          this._branchCache.set(gitRoot, { branch, ts: Date.now() });
          resolve(branch);
        });
    });
  }

  private _pruneCaches(activeDirs: Set<string>, activeRoots: Set<string>): void {
    for (const k of this._gitRootCache.keys()) {
      if (!activeDirs.has(k)) this._gitRootCache.delete(k);
    }
    for (const k of this._branchCache.keys()) {
      if (!activeRoots.has(k)) this._branchCache.delete(k);
    }
  }

  private _displayName(
    baseName: string,
    candidateDir: string | null,
    gitRoot: string | null,
    cmd?: string,
  ): string {
    if (gitRoot) return path.basename(gitRoot);
    if (this._isDocker(baseName, cmd)) return 'Docker';
    if (candidateDir) {
      const base = path.basename(candidateDir);
      if (this._isMeaningfulDir(base)) return base;
    }
    return baseName || 'unknown';
  }

  private _shouldKeepFallback(baseName: string, candidateDir: string | null, cmd?: string): boolean {
    const n = (baseName || '').toLowerCase();
    if (ALLOWED_FALLBACK.has(n)) return true;
    if (this._isDocker(n, cmd)) return true;
    if (n.startsWith('python') && /^python[\d.]*$/.test(n)) return true;
    if (candidateDir) {
      const base = path.basename(candidateDir).toLowerCase();
      if (this._isMeaningfulDir(base) && ALLOWED_FALLBACK.has(base)) return true;
    }
    return false;
  }

  private _isDocker(name: string, cmd?: string): boolean {
    const n = (name || '').toLowerCase();
    if (n.includes('docker') || n.startsWith('com.dock') || n.startsWith('vpnkit')) return true;
    if (cmd && /\bdocker(d|-proxy|\.exe)?\b/i.test(cmd)) return true;
    return false;
  }

  private _isMeaningfulDir(name: string): boolean {
    if (!name || name === path.sep || name.startsWith('.')) return false;
    if (/^[A-Za-z]:\\?$/.test(name)) return false;
    return !IGNORED_DIR_NAMES.has(name.toLowerCase());
  }
}

export { SENTINEL };

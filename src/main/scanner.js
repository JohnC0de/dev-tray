'use strict';

// Windows port scanner.
//
// Enumerate listening TCP ports, resolve each owning process to a project
// (git repo name + branch) and start time, and filter down to dev servers.
//
// Data comes from a resident PowerShell worker (scan-worker.ps1) that replies
// with one compact JSON line per "SCAN" request, terminated by a sentinel.

const { spawn, spawnSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { SCAN_SENTINEL } = require('../shared/brand');

const SENTINEL = SCAN_SENTINEL;
const SCAN_TIMEOUT_MS = 10000;
const BRANCH_TTL_MS = 30000;

// Process base-names (lower-case, no ".exe") we keep even without a git root.
// These are the interpreters/runtimes dev servers tend to run under.
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
  // runtime / system install locations — never a meaningful project label
  'nodejs', 'node', 'system32', 'syswow64', 'windows', 'windowsapps',
  'program files', 'program files (x86)', 'programdata', 'appdata', 'local', 'roaming', 'microsoft',
]);

// Chromium/Electron child-process switches. A packaged desktop app (VS Code,
// Slack, Linear, Raycast…) spawns helpers carrying these; they are never the
// user's dev server, so drop them to keep the list clean.
const ELECTRON_CHILD_RE = /\s--type=(renderer|gpu-process|utility|zygote|ppapi|ppapi-broker|crashpad-handler|broker|nacl-loader|service)\b/i;

function resolvePwsh() {
  // Prefer PowerShell 7 (pwsh); fall back to Windows PowerShell 5.1.
  for (const exe of ['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell']) {
    try {
      const r = spawnSync('where', [exe], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) {
        return r.stdout.trim().split(/\r?\n/)[0].trim();
      }
    } catch { /* ignore */ }
  }
  // Last resort: let spawn resolve it on PATH.
  return 'powershell.exe';
}

class PortScanner extends EventEmitter {
  constructor(workerScriptPath) {
    super();
    this.workerScriptPath = workerScriptPath;
    this._pwsh = resolvePwsh();
    this._proc = null;
    this._stdoutBuf = '';
    this._respLines = [];
    this._pending = null; // { resolve, reject, timer }
    this._inflight = null; // Promise dedupe for concurrent scan() calls

    // Caches pruned to the active working set each scan.
    this._gitRootCache = new Map(); // dir -> gitRoot|null
    this._branchCache = new Map();  // gitRoot -> { branch, ts }
  }

  // --- Worker lifecycle ---------------------------------------------------

  _ensureWorker() {
    if (this._proc && !this._proc.killed && this._proc.exitCode === null) return;

    let proc;
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

    // Every handler is identity-guarded: events from an abandoned/old worker
    // must never mutate state that now belongs to a freshly-spawned one.
    proc.stdout.on('data', (chunk) => { if (this._proc === proc) this._onStdout(chunk); });
    proc.stderr.on('data', (chunk) => {
      const msg = String(chunk).trim();
      if (msg) this.emit('worker-stderr', msg);
    });
    proc.stdin.on('error', () => {}); // swallow async EPIPE if the worker dies mid-write
    proc.on('error', (err) => this._onWorkerDown(err, proc));
    proc.on('exit', (code, signal) =>
      this._onWorkerDown(new Error(`worker exited (code=${code}, signal=${signal})`), proc));

    this._proc = proc;
  }

  _onWorkerDown(err, proc) {
    // A late event from a process we already replaced — drop it.
    if (proc && proc !== this._proc) {
      try { proc.removeAllListeners(); } catch { /* ignore */ }
      return;
    }
    // pwsh not found on PATH? fall back to Windows PowerShell for next time.
    if (err && err.code === 'ENOENT' && !/powershell\.exe$/i.test(this._pwsh)) {
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

  _onStdout(chunk) {
    this._stdoutBuf += chunk;
    let idx;
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

  _finishResponse() {
    const lines = this._respLines;
    this._respLines = [];
    if (!this._pending) return; // unsolicited; ignore

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
      p.reject(new Error(`failed to parse worker output: ${e.message}`));
    }
  }

  _requestRaw() {
    return new Promise((resolve, reject) => {
      this._ensureWorker();
      if (!this._proc) {
        reject(new Error('failed to start scan worker'));
        return;
      }
      const timer = setTimeout(() => {
        // Worker is wedged — abandon it (force-kill) so the next scan respawns
        // a fresh one. Detach its exit/error listeners first so its delayed
        // death can't clobber the replacement worker.
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

  // --- Public API ---------------------------------------------------------

  /** Returns { ok:true, ports:[...], diagnostics } or { ok:false, error }. */
  async scan() {
    if (this._inflight) return this._inflight;
    this._inflight = this._scanInner().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _scanInner() {
    const started = Date.now();
    let raw;
    try {
      raw = await this._requestRaw();
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
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

  dispose() {
    const proc = this._proc;
    this._proc = null; // idempotent: a second dispose() (quitApp + before-quit) no-ops
    if (!proc) return;
    try { proc.removeAllListeners('exit'); proc.removeAllListeners('error'); } catch { /* ignore */ }
    try { proc.stdin.write('QUIT\n'); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
  }

  // --- Project / branch resolution ---------------------------------------

  async _resolveProjects(rows) {
    // Per-scan working set, used to prune the long-lived caches afterwards.
    const activeDirs = new Set();
    const activeRoots = new Set();

    // First pass: figure out the git root (or fallback dir) for each row.
    const resolved = [];
    for (const row of rows) {
      if (!row || typeof row.port !== 'number') continue;
      if (row.cmd && ELECTRON_CHILD_RE.test(row.cmd)) continue; // Electron helper noise

      const { searchDirs, labelDirs } = this._candidateDirs(row);
      searchDirs.forEach((d) => activeDirs.add(d));

      let gitRoot = null;
      for (const dir of searchDirs) {
        const root = this._findGitRoot(dir);
        if (root && (!gitRoot || root.length > gitRoot.length)) gitRoot = root;
      }
      let bestCandidateDir = null;
      for (const dir of labelDirs) {
        if (this._isMeaningfulDir(path.basename(dir))) { bestCandidateDir = dir; break; }
      }
      if (gitRoot) activeRoots.add(gitRoot);

      const baseName = (row.name || '').replace(/\.exe$/i, '');
      if (!gitRoot && !this._shouldKeepFallback(baseName, bestCandidateDir, row.cmd)) {
        continue; // not a project, not an allow-listed dev runtime -> drop
      }

      resolved.push({ row, gitRoot, bestCandidateDir, baseName });
    }

    // Resolve branches for the unique git roots (cached, parallel).
    const uniqueRoots = [...new Set(resolved.map((r) => r.gitRoot).filter(Boolean))];
    const branchByRoot = new Map();
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

  /**
   * Plausible directories for a process, split by purpose:
   *  - searchDirs: walked for a .git root (includes the exe dir, since a
   *    compiled binary may live inside the project).
   *  - labelDirs: used to name a non-git process (never the exe install dir).
   * Priority order, best first: real CWD, command-line paths, exe dir.
   */
  _candidateDirs(row) {
    const searchDirs = [];
    const labelDirs = [];
    const seenS = new Set();
    const seenL = new Set();
    const addS = (d) => { if (d && !seenS.has(d)) { seenS.add(d); searchDirs.push(d); } };
    const addL = (d) => { if (d && !seenL.has(d)) { seenL.add(d); labelDirs.push(d); } };

    const cwdDir = row.cwd ? this._dirOf(row.cwd) : null;
    if (cwdDir) { addS(cwdDir); addL(cwdDir); }

    for (const tok of this._extractPaths(row.cmd)) {
      const d = this._dirOf(tok);
      if (d) { addS(d); addL(d); }
    }

    addS(this._dirOf(row.path)); // git-search only, never a label
    return { searchDirs, labelDirs };
  }

  /** Pull absolute Windows paths out of a command-line string. */
  _extractPaths(cmd) {
    if (!cmd || typeof cmd !== 'string') return [];
    const out = [];
    // Quoted segments first (they may contain spaces).
    const quoted = cmd.match(/"([^"]+)"/g) || [];
    for (const q of quoted) {
      const inner = q.slice(1, -1);
      if (/^[A-Za-z]:[\\/]/.test(inner)) out.push(inner);
    }
    // Then any drive-rooted run of non-space, non-quote chars (covers
    // bare args and `--flag=C:\path` forms).
    const bare = cmd.match(/[A-Za-z]:[\\/][^\s"]+/g) || [];
    for (const b of bare) out.push(b);
    return out;
  }

  /** Directory containing a path; if the path is itself a directory, return it. */
  _dirOf(p) {
    if (!p || typeof p !== 'string') return null;
    let clean = p.trim().replace(/[",;]+$/, '');
    if (!clean) return null;
    try {
      const st = fs.statSync(clean);
      if (st.isDirectory()) return path.resolve(clean);
      return path.resolve(path.dirname(clean));
    } catch {
      // Path may not exist as given (trailing args, flags) — fall back to its parent.
      const parent = path.dirname(clean);
      if (parent && parent !== clean && /^[A-Za-z]:[\\/]/.test(parent)) return path.resolve(parent);
      return null;
    }
  }

  _findGitRoot(startDir) {
    if (!startDir) return null;
    if (this._gitRootCache.has(startDir)) return this._gitRootCache.get(startDir);

    let current = startDir;
    let result = null;
    // Walk up to the drive root.
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

  _resolveBranch(gitRoot) {
    const cached = this._branchCache.get(gitRoot);
    if (cached && Date.now() - cached.ts < BRANCH_TTL_MS) {
      return Promise.resolve(cached.branch);
    }
    return new Promise((resolve) => {
      execFile('git', ['-C', gitRoot, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { timeout: 5000, windowsHide: true }, (err, stdout) => {
          let branch = err ? '' : String(stdout).trim();
          if (branch === 'HEAD') branch = ''; // detached HEAD — no branch to show
          this._branchCache.set(gitRoot, { branch, ts: Date.now() });
          resolve(branch);
        });
    });
  }

  _pruneCaches(activeDirs, activeRoots) {
    for (const k of this._gitRootCache.keys()) {
      if (!activeDirs.has(k)) this._gitRootCache.delete(k);
    }
    for (const k of this._branchCache.keys()) {
      if (!activeRoots.has(k)) this._branchCache.delete(k);
    }
  }

  // --- Labelling / filtering ---------------------------------------------

  _displayName(baseName, candidateDir, gitRoot, cmd) {
    if (gitRoot) return path.basename(gitRoot);
    if (this._isDocker(baseName, cmd)) return 'Docker';
    if (candidateDir) {
      const base = path.basename(candidateDir);
      if (this._isMeaningfulDir(base)) return base;
    }
    return baseName || 'unknown';
  }

  _shouldKeepFallback(baseName, candidateDir, cmd) {
    const n = (baseName || '').toLowerCase();
    if (ALLOWED_FALLBACK.has(n)) return true;
    if (this._isDocker(n, cmd)) return true;
    // python3.12 etc.
    if (n.startsWith('python') && /^python[\d.]*$/.test(n)) return true;
    if (candidateDir) {
      const base = path.basename(candidateDir).toLowerCase();
      if (this._isMeaningfulDir(base) && ALLOWED_FALLBACK.has(base)) return true;
    }
    return false;
  }

  _isDocker(name, cmd) {
    const n = (name || '').toLowerCase();
    if (n.includes('docker') || n.startsWith('com.dock') || n.startsWith('vpnkit')) return true;
    if (cmd && /\bdocker(d|-proxy|\.exe)?\b/i.test(cmd)) return true;
    return false;
  }

  _isMeaningfulDir(name) {
    if (!name || name === path.sep || name.startsWith('.')) return false;
    if (/^[A-Za-z]:\\?$/.test(name)) return false; // drive root
    return !IGNORED_DIR_NAMES.has(name.toLowerCase());
  }
}

module.exports = { PortScanner, SENTINEL };

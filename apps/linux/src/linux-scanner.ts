import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import {
  createEnrichCaches,
  createProbePool,
  enrichScanRows,
  type Entry,
  type PartialEntry,
  type ScanRow,
} from '@dev-tray/core';

const execFileAsync = promisify(execFile);
const caches = createEnrichCaches();
const probePool = createProbePool({ refreshIntervalMs: 5000 });
const SS_TIMEOUT_MS = 5000;
const SS_MAX_BUFFER = 1024 * 1024;
const IGNORED_PROCESS: Record<string, true> = {
  chrome: true,
  chromium: true,
  code: true,
  codex: true,
  discord: true,
  electron: true,
  firefox: true,
  omp: true,
  opencode: true,
  pi: true,
};

export interface SocketProcess {
  port: number;
  pid: number;
  name: string;
}

interface PersistedSessionRecord {
  branchAtStart: string | null;
  startTime: string;
}

export type PersistedSessionState = Record<string, PersistedSessionRecord>;

function sessionStatePath(): string {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'dev-tray', 'linux-sessions.json');
}

function loadSessionState(statePath = sessionStatePath()): PersistedSessionState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const valid: PersistedSessionState = {};
    for (const [pid, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if ((typeof record.branchAtStart !== 'string' && record.branchAtStart !== null)
        || typeof record.startTime !== 'string') continue;
      valid[pid] = {
        branchAtStart: record.branchAtStart,
        startTime: record.startTime,
      };
    }
    return valid;
  } catch {
    return {};
  }
}

function saveSessionState(state: PersistedSessionState, statePath = sessionStatePath()): void {
  const directory = path.dirname(statePath);
  const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, statePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
    console.warn('dev-tray-linux: could not persist session state:', error);
  }
}

export function mergeSessionState(
  partialEntries: PartialEntry[],
  previous: PersistedSessionState,
): { entries: Entry[]; state: PersistedSessionState } {
  const state: PersistedSessionState = {};
  const entries = partialEntries.map((partial) => {
    const key = String(partial.pid);
    const existing = previous[key];
    const sameProcess = !!partial.startTime
      && existing?.startTime === partial.startTime;
    const branchAtStart = sameProcess
      ? existing.branchAtStart
      : partial.branchCurrent;

    if (partial.startTime) {
      state[key] = { branchAtStart, startTime: partial.startTime };
    }

    return {
      ...partial,
      branchAtStart,
      branchDrifted: !!(
        branchAtStart
        && partial.branchCurrent
        && branchAtStart !== partial.branchCurrent
      ),
      health: 'unknown' as const,
      openUrl: null,
    };
  });

  return { entries, state };
}

export function parseSsOutput(output: string): SocketProcess[] {
  const found = new Map<string, SocketProcess>();

  for (const line of output.split('\n')) {
    const columns = line.trim().split(/\s+/);
    const portText = columns[3]?.match(/:(\d+)$/)?.[1];
    if (!portText) continue;

    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1) continue;

    for (const match of line.matchAll(/"([^"]+)",pid=(\d+)/g)) {
      const name = match[1];
      const pid = Number(match[2]);
      if (!name || !Number.isInteger(pid) || pid < 2) continue;
      found.set(`${port}-${pid}`, { port, pid, name });
    }
  }

  return [...found.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

function readProcStatFields(pid: number): string[] | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  } catch {
    return undefined;
  }
}

function readParentPid(pid: number): number | undefined {
  const parent = Number(readProcStatFields(pid)?.[1]);
  return Number.isInteger(parent) ? parent : undefined;
}

function readProcessStartTime(pid: number): string | undefined {
  return readProcStatFields(pid)?.[19];
}

export function selectListenerOwners(
  sockets: SocketProcess[],
  parentOf: (pid: number) => number | undefined = readParentPid,
): SocketProcess[] {
  const byPort = new Map<number, SocketProcess[]>();
  for (const socket of sockets) {
    const group = byPort.get(socket.port);
    if (group) group.push(socket);
    else byPort.set(socket.port, [socket]);
  }
  const owners: SocketProcess[] = [];

  for (const group of byPort.values()) {
    const score = (candidate: number): number => group.reduce((total, socket) => {
      let current = socket.pid;
      const seen = new Set<number>();
      while (current > 1 && !seen.has(current)) {
        if (current === candidate) return total + 1;
        seen.add(current);
        current = parentOf(current) ?? 0;
      }
      return total;
    }, 0);

    owners.push([...group].sort((a, b) => score(b.pid) - score(a.pid) || a.pid - b.pid)[0]!);
  }

  return owners.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

function readLink(linkPath: string): string | undefined {
  try {
    return fs.readlinkSync(linkPath);
  } catch {
    return undefined;
  }
}

function readCommand(pid: number): string | undefined {
  try {
    const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    return args.map((arg) => /\s/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg).join(' ') || undefined;
  } catch {
    return undefined;
  }
}

async function collectSocketProcesses(): Promise<SocketProcess[]> {
  const { stdout } = await execFileAsync('ss', ['-H', '-ltnp'], {
    encoding: 'utf8',
    timeout: SS_TIMEOUT_MS,
    maxBuffer: SS_MAX_BUFFER,
  });
  return parseSsOutput(stdout);
}

function scanRowsFromSockets(sockets: SocketProcess[]): ScanRow[] {
  const visible = sockets.filter(({ name }) => !IGNORED_PROCESS[name.toLowerCase()]);

  return selectListenerOwners(visible).map(({ port, pid, name }) => ({
    port,
    pid,
    name,
    path: readLink(`/proc/${pid}/exe`),
    cmd: readCommand(pid),
    cwd: readLink(`/proc/${pid}/cwd`),
    start: readProcessStartTime(pid) ?? null,
  }));
}

export async function collectScanRows(): Promise<ScanRow[]> {
  return scanRowsFromSockets(await collectSocketProcesses());
}

function execGitBranch(gitRoot: string): Promise<string> {
  return execFileAsync('git', ['-C', gitRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: SS_MAX_BUFFER,
  }).then(({ stdout }) => stdout.trim(), () => '');
}

async function enrichSockets(sockets: SocketProcess[], shouldProbe: boolean): Promise<Entry[]> {
  const partial = await enrichScanRows(scanRowsFromSockets(sockets), {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    execGitBranch,
  }, caches);
  const merged = mergeSessionState(partial, loadSessionState());
  saveSessionState(merged.state);

  return shouldProbe
    ? Effect.runPromise(probePool.probeAll(merged.entries))
    : merged.entries;
}

export async function scanEntries(): Promise<Entry[]> {
  return enrichSockets(await collectSocketProcesses(), true);
}

function childPids(pid: number): number[] {
  try {
    return fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

function processTree(pid: number, seen = new Set<number>()): number[] {
  if (seen.has(pid)) return [];
  seen.add(pid);
  return [...childPids(pid).flatMap((child) => processTree(child, seen)), pid];
}

export async function killEntries(pids: number[]): Promise<void> {
  const requested = [...new Set(pids)];
  if (requested.length === 0) throw new Error('At least one PID is required');

  const sockets = await collectSocketProcesses();
  const entries = await enrichSockets(sockets, false);
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const selected = requested.map((pid) => {
    const entry = byPid.get(pid);
    if (!entry) throw new Error(`PID ${pid} is not a listed dev server`);
    if (!entry.startTime || readProcessStartTime(pid) !== entry.startTime) {
      throw new Error(`PID ${pid} no longer owns the listed server`);
    }
    return entry;
  });

  const seen = new Set<number>();
  const tree = selected.flatMap((entry) => processTree(entry.pid, seen));
  const startTimes = new Map(tree.map((target) => [target, readProcessStartTime(target)]));
  for (const entry of selected) {
    if (startTimes.get(entry.pid) !== entry.startTime) {
      throw new Error(`PID ${entry.pid} changed before it could be stopped`);
    }
  }

  for (const target of tree) {
    const started = startTimes.get(target);
    if (!started || readProcessStartTime(target) !== started) continue;
    try { process.kill(target, 'SIGTERM'); } catch { /* already exited */ }
  }

  await delay(500);

  for (const target of tree) {
    const started = startTimes.get(target);
    if (!started || readProcessStartTime(target) !== started) continue;
    try { process.kill(target, 'SIGKILL'); } catch { /* already exited */ }
  }
}

export function killEntry(pid: number): Promise<void> {
  return killEntries([pid]);
}

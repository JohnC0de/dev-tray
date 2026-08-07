import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import {
  SessionStore,
  createEnrichCaches,
  enrichScanRows,
  type Entry,
  type ScanRow,
} from '@dev-tray/core';

const execFileAsync = promisify(execFile);
const caches = createEnrichCaches();
const sessions = new SessionStore();
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

function readParentPid(pid: number): number | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
    const parent = Number(fields[1]);
    return Number.isInteger(parent) ? parent : undefined;
  } catch {
    return undefined;
  }
}

export function selectListenerOwners(
  processes: SocketProcess[],
  parentOf: (pid: number) => number | undefined = readParentPid,
): SocketProcess[] {
  const byPort = new Map<number, SocketProcess[]>();
  for (const process of processes) {
    const group = byPort.get(process.port);
    if (group) group.push(process);
    else byPort.set(process.port, [process]);
  }
  const owners: SocketProcess[] = [];

  for (const group of byPort.values()) {
    const score = (candidate: number): number => group.reduce((total, process) => {
      let current = process.pid;
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

function readLink(path: string): string | undefined {
  try {
    return fs.readlinkSync(path);
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
  const { stdout } = await execFileAsync('ss', ['-H', '-ltnp'], { encoding: 'utf8' });
  return parseSsOutput(stdout);
}

export async function collectScanRows(): Promise<ScanRow[]> {
  const visible = (await collectSocketProcesses())
    .filter(({ name }) => !IGNORED_PROCESS[name.toLowerCase()]);

  return selectListenerOwners(visible).map(({ port, pid, name }) => ({
    port,
    pid,
    name,
    path: readLink(`/proc/${pid}/exe`),
    cmd: readCommand(pid),
    cwd: readLink(`/proc/${pid}/cwd`),
    start: null,
  }));
}

function execGitBranch(gitRoot: string): Promise<string> {
  return execFileAsync('git', ['-C', gitRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    timeout: 5000,
  }).then(({ stdout }) => stdout.trim(), () => '');
}

export async function scanEntries(): Promise<Entry[]> {
  const rows = await collectScanRows();
  const partial = await enrichScanRows(rows, {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    execGitBranch,
  }, caches);

  return sessions.merge(partial).map((entry) => ({
    ...entry,
    openUrl: `http://localhost:${entry.port}`,
  }));
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

export async function killEntry(pid: number): Promise<void> {
  const entry = (await scanEntries()).find((candidate) => candidate.pid === pid);
  if (!entry) throw new Error(`PID ${pid} is not a listed dev server`);

  const socketPids = (await collectSocketProcesses())
    .filter((process) => process.port === entry.port)
    .map((process) => process.pid);
  const seen = new Set<number>();
  const tree = socketPids.flatMap((socketPid) => processTree(socketPid, seen));

  for (const target of tree) {
    try { process.kill(target, 'SIGTERM'); } catch { /* already exited */ }
  }

  await delay(500);

  for (const target of tree) {
    if (!fs.existsSync(`/proc/${target}`)) continue;
    try { process.kill(target, 'SIGKILL'); } catch { /* already exited */ }
  }
}

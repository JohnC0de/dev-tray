import path from 'node:path';
import type { ScanRow } from '../schemas/scan-row.js';

export function dirOf(
  p: string | undefined | null,
  statSync: (p: string) => { isDirectory(): boolean },
): string | null {
  if (!p || typeof p !== 'string') return null;
  let clean = p.trim().replace(/[",;]+$/, '');
  if (!clean) return null;
  try {
    const st = statSync(clean);
    if (st.isDirectory()) return path.resolve(clean);
    return path.resolve(path.dirname(clean));
  } catch {
    const parent = path.dirname(clean);
    if (parent && parent !== clean && /^[A-Za-z]:[\\/]/.test(parent)) {
      return path.resolve(parent);
    }
    return null;
  }
}

export function extractPaths(cmd: string | undefined | null): string[] {
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

export interface CandidateDirs {
  searchDirs: string[];
  labelDirs: string[];
}

export function candidateDirs(
  row: ScanRow,
  statSync: (p: string) => { isDirectory(): boolean },
): CandidateDirs {
  const searchDirs: string[] = [];
  const labelDirs: string[] = [];
  const seenS = new Set<string>();
  const seenL = new Set<string>();
  const addS = (d: string | null) => {
    if (d && !seenS.has(d)) {
      seenS.add(d);
      searchDirs.push(d);
    }
  };
  const addL = (d: string | null) => {
    if (d && !seenL.has(d)) {
      seenL.add(d);
      labelDirs.push(d);
    }
  };

  const cwdDir = row.cwd ? dirOf(row.cwd, statSync) : null;
  if (cwdDir) {
    addS(cwdDir);
    addL(cwdDir);
  }

  for (const tok of extractPaths(row.cmd)) {
    const d = dirOf(tok, statSync);
    if (d) {
      addS(d);
      addL(d);
    }
  }

  addS(dirOf(row.path, statSync));
  return { searchDirs, labelDirs };
}

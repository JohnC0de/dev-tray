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
    if (parent && parent !== clean && (/^[A-Za-z]:[\\/]/.test(parent) || parent.startsWith('/'))) {
      return path.resolve(parent);
    }
    return null;
  }
}

export function extractPaths(cmd: string | undefined | null): string[] {
  if (!cmd || typeof cmd !== 'string') return [];

  const out: string[] = [];
  const tokens = cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  for (const raw of tokens) {
    let token = raw;
    if ((token.startsWith('"') && token.endsWith('"'))
      || (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1);
    }
    const equals = token.indexOf('=');
    if (equals >= 0) token = token.slice(equals + 1);
    token = token.replace(/[",;]+$/, '');
    if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith('/')) out.push(token);
  }
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

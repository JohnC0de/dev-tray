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

function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote = '';

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '\\' && command[index + 1] === quote) {
        token += quote;
        index += 1;
      } else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += character;
    }
  }

  if (token) tokens.push(token);
  return tokens;
}

// POSIX paths need two segments so Windows switches such as `/c` or `/MIN` are not read as paths.
function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\/[^/\s]+\//.test(value);
}

export function extractPaths(cmd: string | undefined | null): string[] {
  if (!cmd || typeof cmd !== 'string') return [];

  const out: string[] = [];
  for (const raw of commandTokens(cmd)) {
    let token = raw;
    if (!isAbsolutePath(token)) {
      const equals = token.indexOf('=');
      const key = equals >= 0 ? token.slice(0, equals) : '';
      if (equals >= 0 && (/^--?[\w.-]+$/.test(key) || /^[A-Za-z_]\w*$/.test(key))) {
        token = token.slice(equals + 1);
      }
    }
    token = token.replace(/[",;]+$/, '');
    if (isAbsolutePath(token)) out.push(token);
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

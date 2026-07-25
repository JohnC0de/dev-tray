import path from 'node:path';
import { isDocker, isMeaningfulDir } from './filter.js';

export function displayName(
  baseName: string,
  candidateDir: string | null,
  gitRoot: string | null,
  cmd: string | undefined | null,
): string {
  if (gitRoot) return path.basename(gitRoot);
  if (isDocker(baseName, cmd)) return 'Docker';
  if (candidateDir) {
    const base = path.basename(candidateDir);
    if (isMeaningfulDir(base)) return base;
  }
  return baseName || 'unknown';
}

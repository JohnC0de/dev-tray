import path from 'node:path';

export type ExistsSync = (p: string) => boolean;

export function findGitRoot(
  startDir: string | null,
  existsSync: ExistsSync,
  cache: Map<string, string | null> = new Map(),
): string | null {
  if (!startDir) return null;
  if (cache.has(startDir)) return cache.get(startDir)!;

  let current = startDir;
  let result: string | null = null;
  while (true) {
    try {
      if (existsSync(path.join(current, '.git'))) {
        result = current;
        break;
      }
    } catch {
      /* ignore */
    }
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  cache.set(startDir, result);
  return result;
}

export type ExecGitBranch = (gitRoot: string) => Promise<string>;

const BRANCH_TTL_MS = 30_000;

export interface BranchCacheEntry {
  branch: string;
  ts: number;
}

export function resolveBranch(
  gitRoot: string,
  execGit: ExecGitBranch,
  cache: Map<string, BranchCacheEntry> = new Map(),
  now = Date.now(),
): Promise<string> {
  const cached = cache.get(gitRoot);
  if (cached && now - cached.ts < BRANCH_TTL_MS) {
    return Promise.resolve(cached.branch);
  }
  return execGit(gitRoot).then((branch) => {
    const normalized = branch === 'HEAD' ? '' : branch;
    cache.set(gitRoot, { branch: normalized, ts: now });
    return normalized;
  });
}

export function pruneGitCaches(
  activeDirs: Set<string>,
  activeRoots: Set<string>,
  gitRootCache: Map<string, string | null>,
  branchCache: Map<string, BranchCacheEntry>,
): void {
  for (const k of gitRootCache.keys()) {
    if (!activeDirs.has(k)) gitRootCache.delete(k);
  }
  for (const k of branchCache.keys()) {
    if (!activeRoots.has(k)) branchCache.delete(k);
  }
}

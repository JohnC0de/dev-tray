import type { ScanRow } from '../schemas/scan-row.js';
import type { PartialEntry } from '../schemas/entry.js';
import { candidateDirs } from './candidate-dirs.js';
import {
  findGitRoot,
  resolveBranch,
  pruneGitCaches,
  type BranchCacheEntry,
  type ExecGitBranch,
  type ExistsSync,
} from './git.js';
import {
  isElectronChild,
  isMeaningfulDir,
  shouldKeepFallback,
} from './filter.js';
import { displayName } from './display-name.js';
import { detectFramework } from './framework.js';
import { computeGroupKey } from './group-key.js';

export interface EnrichDeps {
  existsSync: ExistsSync;
  statSync: (p: string) => { isDirectory(): boolean };
  execGitBranch: ExecGitBranch;
}

export interface EnrichCaches {
  gitRootCache: Map<string, string | null>;
  branchCache: Map<string, BranchCacheEntry>;
}

export function createEnrichCaches(): EnrichCaches {
  return {
    gitRootCache: new Map(),
    branchCache: new Map(),
  };
}

export async function enrichScanRows(
  rows: ScanRow[],
  deps: EnrichDeps,
  caches: EnrichCaches = createEnrichCaches(),
): Promise<PartialEntry[]> {
  const activeDirs = new Set<string>();
  const activeRoots = new Set<string>();

  interface Resolved {
    row: ScanRow;
    gitRoot: string | null;
    bestCandidateDir: string | null;
    baseName: string;
    cwd: string | null;
  }

  const resolved: Resolved[] = [];

  for (const row of rows) {
    if (!row || typeof row.port !== 'number') continue;
    if (isElectronChild(row.cmd)) continue;

    const { searchDirs, labelDirs } = candidateDirs(row, deps.statSync);
    searchDirs.forEach((d) => activeDirs.add(d));

    let gitRoot: string | null = null;
    for (const dir of searchDirs) {
      const root = findGitRoot(dir, deps.existsSync, caches.gitRootCache);
      if (root && (!gitRoot || root.length > gitRoot.length)) gitRoot = root;
    }

    let bestCandidateDir: string | null = null;
    for (const dir of labelDirs) {
      const base = dir.split(/[/\\]/).pop() ?? '';
      if (isMeaningfulDir(base)) {
        bestCandidateDir = dir;
        break;
      }
    }

    if (gitRoot) activeRoots.add(gitRoot);

    const baseName = (row.name || '').replace(/\.exe$/i, '');
    if (!gitRoot && !shouldKeepFallback(baseName, bestCandidateDir, row.cmd)) {
      continue;
    }

    resolved.push({
      row,
      gitRoot,
      bestCandidateDir,
      baseName,
      cwd: row.cwd ?? null,
    });
  }

  const uniqueRoots = [...new Set(resolved.map((r) => r.gitRoot).filter(Boolean))] as string[];
  const branchByRoot = new Map<string, string>();
  await Promise.all(
    uniqueRoots.map(async (root) => {
      branchByRoot.set(
        root,
        await resolveBranch(root, deps.execGitBranch, caches.branchCache),
      );
    }),
  );

  pruneGitCaches(activeDirs, activeRoots, caches.gitRootCache, caches.branchCache);

  return resolved
    .map(({ row, gitRoot, bestCandidateDir, baseName, cwd }) => {
      const projectName = displayName(baseName, bestCandidateDir, gitRoot, row.cmd);
      const branchCurrent = gitRoot ? (branchByRoot.get(gitRoot) ?? '') : null;
      const groupKey = computeGroupKey(gitRoot, projectName);
      return {
        id: `${row.port}-${row.pid}`,
        port: row.port,
        pid: row.pid,
        projectName,
        gitRoot,
        cwd,
        branchCurrent: branchCurrent === '' ? null : branchCurrent,
        startTime: row.start ?? null,
        framework: detectFramework(row.cmd),
        groupKey,
      };
    })
    .sort((a, b) => a.port - b.port);
}

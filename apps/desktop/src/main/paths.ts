import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root when running from apps/desktop/src/main. */
export function repoRootFromMain(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

/** Packaged extraResources path or repo-root scan-worker.ps1 in dev. */
export function workerScriptPath(isPackaged: boolean, resourcesPath: string): string {
  if (isPackaged) {
    return path.join(resourcesPath, 'scan-worker.ps1');
  }
  return path.join(repoRootFromMain(), 'scan-worker.ps1');
}

export function assetPath(isPackaged: boolean, appPath: string, name: string): string {
  if (isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', name);
  }
  return path.join(appPath, '..', '..', 'assets', name);
}

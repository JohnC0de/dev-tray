import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createEnrichCaches,
  enrichScanRows,
  SessionStore,
  createProbePool,
  type ScanRow,
  type Entry,
} from '@dev-tray/core';
import { PsWorkerScanner, parseScanRows } from './ps-worker-scanner.js';
import { scanNative } from './native-scanner.js';
import { getScanBackend } from '../settings.js';

const execFileAsync = promisify(execFile);

export interface ScanPipelineResult {
  ok: boolean;
  entries?: Entry[];
  error?: string;
  diagnostics?: {
    duration: number;
    portsFound: number;
    dataSource: string;
    timestamp: string;
  };
}

const enrichCaches = createEnrichCaches();
const sessionStore = new SessionStore();

function execGitBranch(gitRoot: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', gitRoot, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) resolve('');
        else resolve(String(stdout).trim());
      },
    );
  });
}

const enrichDeps = {
  existsSync: (p: string) => fs.existsSync(p),
  statSync: (p: string) => fs.statSync(p),
  execGitBranch,
};

export class ScanPipeline {
  private psScanner: PsWorkerScanner | null = null;
  private probePool = createProbePool({ refreshIntervalMs: 5000 });
  private refreshIntervalSec = 5;

  constructor(private readonly workerScriptPath: string) {}

  setRefreshInterval(seconds: number): void {
    this.refreshIntervalSec = seconds;
    this.probePool = createProbePool({ refreshIntervalMs: seconds * 1000 });
  }

  private getPsScanner(): PsWorkerScanner {
    if (!this.psScanner) {
      this.psScanner = new PsWorkerScanner(this.workerScriptPath);
      this.psScanner.on('worker-stderr', (m: string) => console.error('[scan-worker]', m));
    }
    return this.psScanner;
  }

  async run(refreshIntervalSec: number): Promise<ScanPipelineResult> {
    const started = Date.now();
    let rows: ScanRow[];
    let dataSource: string;

    try {
      const backend = getScanBackend();
      if (backend === 'native') {
        rows = await scanNative();
        dataSource = 'native';
      } else {
        const raw = await this.getPsScanner().scanRaw();
        if (!raw.ok) {
          return { ok: false, error: raw.error || 'unknown scan error' };
        }
        rows = parseScanRows(raw);
        dataSource = 'powershell';
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message || String(e) };
    }

    const partial = await enrichScanRows(rows, enrichDeps, enrichCaches);
    const sessioned = sessionStore.merge(partial);
    this.setRefreshInterval(refreshIntervalSec);
    const probed = await import('effect').then(({ Effect }) =>
      Effect.runPromise(this.probePool.probeAll(sessioned)),
    );

    return {
      ok: true,
      entries: probed,
      diagnostics: {
        duration: Date.now() - started,
        portsFound: probed.length,
        dataSource,
        timestamp: new Date().toISOString(),
      },
    };
  }

  dispose(): void {
    this.psScanner?.dispose();
    this.psScanner = null;
  }
}

export function workerScriptPath(isPackaged: boolean, resourcesPath: string, dirname: string): string {
  return isPackaged
    ? path.join(resourcesPath, 'scan-worker.ps1')
    : path.join(dirname, '..', '..', '..', '..', 'scan-worker.ps1');
}

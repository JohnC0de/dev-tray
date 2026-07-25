import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanRowSchema } from '../src/schemas/scan-row.js';
import { enrichScanRows, createEnrichCaches } from '../src/enrich/pipeline.js';
import { computeGroupKey } from '../src/enrich/group-key.js';
import { detectFramework } from '../src/enrich/framework.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures/scan-rows-sample.json');

describe('enrich pipeline', () => {
  const existsSync = vi.fn((p: string) => p.includes('.git') || p.includes('my-app') || p.includes('api') || p.includes('backend'));
  const statSync = vi.fn((p: string) => ({ isDirectory: () => !p.endsWith('.exe') && !p.endsWith('.js') }));
  const execGitBranch = vi.fn(async (root: string) => {
    if (root.includes('my-app')) return 'feature/ui';
    if (root.includes('api')) return 'main';
    return '';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses fixture scan rows', () => {
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const rows = ScanRowSchema.array().parse(raw);
    expect(rows).toHaveLength(3);
  });

  it('enriches rows with gitRoot, cwd, branchCurrent, groupKey, framework', async () => {
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const rows = ScanRowSchema.array().parse(raw);

    existsSync.mockImplementation((p: string) => {
      if (p.endsWith('.git')) return true;
      if (p.includes('my-app')) return true;
      if (p.includes('api')) return true;
      if (p.includes('backend')) return true;
      return false;
    });

    const partial = await enrichScanRows(rows, { existsSync, statSync, execGitBranch }, createEnrichCaches());

    expect(partial.length).toBeGreaterThan(0);
    const vite = partial.find((e) => e.port === 5173);
    expect(vite).toBeDefined();
    expect(vite!.cwd).toBe('C:\\Users\\dev\\my-app');
    expect(vite!.framework).toBe('vite');
    expect(vite!.groupKey).toBeTruthy();
    expect(vite!.branchCurrent).toBe('feature/ui');
    expect(vite!.gitRoot).toBeTruthy();
    expect(vite!.groupKey).toBe(vite!.gitRoot);
  });

  it('computes groupKey from gitRoot or projectName', () => {
    expect(computeGroupKey('C:\\repo', 'repo')).toBe('C:\\repo');
    expect(computeGroupKey(null, 'Docker')).toBe('Docker');
  });

  it('detects frameworks from cmd', () => {
    expect(detectFramework('node vite.js')).toBe('vite');
    expect(detectFramework('next dev')).toBe('next');
    expect(detectFramework('unknown server')).toBeNull();
  });
});

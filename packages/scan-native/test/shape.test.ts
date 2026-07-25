import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ScanRowSchema = z.object({
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive(),
  name: z.string().optional(),
  path: z.string().optional(),
  cmd: z.string().optional(),
  cwd: z.string().optional(),
  start: z.string().nullable().optional(),
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../core/test/fixtures/scan-rows-sample.json');
const NODE_BIN = join(dirname(__dirname), 'scan-native.win32-x64-msvc.node');

describe('ScanRow shape', () => {
  it('validates core fixture rows', () => {
    const rows = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown[];
    expect(ScanRowSchema.array().safeParse(rows).success).toBe(true);
  });

  it('validates optional fields and null start', () => {
    const row = {
      port: 8080,
      pid: 1,
      start: null,
    };
    expect(ScanRowSchema.safeParse(row).success).toBe(true);
  });
});

describe('scanListeningPorts integration', () => {
  const hasNative = existsSync(NODE_BIN);

  it.skipIf(!hasNative)('returns rows matching ScanRow schema', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { scanListeningPorts } = require('..') as {
      scanListeningPorts: () => unknown[];
    };
    const rows = scanListeningPorts();
    expect(Array.isArray(rows)).toBe(true);
    const parsed = ScanRowSchema.array().safeParse(rows);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    for (const row of parsed.data) {
      expect(row.port).toBeGreaterThanOrEqual(1024);
      expect(row.port).toBeLessThan(49152);
    }
  });
});

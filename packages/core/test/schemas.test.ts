import { describe, it, expect } from 'vitest';
import { ScanRowSchema, ScanResultSchema } from '../src/schemas/scan-row.js';
import { PartialEntrySchema, EntrySchema } from '../src/schemas/entry.js';

describe('zod schemas', () => {
  it('parses a minimal scan row', () => {
    const row = ScanRowSchema.parse({ port: 3000, pid: 42 });
    expect(row.port).toBe(3000);
  });

  it('parses scan result envelope', () => {
    const result = ScanResultSchema.parse({
      ok: true,
      ports: [{ port: 5173, pid: 1 }],
      diagnostics: { duration: 12 },
    });
    expect(result.ok).toBe(true);
    expect(result.ports).toHaveLength(1);
  });

  it('parses partial and full entry shapes', () => {
    const partial = PartialEntrySchema.parse({
      id: '3000-1',
      port: 3000,
      pid: 1,
      projectName: 'app',
      gitRoot: null,
      cwd: null,
      branchCurrent: null,
      startTime: null,
      framework: 'vite',
      groupKey: 'app',
    });
    const entry = EntrySchema.parse({
      ...partial,
      branchAtStart: null,
      branchDrifted: false,
      health: 'unknown',
      openUrl: null,
    });
    expect(entry.health).toBe('unknown');
  });
});

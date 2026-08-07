import { describe, expect, it } from 'vitest';
import { parseSsOutput, selectListenerOwners } from '../src/linux-scanner.js';

describe('parseSsOutput', () => {
  it('extracts and sorts user-owned listening processes', () => {
    const output = [
      'LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=42,fd=20))',
      'LISTEN 0 4096 [::1]:3000 [::]:* users:(("python",pid=84,fd=7))',
      'LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:*',
    ].join('\n');

    expect(parseSsOutput(output)).toEqual([
      { port: 3000, pid: 84, name: 'python' },
      { port: 5173, pid: 42, name: 'node' },
    ]);
  });

  it('deduplicates the same process and port', () => {
    const line = 'LISTEN 0 511 0.0.0.0:8080 0.0.0.0:* users:(("bun",pid=12,fd=9))';
    expect(parseSsOutput(`${line}\n${line}`)).toEqual([
      { port: 8080, pid: 12, name: 'bun' },
    ]);
  });

  it('captures every process sharing a listener', () => {
    const line = 'LISTEN 0 511 0.0.0.0:8000 0.0.0.0:* users:(("gunicorn",pid=13,fd=5),("gunicorn",pid=12,fd=5))';
    expect(parseSsOutput(line)).toEqual([
      { port: 8000, pid: 12, name: 'gunicorn' },
      { port: 8000, pid: 13, name: 'gunicorn' },
    ]);
  });
});

describe('selectListenerOwners', () => {
  it('selects the ancestor instead of relying on ss tuple order', () => {
    const processes = [
      { port: 8000, pid: 13, name: 'gunicorn' },
      { port: 8000, pid: 12, name: 'gunicorn' },
    ];
    const parents: Record<number, number> = { 13: 12, 12: 1 };

    expect(selectListenerOwners(processes, (pid) => parents[pid])).toEqual([
      { port: 8000, pid: 12, name: 'gunicorn' },
    ]);
  });
});

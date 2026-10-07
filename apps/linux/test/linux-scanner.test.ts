import { describe, expect, it } from 'vitest';
import {
  mergeSessionState,
  parseSsOutput,
  selectListenerOwners,
} from '../src/linux-scanner.js';

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
    const sockets = [
      { port: 8000, pid: 13, name: 'gunicorn' },
      { port: 8000, pid: 12, name: 'gunicorn' },
    ];
    const parents: Record<number, number> = { 13: 12, 12: 1 };

    expect(selectListenerOwners(sockets, (pid) => parents[pid])).toEqual([
      { port: 8000, pid: 12, name: 'gunicorn' },
    ]);
  });

  it('selects one owner independently for each port', () => {
    const sockets = [
      { port: 8001, pid: 21, name: 'node' },
      { port: 8000, pid: 13, name: 'gunicorn' },
      { port: 8000, pid: 12, name: 'gunicorn' },
    ];
    const parents: Record<number, number> = { 13: 12, 12: 1, 21: 1 };

    expect(selectListenerOwners(sockets, (pid) => parents[pid])).toEqual([
      { port: 8000, pid: 12, name: 'gunicorn' },
      { port: 8001, pid: 21, name: 'node' },
    ]);
  });

  it('terminates cyclic ancestor traversal and uses the lowest PID tie-breaker', () => {
    const sockets = [
      { port: 8000, pid: 30, name: 'node' },
      { port: 8000, pid: 20, name: 'node' },
    ];
    const parents: Record<number, number> = { 20: 30, 30: 20 };

    expect(selectListenerOwners(sockets, (pid) => parents[pid])).toEqual([
      { port: 8000, pid: 20, name: 'node' },
    ]);
  });

  it('selects the lowest PID when candidates are unrelated', () => {
    const sockets = [
      { port: 8000, pid: 50, name: 'node' },
      { port: 8000, pid: 40, name: 'node' },
    ];

    expect(selectListenerOwners(sockets, () => 1)).toEqual([
      { port: 8000, pid: 40, name: 'node' },
    ]);
  });
});

describe('mergeSessionState', () => {
  const partial = {
    id: '5173-42',
    port: 5173,
    pid: 42,
    projectName: 'app',
    gitRoot: '/home/dev/app',
    cwd: '/home/dev/app',
    branchCurrent: 'feature-b',
    startTime: '12345',
    framework: 'vite',
    groupKey: '/home/dev/app',
  };

  it('restores the pinned branch for the same Linux process', () => {
    const result = mergeSessionState([partial], {
      42: { branchAtStart: 'feature-a', startTime: '12345' },
    });

    expect(result.entries[0]).toMatchObject({
      branchAtStart: 'feature-a',
      branchCurrent: 'feature-b',
      branchDrifted: true,
    });
  });

  it('resets the pinned branch when a PID has been reused', () => {
    const result = mergeSessionState([partial], {
      42: { branchAtStart: 'feature-a', startTime: 'older-process' },
    });

    expect(result.entries[0]).toMatchObject({
      branchAtStart: 'feature-b',
      branchDrifted: false,
    });
  });
});

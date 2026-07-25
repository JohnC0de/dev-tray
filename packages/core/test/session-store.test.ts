import { describe, it, expect } from 'vitest';
import { SessionStore } from '../src/session/session-store.js';
import type { PartialEntry } from '../src/schemas/entry.js';

function partial(overrides: Partial<PartialEntry> & Pick<PartialEntry, 'pid' | 'port'>): PartialEntry {
  return {
    id: `${overrides.port}-${overrides.pid}`,
    projectName: 'test-app',
    gitRoot: 'C:\\repo',
    cwd: 'C:\\repo',
    branchCurrent: 'main',
    startTime: null,
    framework: null,
    groupKey: 'C:\\repo',
    ...overrides,
  };
}

describe('SessionStore (ADR-001)', () => {
  it('pins branchAtStart on first sight of pid', () => {
    const store = new SessionStore();
    const [entry] = store.merge([partial({ pid: 100, port: 3000, branchCurrent: 'feature-a' })]);
    expect(entry.branchAtStart).toBe('feature-a');
    expect(entry.branchDrifted).toBe(false);
  });

  it('detects branch drift when branchCurrent changes', () => {
    const store = new SessionStore();
    store.merge([partial({ pid: 100, port: 3000, branchCurrent: 'feature-a' })]);
    const [entry] = store.merge([partial({ pid: 100, port: 3000, branchCurrent: 'feature-b' })]);
    expect(entry.branchAtStart).toBe('feature-a');
    expect(entry.branchCurrent).toBe('feature-b');
    expect(entry.branchDrifted).toBe(true);
  });

  it('resets branchAtStart for new pid on same port', () => {
    const store = new SessionStore();
    store.merge([partial({ pid: 100, port: 3000, branchCurrent: 'old-branch' })]);
    const [entry] = store.merge([partial({ pid: 200, port: 3000, branchCurrent: 'new-branch' })]);
    expect(entry.branchAtStart).toBe('new-branch');
    expect(entry.branchDrifted).toBe(false);
  });

  it('no drift for detached HEAD (empty branches)', () => {
    const store = new SessionStore();
    store.merge([partial({ pid: 100, port: 3000, branchCurrent: null })]);
    const [entry] = store.merge([partial({ pid: 100, port: 3000, branchCurrent: null })]);
    expect(entry.branchDrifted).toBe(false);
  });

  it('prunes sessions when pid disappears from scan', () => {
    const store = new SessionStore();
    store.merge([partial({ pid: 100, port: 3000 })]);
    store.merge([partial({ pid: 200, port: 4000 })]);
    store.merge([partial({ pid: 200, port: 4000 })]);
    const entries = store.merge([partial({ pid: 200, port: 4000 })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].pid).toBe(200);
  });

  it('non-git entries have null branch fields and no drift', () => {
    const store = new SessionStore();
    const [entry] = store.merge([
      partial({ pid: 100, port: 3000, gitRoot: null, branchCurrent: null, groupKey: 'Docker' }),
    ]);
    expect(entry.branchAtStart).toBeNull();
    expect(entry.branchDrifted).toBe(false);
  });
});

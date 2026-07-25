import type { PartialEntry, Entry } from '../schemas/entry.js';

interface SessionRecord {
  branchAtStart: string | null;
}

export class SessionStore {
  private readonly sessions = new Map<number, SessionRecord>();

  merge(partialEntries: PartialEntry[]): Entry[] {
    const seenPids = new Set<number>();

    const entries = partialEntries.map((partial) => {
      seenPids.add(partial.pid);
      let record = this.sessions.get(partial.pid);
      if (!record) {
        record = { branchAtStart: partial.branchCurrent };
        this.sessions.set(partial.pid, record);
      }

      const branchAtStart = record.branchAtStart;
      const branchCurrent = partial.branchCurrent;
      const branchDrifted =
        !!(branchAtStart && branchCurrent && branchAtStart !== branchCurrent);

      return {
        ...partial,
        branchAtStart,
        branchDrifted,
        health: 'unknown' as const,
        openUrl: null,
      };
    });

    for (const pid of this.sessions.keys()) {
      if (!seenPids.has(pid)) this.sessions.delete(pid);
    }

    return entries;
  }

  clear(): void {
    this.sessions.clear();
  }
}

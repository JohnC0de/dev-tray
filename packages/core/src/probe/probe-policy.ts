import type { Entry } from '../schemas/entry.js';

export type Health = Entry['health'];

export interface ProbeResult {
  health: Health;
  openUrl: string | null;
  elapsedMs: number;
}

const SLOW_THRESHOLD_MS = 1500;

export function classifyProbe(
  httpOk: boolean,
  httpsOk: boolean,
  finalUrl: string | null,
  elapsedMs: number,
): ProbeResult {
  if (!httpOk && !httpsOk) {
    return { health: 'dead', openUrl: null, elapsedMs };
  }

  const health: Health = elapsedMs >= SLOW_THRESHOLD_MS ? 'slow' : 'alive';
  return { health, openUrl: finalUrl, elapsedMs };
}

export function fallbackOpenUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function resolveOpenUrl(entry: Entry): string {
  return entry.openUrl ?? fallbackOpenUrl(entry.port);
}

export function cacheKey(port: number, pid: number): string {
  return `${port}-${pid}`;
}

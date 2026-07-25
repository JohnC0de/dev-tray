import https from 'node:https';
import { Duration, Effect, Ref, pipe } from 'effect';
import { FetchHttpClient, HttpClient } from '@effect/platform';
import type { Entry } from '../schemas/entry.js';
import {
  cacheKey,
  classifyProbe,
  type ProbeResult,
} from './probe-policy.js';

const PROBE_TIMEOUT_MS = 2000;
const MAX_REDIRECTS = 3;
const CONCURRENCY = 8;

interface CachedProbe {
  result: ProbeResult;
  ts: number;
}

export interface ProbePoolOptions {
  refreshIntervalMs: number;
  now?: () => number;
}

function probeHttpsNode(
  port: number,
): Promise<{ ok: boolean; finalUrl: string | null; elapsedMs: number }> {
  const started = Date.now();
  const url = `https://127.0.0.1:${port}/`;

  const follow = (
    target: string,
    redirectsLeft: number,
  ): Promise<{ ok: boolean; finalUrl: string | null; elapsedMs: number }> =>
    new Promise((resolve) => {
      const req = https.get(target, { timeout: PROBE_TIMEOUT_MS, rejectUnauthorized: false }, (res) => {
        res.resume();
        const elapsedMs = Date.now() - started;
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const next = new URL(res.headers.location, target).href;
          follow(next, redirectsLeft - 1).then(resolve);
          return;
        }
        resolve({ ok: true, finalUrl: target, elapsedMs });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, finalUrl: null, elapsedMs: Date.now() - started });
      });
      req.on('error', () => {
        resolve({ ok: false, finalUrl: null, elapsedMs: Date.now() - started });
      });
    });

  return follow(url, MAX_REDIRECTS);
}

function probeHttpPlatform(
  port: number,
): Effect.Effect<{ ok: boolean; finalUrl: string | null; elapsedMs: number }, never, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const started = Date.now();

    const follow = (
      url: string,
      redirectsLeft: number,
    ): Effect.Effect<{ ok: boolean; finalUrl: string | null; elapsedMs: number }, never, HttpClient.HttpClient> =>
      Effect.gen(function* () {
        const response = yield* pipe(
          client.get(url, { headers: { Accept: '*/*' } }),
          Effect.timeout(Duration.millis(PROBE_TIMEOUT_MS)),
          Effect.catchAll(() => Effect.succeed(null)),
        );
        const elapsedMs = Date.now() - started;
        if (!response) {
          return { ok: false, finalUrl: null, elapsedMs };
        }

        const status = response.status;
        if (status >= 300 && status < 400 && redirectsLeft > 0) {
          const location = response.headers['location'] ?? response.headers['Location'];
          if (location) {
            const next = new URL(location, url).href;
            return yield* follow(next, redirectsLeft - 1);
          }
        }

        yield* Effect.ignore(response.text);
        return { ok: true, finalUrl: url, elapsedMs };
      });

    return yield* follow(`http://127.0.0.1:${port}/`, MAX_REDIRECTS);
  });
}

const probeOneEntry = (entry: Entry): Effect.Effect<Entry, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpRes = yield* probeHttpPlatform(entry.port);
    let httpsRes = { ok: false, finalUrl: null as string | null, elapsedMs: 0 };
    if (!httpRes.ok) {
      httpsRes = yield* Effect.tryPromise(() => probeHttpsNode(entry.port)).pipe(
        Effect.catchAll(() =>
          Effect.succeed({ ok: false, finalUrl: null as string | null, elapsedMs: 0 }),
        ),
      );
    }
    const elapsedMs = Math.max(httpRes.elapsedMs, httpsRes.elapsedMs);
    const finalUrl = httpRes.finalUrl ?? httpsRes.finalUrl;
    const classified = classifyProbe(httpRes.ok, httpsRes.ok, finalUrl, elapsedMs);
    return {
      ...entry,
      health: classified.health,
      openUrl: classified.openUrl,
    };
  });

const HttpLayer = FetchHttpClient.layer;

export function createProbePool(opts: ProbePoolOptions) {
  const cacheRef = Effect.runSync(Ref.make(new Map<string, CachedProbe>()));
  const now = opts.now ?? (() => Date.now());

  const probeAll = (entries: Entry[]): Effect.Effect<Entry[]> =>
    Effect.gen(function* () {
      const cache = yield* Ref.get(cacheRef);
      const ttl = opts.refreshIntervalMs;
      const t = now();

      const probeOne = (entry: Entry) =>
        Effect.gen(function* () {
          const key = cacheKey(entry.port, entry.pid);
          const cached = cache.get(key);
          if (cached && t - cached.ts < ttl) {
            return {
              ...entry,
              health: cached.result.health,
              openUrl: cached.result.openUrl,
            };
          }
          const probed = yield* probeOneEntry(entry);
          cache.set(key, {
            result: {
              health: probed.health,
              openUrl: probed.openUrl,
              elapsedMs: 0,
            },
            ts: t,
          });
          return probed;
        });

      const results = yield* Effect.forEach(entries, probeOne, { concurrency: CONCURRENCY });
      yield* Ref.set(cacheRef, cache);
      return results;
    }).pipe(Effect.provide(HttpLayer));

  return { probeAll };
}

export type ProbePool = ReturnType<typeof createProbePool>;

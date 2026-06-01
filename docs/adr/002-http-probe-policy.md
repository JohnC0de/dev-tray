# ADR-002: HTTP probe policy

**Status:** Accepted  
**Date:** 2026-06-01  
**Pillar:** P2 — Liveness

## Context

An open TCP port does not guarantee a responding dev server. Docker proxies, crashed Node processes, and wrong listeners need differentiation without slowing scans noticeably.

## Decision

After port resolution, probe each entry in parallel:

1. Try `GET http://127.0.0.1:<port>/` with `Accept: */*`, 2s timeout, follow redirects (max 3).
2. Any HTTP response (including 4xx/5xx) → `health: alive`; record final URL scheme in `openUrl`.
3. Connection refused or timeout → try `GET https://127.0.0.1:<port>/` with same rules (self-signed allowed).
4. Both fail → `health: dead`.
5. Response received but elapsed ≥ 1500ms → `health: slow` (still alive).

Cache probe results between scans for unchanged `port+pid` for one refresh interval to avoid hammering servers.

## Consequences

- Scanner or main process runs probes outside the PowerShell worker (Node `http`/`https` modules).
- Open and Copy URL prefer `openUrl` over bare `http://localhost:<port>`.
- Framework badge remains best-effort regex on `cmd`, independent of probe.

## Alternatives considered

- **HEAD only:** some dev servers reject HEAD (rejected as primary).
- **Probe inside PowerShell worker:** couples worker to HTTP and complicates JSON payload (rejected).

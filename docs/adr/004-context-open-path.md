# ADR-004: Context open path resolution

**Status:** Accepted  
**Date:** 2026-06-01  
**Pillar:** P4 — Context jump

## Context

Developers who find a stale server in the tray often want to jump to the repo or the exact working directory the process used. `cwd` and `gitRoot` are already collected in the scan pipeline but not exposed to the UI.

## Decision

Resolve `openPath` for Explorer and editor actions as:

1. `cwd` when non-empty and path exists on disk.
2. Else `gitRoot` when non-empty and path exists.
3. Else disable context actions for that row.

**Open in Explorer:** `shell.openPath(openPath)` (Electron).

**Open in Editor:** spawn `cursor "<openPath>"` if `cursor` is on PATH, else `code "<openPath>"`, else skip silently.

No persisted editor preference in v1.

## Consequences

- Scanner must forward `cwd` and `gitRoot` through IPC to the renderer.
- Elevated or foreign-user processes with missing `cwd` fall back to `gitRoot` or cmd-derived paths when available.

## Alternatives considered

- **Always open gitRoot:** wrong when cwd is a monorepo package subfolder (rejected).
- **Parse file from cmd line:** brittle across runtimes (deferred).

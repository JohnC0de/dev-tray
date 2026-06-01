# ADR-001: Branch pinned at first sight

**Status:** Accepted  
**Date:** 2026-06-01  
**Pillar:** P1 — Session truth

## Context

Each scan re-reads the current git branch for a repo. If the developer checks out a different branch while a dev server keeps running, the tray shows the new branch as if the server were started on it. That is incorrect and erodes trust.

## Decision

Pin `branchAtStart` when an entry is first observed for a given `pid`. Re-read `branchCurrent` every scan. Set `branchDrifted` when both are non-empty and differ.

Session state is keyed by `pid`, not port. A port reuse after kill gets a new pid and therefore a fresh pin.

## Consequences

- Main process or scanner holds a small in-memory map `pid → branchAtStart`, pruned when pids disappear from scan results.
- UI shows both branches or a drift indicator when drifted; quiescent when they match.
- Detached HEAD continues to yield empty branch strings; no drift between empty values.

## Alternatives considered

- **Live branch only:** simpler but wrong after checkout (rejected).
- **Branch from process start via git reflog:** fragile and expensive (rejected).

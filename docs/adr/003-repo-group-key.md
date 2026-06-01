# ADR-003: Repo group key

**Status:** Accepted  
**Date:** 2026-06-01  
**Pillar:** P3 — Repo grouping

## Context

Monorepos often run web, API, and storybook simultaneously. A flat port-sorted list hides the relationship between servers from the same project.

## Decision

Compute `groupKey` as:

1. `gitRoot` when the entry resolved to a git repository.
2. Otherwise `projectName` (display label fallback).

UI groups entries with equal `groupKey`. Group header label uses `projectName` from the first entry in the group (they should match for git-backed entries).

Kill group invokes the existing single-process kill path for each member pid.

## Consequences

- Two ports from different packages in the same monorepo share one group (desired for v1).
- Non-git dev runtimes group only if `projectName` matches exactly.
- Single-member groups may render flat or collapsed with count 1; implementation choice, behavior equivalent.

## Alternatives considered

- **Group by port range or cmd script name:** inconsistent labels (deferred).
- **No grouping, sort by gitRoot only:** insufficient for kill-all UX (rejected).

# ADR-005: Popover list layout (grouped rows)

**Status:** Accepted  
**Date:** 2026-06-01  
**Pillar:** P1–P3 presentation (health, branch drift, repo grouping)

## Context

The popover must carry v1 pillars (health, branch drift, monorepo grouping) without turning the tray list into noise. Three layout directions were prototyped in a throwaway browser lab before implementing the production renderer.

## Decision

**Grouped (variant B)** with a **one-row strip** per server.

Row order left to right: branch · health dot · `:port` · framework · drift indicator · uptime · ghost Open/Kill actions.

Collapse repo blocks when **two or more** entries share the same `groupKey`. Single-entry repos stay flat (no group chrome).

## Alternatives considered

| Key | Name | Thesis | Outcome |
| --- | --- | --- | --- |
| A | Ledger | Evolve the flat two-line list; drift + health inline | Rejected — monorepos get noisy |
| B | Grouped | Repo-first collapsible groups | **Accepted** |
| C | Signal strip | Single-line scan rows; health + drift as badges | Rejected — too dense for kill/open affordances |

## Consequences

- Renderer owns `.group-head` / `.group-row` structure and `groupKey`-based grouping.
- Scanner and store must supply `groupKey`, `health`, and `branchDrifted` on each entry for the row strip.

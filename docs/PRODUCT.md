# Dev Tray — Product Spec

**specVersion:** 1

## Promise

Dev Tray tells you **which project** is on localhost, **whether it is actually healthy**, **how ports group in a monorepo**, and **how to jump back to the code** — not just what is listening.

## Core model

Today each scan produces a flat list of port snapshots. The v1 model treats each row as a **dev session record**: a listening process enriched with project context, session truth, liveness, and grouping metadata.

### Current shape (shipped)

```ts
Entry {
  id: string          // `${port}-${pid}`
  port: number
  pid: number
  projectName: string
  branch: string      // live git branch only — misleading when checkout changes
  startTime: string | null
}
```

### Target shape (spec v1)

```ts
Entry {
  id: string
  port: number
  pid: number
  projectName: string
  gitRoot: string | null
  cwd: string | null

  branchAtStart: string | null   // pinned when entry first appears for this pid
  branchCurrent: string | null   // re-read from git each scan
  branchDrifted: boolean         // true when both set and they differ

  startTime: string | null

  health: 'unknown' | 'alive' | 'dead' | 'slow'
  openUrl: string | null         // scheme + host + port from probe (e.g. https://localhost:5173)
  framework: string | null       // vite | next | rails | uvicorn | … parsed from cmd

  groupKey: string | null        // gitRoot, else projectName
}
```

Fields may ship incrementally by pillar, but **done** means the target shape is populated and stable across scanner, main process, renderer, and CLI.

---

## Pillars

### P1 — Session truth (branch drift)

**User outcome.** The developer knows whether a running server still matches their current checkout.

**Invariants.**

- When an entry first appears for a `pid`, Dev Tray pins `branchAtStart` from git at that moment.
- Each scan re-reads `branchCurrent` from git for the entry's `gitRoot`.
- When `branchAtStart` and `branchCurrent` are both non-empty and differ, `branchDrifted` is `true` and the UI must surface drift (badge, styling, or secondary label).
- Replacing a process (new `pid` on the same port) resets `branchAtStart` for the new process.

**Data.** `branchAtStart`, `branchCurrent`, `branchDrifted`, `gitRoot`.

**Non-goals.** Auto-kill on drift. Git hooks. Terminal or IDE integration to detect checkout changes.

**Acceptance criteria.**

- Start a dev server on branch A; switch repo to branch B without restarting the server; tray shows drift within one refresh cycle.
- Kill and restart the server; drift clears and `branchAtStart` reflects the new checkout.
- Detached HEAD (`HEAD`) yields empty branch strings; no false drift.
- Non-git processes omit branch fields; no drift UI.

**ADR.** [001-branch-pinned-at-first-sight.md](adr/001-branch-pinned-at-first-sight.md)

---

### P2 — Liveness (HTTP probe + smart open)

**User outcome.** The developer can tell a healthy dev server from a zombie listener, and Open uses a URL that actually works.

**Invariants.**

- After each scan resolves ports, Dev Tray probes each entry's localhost URL (see ADR-002).
- `health` reflects the latest probe result and is shown in the row (status dot or equivalent).
- **Open** and **Copy URL** use `openUrl` when set; fall back to `http://localhost:<port>` when probe has not completed or scheme is unknown.
- Probes must not block the scan loop longer than the configured timeout budget.

**Data.** `health`, `openUrl`, `framework` (optional badge from command line).

**Non-goals.** Full HTTP dashboard. Response body inspection. External URL health checks.

**Acceptance criteria.**

- A listening port with no HTTP response shows `health: dead` (or `unknown` until first probe completes, then `dead`).
- A typical Vite/Next dev server shows `health: alive`; Open loads the app in the default browser.
- HTTPS dev servers (when detected) set `openUrl` with `https://` and Open succeeds.
- Probe timeout does not delay tray updates by more than 2s per entry (parallel probes allowed).

**ADR.** [002-http-probe-policy.md](adr/002-http-probe-policy.md)

---

### P3 — Repo grouping (collapse + kill group)

**User outcome.** Monorepos with multiple servers stay readable; one action stops all servers from the same project.

**Invariants.**

- Entries with the same `groupKey` render as a collapsible group in the popover.
- Group header shows repo `projectName` and a port count.
- **Kill group** terminates every process in the group (whole process tree per pid, same as single Kill).
- Flat list remains the fallback when only one entry shares a `groupKey`.

**Data.** `groupKey` = `gitRoot` when present, else `projectName`.

**Non-goals.** Package-level grouping inside a monorepo (unless inferable from cmd later). Persisted collapse state across sessions (optional later).

**Acceptance criteria.**

- Two ports from the same git repo appear under one group header.
- Kill group removes all listed ports from the next scan (or animates out on kill).
- Two unrelated repos never share a group.
- Non-git entries group by `projectName` only.

**ADR.** [003-repo-group-key.md](adr/003-repo-group-key.md)

---

### P4 — Context jump (Explorer / editor from cwd)

**User outcome.** One click from a server row opens the project folder or editor at the code that owns the process.

**Invariants.**

- Context menu (or row actions) includes **Open in Explorer** and **Open in Editor**.
- Path resolution order: `cwd` if set, else `gitRoot`, else no-op with silent skip (no error toast spam).
- **Open in Editor** uses `cursor` CLI when on PATH, else `code`, else OS default for `.` folders.

**Data.** `cwd`, `gitRoot` (must be exposed from scanner to renderer).

**Non-goals.** Deep link to a specific file from cmd line. Remembering last-used editor per project.

**Acceptance criteria.**

- Row with valid `cwd` opens that directory in Explorer.
- Row with only `gitRoot` opens repo root.
- Editor command opens the same resolved path.
- Missing paths disable the menu items without crashing.

**ADR.** [004-context-open-path.md](adr/004-context-open-path.md)

---

## Out of scope (v1)

- Starting or restarting dev servers from the tray (launcher).
- Tunnels (ngrok, cloudflared) or LAN URL publishing.
- WSL2 path attribution (planned later; not part of spec v1).
- Cross-platform macOS/Linux parity before Windows depth is complete.
- Team sync, shared state, or cloud accounts.
- `.localhost-tray.json` repo metadata (future opt-in layer).
- CPU/memory monitoring except as a possible later footgun hint.

---

## Implementation phases

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| 0 | This spec + ADRs + README link | — |
| 1 | Expose `gitRoot`, `cwd`, branch fields in scanner + IPC | Phase 0 |
| 2 | P1 session truth | Phase 1 |
| 3 | P2 liveness + smart open | Phase 1 |
| 4 | P3 grouping + P4 context menu | Phase 1 |

P1 should land before or alongside P2; honest branch state is prerequisite for trustworthy session UI.

---

## Verification

- `npm run scan:once` (or future `scan --json`) must emit spec v1 fields as they ship.
- Manual acceptance: follow each pillar's acceptance criteria on a machine with at least two git repos and one monorepo with two ports.

---

## Related docs

- [README.md](../README.md) — setup and architecture
- [adr/](adr/) — decision records for pillar semantics
- [AGENTS.md](../AGENTS.md) — agent memory (points here for product intent)

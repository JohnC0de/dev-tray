# Architecture

How Dev Tray discovers, identifies, and acts on local dev servers across Windows and Linux.

For the product contract (pillars, Entry model, acceptance criteria) see
[PRODUCT.md](PRODUCT.md). For the reasoning behind specific semantics see the
[ADRs](adr/).

## Discovery pipeline

On Windows the app uses native facilities to discover listening dev servers:

| Concern | Approach |
| --- | --- |
| Listening ports → PID | `Get-NetTCPConnection -State Listen` |
| Process name / start time / command line | `Get-CimInstance Win32_Process` |
| Process working directory | reads the target's **PEB** (`NtQueryInformationProcess` + `ReadProcessMemory`) via inline C# |
| Git root + branch | `git` |
| Kill | `taskkill /PID <pid> /T /F` |
| Launch at login | `app.setLoginItemSettings` |
| Tray window | frameless transparent `BrowserWindow` anchored to the tray |
| Tray count | count rendered into the tray icon (canvas) |

### Resident scan worker

To avoid paying PowerShell's cold-start (~700 ms) on every poll, a single
`pwsh`/`powershell` process stays resident (`scan-worker.ps1`) and answers one
`SCAN` request per poll with a line of JSON terminated by a sentinel
(`<<<SCAN_END>>>`). Warm scans take ~450–550 ms. `src/main/scanner.js` manages
the worker lifecycle (stdin `SCAN`/`QUIT`), then enriches each row with Git
metadata and filters out non-dev processes.

### Linux shell adapter

`apps/linux` is a separate shell frontend, not a second Electron app. Its CLI reads user-owned
listeners from `ss`, enriches them with `/proc`, and passes the resulting `ScanRow` values through
`@dev-tray/core`. Waybar consumes the count-only JSON view; Quickshell consumes the full `Entry[]`
payload and owns open/kill interactions.

The CLI rejects kill requests for PIDs absent from the latest scan, sends `SIGTERM` to the process
tree, then uses `SIGKILL` only for survivors.

## Project detection

Detection prefers, in order:

1. The process's **real working directory** (read from its PEB on Windows or `/proc/<pid>/cwd` on
   Linux). Same-user processes are the normal supported case.
2. Absolute paths found in the **command line** (covers npm/pnpm/yarn-launched
   servers, where the bin script path is absolute).
3. The executable's directory (only for compiled binaries that live inside a
   repo).

From the chosen directory it walks up to the nearest `.git` to get the repo name
and branch. Processes that aren't a Git project and aren't a known dev runtime
(node, python, ruby, go, java, php, bun, deno, dotnet, …) are filtered out, as
are Electron/Chromium helper subprocesses (`--type=renderer|gpu-process|utility|…`)
so installed desktop apps don't clutter the list.

## Known limitations

- Working-directory read fails (and detection falls back to command-line
  parsing) for **elevated** or **32-bit** processes, and for those owned by
  another user.
- Linux only sees process details exposed to the current user through `ss` and `/proc`.
- The Linux preview is installed from source; there is no packaged distro artifact yet.

## Source layout

```
apps/desktop/           Electron tray app and Windows composition
apps/linux/             Linux CLI, Waybar module, and Quickshell popover
packages/core/          cross-platform schemas, enrichment, sessions, and probes
packages/contracts/     shared IPC contracts
packages/scan-native/   optional napi-rs scanner
scan-worker.ps1         resident Windows scanner
docs/                   product spec, architecture, and ADRs
scripts/test-server.js  tiny HTTP listener for smoke testing
assets/                 app, tray icons, and screenshots
```

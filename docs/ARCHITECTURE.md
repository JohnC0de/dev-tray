# Architecture

How Dev Tray discovers, identifies, and acts on local dev servers on Windows.

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

## Project detection

Detection prefers, in order:

1. The process's **real working directory** (read from its PEB). Works for
   64-bit, same-user, non-elevated processes — i.e. the dev servers you actually
   run.
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
- Windows-only: discovery relies on `Get-NetTCPConnection`, the Windows PEB
  layout, and `taskkill`.

## Source layout

```
docs/PRODUCT.md          product spec (pillars, Entry model, acceptance criteria)
docs/adr/                architecture decision records for pillar semantics
docs/ARCHITECTURE.md     this document
package.json             Electron app + electron-builder config
scan-worker.ps1          resident PowerShell scan worker (ports + process info + PEB cwd)
src/main/main.js         tray, popover window, polling, IPC, lifecycle
src/main/scanner.js      PowerShell-worker mgmt + project/branch resolution + filtering
src/main/store.js        settings persisted to userData
src/preload/preload.js   contextBridge IPC surface (contextIsolation on, no node in renderer)
src/renderer/            HTML/CSS/JS popover UI (port list, onboarding, settings, tray icon)
src/shared/brand.js      app name, IDs, and shared copy
scripts/gen-icons.js     regenerates assets/*.png (pure Node PNG encoder)
scripts/test-server.js   tiny http listener for testing detection
assets/                  app + tray icons + screenshot
```

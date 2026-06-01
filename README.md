# Dev Tray

**localhost, organized.** A tiny Windows tray app that tracks your dev servers across projects.

It sits in your system tray, scans for local dev servers every few seconds, and shows which
project each one belongs to — with one click to open or kill it.

## Product direction

Dev Tray is built around four pillars: **session truth** (branch drift), **liveness** (HTTP
health + smart open), **repo grouping**, and **context jump** (Explorer / editor from cwd).
The full contract, data model, and acceptance criteria live in
[docs/PRODUCT.md](docs/PRODUCT.md).

## What it does

- **Auto-detection** — scans listening TCP ports (1024–49151) every few seconds.
- **Project context** — resolves each server's working directory, then its Git repo name + current branch.
- **Kill / open** — stop a server (whole process tree) or open `http://localhost:<port>` in your browser.
- **Copy** — right-click a row to copy the URL or the port.
- **Tray badge** — the tray icon shows a live count with a status colour (grey = none, green = running).
- **Settings** — refresh interval (2/5/10/30s), Launch at Login.

## Requirements

- Windows 10/11
- Node.js 18+ and npm (to run from source)
- PowerShell (Windows PowerShell 5.1 or PowerShell 7 — both work)
- Git on `PATH` (optional; only needed to show branch names)

## Run from source

```powershell
npm install
npm start
```

The app launches into the system tray (no taskbar window). Click the tray icon to open the popover.

> If `npm install` finishes but Electron's binary didn't download (you'll see an
> `ENOENT … path.txt` error on `npm start`), run `node node_modules/electron/install.js`
> once, or reinstall with network access.

## Build a Windows installer

```powershell
npm run dist      # NSIS installer in dist/
npm run pack      # unpacked app in dist/win-unpacked/ (no installer)
```

`scan-worker.ps1` is bundled as an `extraResource` and resolved from `process.resourcesPath`
in packaged builds.

## How it works

On Windows this app uses native facilities to discover listening dev servers:

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

To avoid paying PowerShell's cold-start (~700 ms) on every poll, a single `pwsh`/`powershell`
process stays resident (`scan-worker.ps1`) and answers one `SCAN` request per poll with a line
of JSON. Warm scans take ~450–550 ms.

### Project detection

Detection prefers, in order:

1. The process's **real working directory** (read from its PEB). Works for 64-bit, same-user,
   non-elevated processes — i.e. the dev servers you actually run.
2. Absolute paths found in the **command line** (covers npm/pnpm/yarn-launched servers, where
   the bin script path is absolute).
3. The executable's directory (only for compiled binaries that live inside a repo).

From the chosen directory it walks up to the nearest `.git` to get the repo name and branch.
Processes that aren't a Git project and aren't a known dev runtime (node, python, ruby, go, java,
php, bun, deno, dotnet, …) are filtered out, as are Electron/Chromium helper subprocesses
(`--type=renderer|gpu-process|utility|…`) so installed desktop apps don't clutter the list.

### Known limitations

- Working-directory read fails (and detection falls back to command-line parsing) for
  **elevated** or **32-bit** processes, and for those owned by another user.

## Project layout

```
docs/PRODUCT.md          product spec (pillars, Entry model, acceptance criteria)
docs/adr/                architecture decision records for pillar semantics
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
assets/                  app + tray icons
```

## License

MIT

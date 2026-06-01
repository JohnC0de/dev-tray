## Learned User Preferences

- Uses `/poteto-mode` for nontrivial multi-step engineering work (features, investigations, bug fixes).
- Product name is **Dev Tray** (two words); avoid the one-word form "DevTray" in branding and app IDs.
- Prefers Cursor Canvas for visualizing architecture and subsystem flows when exploring complex code.
- Product identity changes should go through `src/shared/brand.js` as the single source of truth.

## Learned Workspace Facts

- Permanent product spec (pillars, Entry model, acceptance criteria): `docs/PRODUCT.md`; ADRs in `docs/adr/`.
- Windows Electron system-tray app **Dev Tray**; tagline is "localhost, organized".
- App identity lives in `src/shared/brand.js`: APP_NAME, APP_ID, PACKAGE_NAME, BRIDGE_NAME, ENV_PREFIX, SCAN_SENTINEL.
- npm package `dev-tray`, Electron appId `app.dev-tray`, preload bridge `window.devTray`.
- Debug and UI-capture env vars: `DEV_TRAY_DEBUG`, `DEV_TRAY_SHOW`.
- Scan pipeline uses resident `scan-worker.ps1` (stdin SCAN/QUIT, JSON + sentinel) and `src/main/scanner.js` for git enrichment and dev-server filtering.
- Source layout: `src/main/main.js`, `src/main/scanner.js`, `src/main/store.js`, `src/preload/preload.js`, `src/renderer/`, `scan-worker.ps1` at repo root.
- Scan sentinel string is `<<<SCAN_END>>>` (shared between worker and scanner via brand.js).
- Architecture docs canvas lives under the workspace `.cursor/projects/.../canvases/` path for this repo.

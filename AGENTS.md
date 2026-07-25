## Learned User Preferences

- Uses `/poteto-mode` for nontrivial multi-step engineering work (features, investigations, bug fixes).
- Product name is **Dev Tray** (two words); avoid the one-word form "DevTray" in branding and app IDs.
- Prefers Cursor Canvas for visualizing architecture and subsystem flows when exploring complex code.
- Product identity changes should go through `src/shared/brand.js` as the single source of truth.
- Prefers human, non-AI prose in README and other user-facing docs (avoid generic AI tone).
- Popover UI should stay clean and minimal: grouped repo layout, one row per server, icon-only ghost actions for Open/Kill/Kill group, server count immediately after group name with a dot separator.
- Prototypes UI layout options in Paper before implementing in the production renderer.

## Learned Workspace Facts

- Permanent product spec (pillars, Entry model, acceptance criteria): `docs/PRODUCT.md`; ADRs in `docs/adr/`.
- Technical architecture (discovery pipeline, scan worker): `docs/ARCHITECTURE.md`.
- Windows Electron system-tray app **Dev Tray**; tagline is "localhost, organized".
- App identity lives in `src/shared/brand.js`: APP_NAME, APP_ID, PACKAGE_NAME, BRIDGE_NAME, ENV_PREFIX, SCAN_SENTINEL.
- npm package `dev-tray`, Electron appId `app.dev-tray`, preload bridge `window.devTray`.
- Debug and UI-capture env vars: `DEV_TRAY_DEBUG`, `DEV_TRAY_SHOW`.
- Scan pipeline uses resident `scan-worker.ps1` (stdin SCAN/QUIT, JSON + sentinel) and `src/main/scanner.js` for git enrichment and dev-server filtering.
- Native scanner (Phase 6): `packages/scan-native` (`@dev-tray/scan-native`, napi-rs). Build with `npm run build:native` (requires Rust MSVC on Windows). Not wired into PollLoop until Phase 4.
- Source layout: `src/main/main.js`, `src/main/scanner.js`, `src/main/store.js`, `src/preload/preload.js`, `src/renderer/`, `scan-worker.ps1` at repo root.
- Scan sentinel string is `<<<SCAN_END>>>` (shared between worker and scanner via brand.js).
- Popover list layout (grouped one-row strips): `docs/adr/005-ui-popover-layout.md`.
- Architecture canvas: `.cursor/projects/c-Users-Admin-projects-port-menu/canvases/resident-scan-worker.canvas.tsx`.

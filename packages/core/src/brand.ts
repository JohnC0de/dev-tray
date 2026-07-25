export const APP_NAME = 'Dev Tray';
export const APP_ID = 'app.dev-tray';
export const PACKAGE_NAME = 'dev-tray';
export const BRIDGE_NAME = 'devTray';
export const ENV_PREFIX = 'DEV_TRAY';
export const SCAN_SENTINEL = '<<<SCAN_END>>>';

export function trayTooltip(count: number): string {
  if (count === 0) return `${APP_NAME} — no dev servers`;
  return `${APP_NAME} — ${count} dev server${count === 1 ? '' : 's'}`;
}

'use strict';

const APP_NAME = 'Dev Tray';
const APP_ID = 'app.dev-tray';
const PACKAGE_NAME = 'dev-tray';
const BRIDGE_NAME = 'devTray';
const ENV_PREFIX = 'DEV_TRAY';
const SCAN_SENTINEL = '<<<SCAN_END>>>';

function trayTooltip(count) {
  if (count === 0) return `${APP_NAME} — no dev servers`;
  return `${APP_NAME} — ${count} dev server${count === 1 ? '' : 's'}`;
}

module.exports = Object.freeze({
  APP_NAME,
  APP_ID,
  PACKAGE_NAME,
  BRIDGE_NAME,
  ENV_PREFIX,
  SCAN_SENTINEL,
  trayTooltip,
});

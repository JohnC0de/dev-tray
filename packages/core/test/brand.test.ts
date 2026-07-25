import { describe, expect, it } from 'vitest';
import { APP_NAME, BRIDGE_NAME, trayTooltip } from '../src/brand';

describe('brand', () => {
  it('exports stable bridge name', () => {
    expect(BRIDGE_NAME).toBe('devTray');
  });

  it('formats tray tooltip', () => {
    expect(trayTooltip(0)).toBe(`${APP_NAME} — no dev servers`);
    expect(trayTooltip(1)).toBe(`${APP_NAME} — 1 dev server`);
    expect(trayTooltip(3)).toBe(`${APP_NAME} — 3 dev servers`);
  });
});

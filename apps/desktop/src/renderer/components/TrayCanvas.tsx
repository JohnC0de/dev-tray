import { onMount } from 'solid-js';
import { api, appName, entries } from '../state/app-store.js';

const TRAY_COLORS = { idle: '#8e8e93', active: '#2fcb53', error: '#ff9f0a' };

export function TrayCanvas() {
  let canvas: HTMLCanvasElement | undefined;
  let lastKey = '';

  onMount(() => {
    const tick = () => {
      if (!canvas) return;
      const count = entries().length;
      const err = false;
      const status = err && count === 0 ? 'error' : count === 0 ? 'idle' : 'active';
      const key = `${status}:${count}`;
      if (key === lastKey) return;
      lastKey = key;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 32, 32);
      ctx.fillStyle = TRAY_COLORS[status as keyof typeof TRAY_COLORS];
      ctx.beginPath();
      ctx.roundRect(2, 2, 28, 28, 8);
      ctx.fill();
      if (count > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = count > 99 ? '99+' : String(count);
        ctx.font = `600 ${label.length >= 3 ? 11 : label.length === 2 ? 16 : 19}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText(label, 16, 17);
      }
      const tip =
        count === 0
          ? `${appName()} — no dev servers`
          : `${appName()} — ${count} dev server${count === 1 ? '' : 's'}`;
      try {
        api.updateTray({ dataURL: canvas.toDataURL('image/png'), tooltip: tip });
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  });

  return <canvas ref={canvas} id="tray-canvas" width={32} height={32} aria-hidden="true" />;
}

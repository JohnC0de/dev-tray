import { api } from './state/app-store.js';

const BLOCKED = 'button, input, a, textarea, select, .controls, .icon-btn, .hbtn, .port-row, .group-head, .settings-pop, .context-menu, .list, .btn-primary, .btn-secondary, .retry';

function isDragTarget(target: EventTarget | null, frame: HTMLElement): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(BLOCKED)) return false;
  if (target.closest('.header')) return true;
  if (target.closest('.onboard h1, .onboard p')) return true;
  if (target === frame) return true;
  return false;
}

function beginWindowDrag(e: MouseEvent): void {
  e.preventDefault();
  api.dragStart(e.screenX, e.screenY);
  const move = (ev: MouseEvent) => {
    ev.preventDefault();
    api.dragMove(ev.screenX, ev.screenY);
  };
  const up = () => {
    api.dragEnd();
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

export function setupWindowDrag(frame: HTMLElement): () => void {
  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (!isDragTarget(e.target, frame)) return;
    beginWindowDrag(e);
  };
  frame.addEventListener('mousedown', onMouseDown, true);
  return () => frame.removeEventListener('mousedown', onMouseDown, true);
}

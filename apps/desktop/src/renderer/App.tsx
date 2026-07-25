import { createSignal, onMount, type JSX } from 'solid-js';
import {
  applyPortsUpdate,
  hasCompletedOnboarding,
  initApp,
  settingsOpen,
  setSettingsOpen,
} from './state/app-store.js';
import { Onboarding } from './components/Onboarding.js';
import { PortList } from './components/PortList.js';
import { TrayCanvas } from './components/TrayCanvas.js';
import { setupWindowDrag } from './window-drag.js';

const FRAME_PAD = 10;
const CARD_PAD = 8;

export function App(): JSX.Element {
  const [ready, setReady] = createSignal(false);
  let cardRef: HTMLDivElement | undefined;
  let frameRef: HTMLDivElement | undefined;
  let stopDrag: (() => void) | undefined;
  let lastSentHeight = 0;

  const bindFrameRef = (el: HTMLDivElement) => {
    frameRef = el;
    stopDrag?.();
    stopDrag = setupWindowDrag(el);
  };

  const commitResize = () => {
    if (!cardRef || !frameRef) return;
    const pop = cardRef.querySelector('.settings-pop') as HTMLElement | null;
    if (pop) {
      const cardTop = cardRef.getBoundingClientRect().top;
      const popBottom = pop.getBoundingClientRect().bottom;
      cardRef.style.minHeight = `${Math.ceil(popBottom - cardTop + CARD_PAD)}px`;
    } else {
      cardRef.style.minHeight = '';
    }
    const frameTop = frameRef.getBoundingClientRect().top;
    const bottom = pop
      ? pop.getBoundingClientRect().bottom
      : frameRef.getBoundingClientRect().bottom;
    const h = Math.ceil(bottom - frameTop + FRAME_PAD);
    if (h !== lastSentHeight) {
      lastSentHeight = h;
      window.devTray.resizeWindow(h);
    }
  };

  onMount(async () => {
    await initApp();
    setReady(true);

    window.devTray.onPortsUpdate((data) => {
      applyPortsUpdate(data);
      requestAnimationFrame(commitResize);
    });

    window.devTray.onWillShow(() => {
      if (settingsOpen()) setSettingsOpen(false);
      requestAnimationFrame(commitResize);
    });

    const ro = new ResizeObserver(() => requestAnimationFrame(commitResize));
    if (cardRef) ro.observe(cardRef);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.devTray.hideWindow();
    });

    requestAnimationFrame(commitResize);
    return () => {
      ro.disconnect();
      stopDrag?.();
    };
  });

  return (
    <>
      <div class="frame" ref={bindFrameRef}>
        <div id="card" class="card" ref={cardRef}>
          {ready() && (hasCompletedOnboarding()
            ? <PortList />
            : <Onboarding onDone={() => requestAnimationFrame(commitResize)} />)}
        </div>
      </div>
      <TrayCanvas />
    </>
  );
}

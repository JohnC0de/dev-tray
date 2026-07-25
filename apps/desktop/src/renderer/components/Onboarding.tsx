import { For, onCleanup, onMount, type JSX } from 'solid-js';
import { completeOnboarding, setSettings, settings } from '../state/app-store.js';

const GLYPHS = '0123456789abcdefABCDEF!@#$%&*?<>{}[]|~'.split('');
const ONBOARD_PORTS: Array<[string, number, number]> = [
  ['localhost:3000', 49, 40],
  ['localhost:5173', 240, 28],
  ['localhost:8080', 32, 124],
  ['localhost:4000', 232, 120],
  ['localhost:3001', 128, 72],
  ['localhost:9000', 64, 205],
  ['localhost:8000', 236, 195],
  ['localhost:5000', 150, 168],
];
const REVEAL_DELAYS = [50, 250, 420, 560, 670, 750, 810, 860];

interface Props {
  onDone: () => void;
}

export function Onboarding(props: Props): JSX.Element {
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const oTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.splice(timers.indexOf(id), 1);
      if (!cancelled) fn();
    }, ms);
    timers.push(id);
  };

  onCleanup(() => {
    cancelled = true;
    timers.forEach(clearTimeout);
  });

  const scramble = (node: HTMLElement, target: string) => {
    let step = 0;
    const steps = 14;
    const tick = () => {
      if (cancelled) return;
      step++;
      if (step >= steps) {
        node.textContent = target;
        return;
      }
      const resolved = Math.floor(target.length * (step / steps));
      node.textContent = target
        .split('')
        .map((c, i) =>
          i < resolved || c === ':' || c === '.' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!,
        )
        .join('');
      setTimeout(tick, 40);
    };
    node.textContent = target.split('').map((c) => (c === ':' || c === '.' ? c : GLYPHS[0]!)).join('');
    setTimeout(tick, 40);
  };

  let h1Ref: HTMLHeadingElement | undefined;
  let pRef: HTMLParagraphElement | undefined;
  let actionsRef: HTMLDivElement | undefined;
  const ghostRefs: HTMLDivElement[] = [];

  onMount(() => {
    const boot = setTimeout(() => {
      ONBOARD_PORTS.forEach(([label, x, y], i) => {
        oTimeout(() => {
          const g = ghostRefs[i];
          if (!g) return;
          g.style.opacity = '0.22';
          g.style.transform = 'scale(1)';
          g.style.filter = 'blur(0)';
          scramble(g, label);
        }, REVEAL_DELAYS[i]!);
      });
      oTimeout(() => {
        ghostRefs.forEach((g) => {
          g.style.opacity = '0';
          g.style.transform = 'scale(0.94)';
          g.style.filter = 'blur(6px)';
        });
        oTimeout(() => h1Ref?.classList.add('show'), 250);
        oTimeout(() => pRef?.classList.add('show'), 420);
        oTimeout(() => actionsRef?.classList.add('show'), 550);
      }, 1700);
    }, 0);
    timers.push(boot);
  });

  const finish = async () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    await completeOnboarding();
    setSettings({ ...settings(), hasCompletedOnboarding: true });
    props.onDone();
  };

  return (
    <div class="onboard">
      <div class="ports-layer">
        <For each={ONBOARD_PORTS}>
          {([, x, y], i) => (
            <div
              class="ghost"
              ref={(el) => {
                ghostRefs[i()] = el;
              }}
              style={{ left: `${x}px`, top: `${y}px` }}
            />
          )}
        </For>
      </div>
      <div class="content">
        <h1 class="reveal" ref={h1Ref}>
          localhost,
          <br />
          organized.
        </h1>
        <p class="reveal" ref={pRef}>
          A tray app that tracks your
          <br />
          dev servers across projects.
        </p>
      </div>
      <div class="actions reveal" ref={actionsRef}>
        <button
          type="button"
          class="btn-primary"
          onClick={() => { void finish().catch((err) => console.error('completeOnboarding failed', err)); }}
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

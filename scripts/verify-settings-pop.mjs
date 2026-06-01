import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const DEBUG_PORT = 9222;
const ROOT = path.dirname(fileURLToPath(new URL('..', import.meta.url)));

function startElectron() {
  return spawn('npx', ['electron', '.', `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    stdio: 'pipe',
    shell: true,
  });
}

async function cdp(wsUrl, method, params = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const id = 1;
  const result = await new Promise((resolve, reject) => {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    }, { once: true });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return result;
}

async function getPageTarget() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await res.json();
  return targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
}

async function measure(pageTarget) {
  const { result } = await cdp(pageTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `(() => {
      const frame = document.querySelector('.frame');
      const card = document.getElementById('card');
      const pop = card?.querySelector('.settings-pop');
      const popRect = pop?.getBoundingClientRect();
      const cardRect = card?.getBoundingClientRect();
      const frameRect = frame?.getBoundingClientRect();
      const clipped = !!(pop && cardRect && popRect && popRect.bottom > cardRect.bottom + 0.5);
      const wrongH = pop
        ? Math.max(frameRect.height, pop.offsetTop + pop.offsetHeight + 20)
        : frameRect.height;
      return {
        windowInnerHeight: window.innerHeight,
        frameHeight: Math.round(frameRect?.height ?? 0),
        cardHeight: Math.round(cardRect?.height ?? 0),
        popBottom: Math.round(popRect?.bottom ?? 0),
        cardBottom: Math.round(cardRect?.bottom ?? 0),
        popOffsetTop: pop?.offsetTop ?? null,
        popOffsetHeight: pop?.offsetHeight ?? null,
        wrongFormulaHeight: Math.round(wrongH),
        clipped,
        settingsOpen: !!pop,
      };
    })()`,
    returnByValue: true,
  });
  return result.value;
}

async function clickSettings(pageTarget) {
  await cdp(pageTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `document.querySelector('.hbtn[title="Settings"]')?.click()`,
  });
}

async function clickGetStarted(pageTarget) {
  await cdp(pageTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Get started'));
      btn?.click();
    })()`,
  });
}

async function countResizeFlicker(pageTarget, ms = 800) {
  const { result } = await cdp(pageTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      const heights = [];
      const obs = new ResizeObserver(() => {
        heights.push(Math.round(document.querySelector('.frame').getBoundingClientRect().height));
      });
      obs.observe(document.getElementById('card'));
      setTimeout(() => { obs.disconnect(); resolve(heights); }, ${ms});
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  const heights = result.value || [];
  const unique = [...new Set(heights)];
  return { samples: heights.length, uniqueHeights: unique, flicker: unique.length > 1 };
}

async function main() {
  const useExisting = process.argv.includes('--existing');
  const child = useExisting ? null : startElectron();
  if (!useExisting) await sleep(2500);

  try {
    const pageTarget = await getPageTarget();
    if (!pageTarget) throw new Error('no page target');

    await clickGetStarted(pageTarget);
    await sleep(1000);

    const before = await measure(pageTarget);
    await clickSettings(pageTarget);
    await sleep(300);
    const after = await measure(pageTarget);
    const flicker = await countResizeFlicker(pageTarget);

    console.log(JSON.stringify({ before, after, flicker }, null, 2));
    process.exitCode = after.clipped || flicker.flicker ? 1 : 0;
  } finally {
    if (child) child.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

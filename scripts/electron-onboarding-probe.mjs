import { chromium } from 'playwright';

const CDP = process.env.DEV_TRAY_CDP_URL ?? 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP(CDP);
const pages = browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => p.url().includes('localhost')) ?? pages.at(-1);
if (!page) {
  console.error('no renderer page', pages.map((p) => p.url()));
  process.exit(2);
}

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

await page.waitForSelector('.btn-primary', { timeout: 15000 });
await sleep(2500);

const before = await page.evaluate(() => ({
  hasBridge: typeof window.devTray !== 'undefined',
  onboard: !!document.querySelector('.onboard'),
  header: !!document.querySelector('.header'),
}));

await page.click('.btn-primary', { force: true });
await sleep(1000);

const after = await page.evaluate(async () => {
  let ipcOk = false;
  try {
    ipcOk = await window.devTray.completeOnboarding();
  } catch (e) {
    return { ipcOk, ipcError: String(e), onboard: !!document.querySelector('.onboard'), header: !!document.querySelector('.header') };
  }
  return {
    ipcOk,
    onboard: !!document.querySelector('.onboard'),
    header: !!document.querySelector('.header'),
  };
});

console.log(JSON.stringify({ before, after, logs }, null, 2));
await browser.close();

const pass = before.onboard && after.header && !after.onboard;
process.exit(pass ? 0 : 1);

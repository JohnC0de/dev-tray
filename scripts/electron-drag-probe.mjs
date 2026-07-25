import { chromium } from 'playwright';

const CDP = process.env.DEV_TRAY_CDP_URL ?? 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('localhost'));
if (!page) {
  console.error('no renderer page');
  process.exit(2);
}

await page.waitForSelector('.header, .onboard h1', { timeout: 15000 });
const before = await page.evaluate(() => window.devTray.getBounds());
const handle = (await page.locator('.header .title').count()) > 0
  ? page.locator('.header .title')
  : page.locator('.onboard h1');
const box = await handle.boundingBox();
if (!box || !before) {
  console.error('missing layout', { box, before });
  process.exit(2);
}

const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(cx + i * 12, cy + i * 6);
  await sleep(16);
}
await page.mouse.up();
await sleep(200);

const after = await page.evaluate(() => window.devTray.getBounds());
console.log(JSON.stringify({ before, after, moved: before.x !== after?.x || before.y !== after?.y }, null, 2));
await browser.close();
process.exit(before && after && (before.x !== after.x || before.y !== after.y) ? 0 : 1);

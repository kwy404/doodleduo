// Renders PNG previews of the art for review: the mascot, the banner, the character sheet and
// the landing page hero, into assets/preview/. Uses a headless browser.
// node scripts/render-previews.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { serve } from './serve.mjs';
import { launchContext } from '../test/browser.mjs';

const out = 'assets/preview';
mkdirSync(out, { recursive: true });
const jobs = [
  ['assets/mascot-dark.svg', 'mascot.png', 720, 520],
  ['assets/banner-dark.svg', 'banner.png', 1280, 420],
  ['assets/brand/character-sheet.svg', 'character-sheet.png', 1600, 1160],
];
const context = await launchContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
const page = await context.newPage();
for (const [src, name, w, h] of jobs) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<body style="margin:0;background:#0a0c0f">${readFileSync(src, 'utf8')}</body>`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}`, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`preview: ${out}/${name}`);
}
const port = 9600 + Math.floor(Math.random() * 300);
const server = await serve(port, 'docs');
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`http://127.0.0.1:${port}/doodleduo/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
// Let the headline write itself and the ducks walk in, then draw a line on the slate.
await page.waitForTimeout(5200);
await page.mouse.move(360, 600);
await page.mouse.down();
for (let i = 0; i < 40; i++) await page.mouse.move(360 + i * 9, 600 + Math.sin(i / 4) * 36, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(4200);
await page.screenshot({ path: `${out}/landing-hero.png` });
console.log(`preview: ${out}/landing-hero.png`);
await context.close();
server.closeAllConnections?.();
server.close();

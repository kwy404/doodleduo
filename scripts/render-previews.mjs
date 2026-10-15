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
const context = await launchContext({ viewport: { width: 1600, height: 1200 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
const page = await context.newPage();
for (const [src, name, w, h] of jobs) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<body style="margin:0;background:#0a0c0f">${readFileSync(src, 'utf8')}</body>`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}`, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`preview: ${out}/${name}`);
}
const port = 9600 + Math.floor(Math.random() * 300);
const server = await serve(port, 'docs');
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`http://127.0.0.1:${port}/doodleduo/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/landing-hero.png` });
console.log(`preview: ${out}/landing-hero.png`);
await context.close();
server.closeAllConnections?.();
server.close();

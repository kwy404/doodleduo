// QA: screenshots of the landing page and the app at 1860x930, 1440x900 and 375x812, in the
// dark and the light theme, served under /doodleduo/ like GitHub Pages. Fails on any console
// error or failed request. Output goes to tmp/shots/.
// node scripts/shots.mjs
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
import { launchContext } from '../test/browser.mjs';

const out = 'tmp/shots';
mkdirSync(out, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 300);
const server = await serve(port, 'docs');
const sizes = [[1860, 930], [1440, 900], [375, 812]];
const problems = [];
for (const theme of ['dark', 'light']) {
  const context = await launchContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await context.addInitScript((t) => {
    localStorage.setItem('voodoo:theme', t);
    localStorage.setItem('doodleduo:theme', JSON.stringify(t));
    localStorage.setItem('doodleduo:welcomed', 'true');
    localStorage.setItem('doodleduo:name', JSON.stringify('Ana'));
  }, theme);
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${theme} console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${theme} page: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`${theme} request: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${theme} ${r.status()}: ${r.url()}`));
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${port}/doodleduo/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(1500);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > w) problems.push(`${theme} ${w}: the landing page scrolls sideways (${width}px)`);
    await page.screenshot({ path: `${out}/home-${theme}-${w}.png` });
    for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += h * 0.8) {
      await page.evaluate((top) => scrollTo(0, top), y);
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/home-${theme}-${w}-full.png`, fullPage: true });
    await page.goto(`http://127.0.0.1:${port}/doodleduo/app/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.doodleduo?.S.ready, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const appWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (appWidth > w) problems.push(`${theme} ${w}: the app scrolls sideways (${appWidth}px)`);
    await page.screenshot({ path: `${out}/app-${theme}-${w}.png` });
    console.log(`shots: ${theme} ${w}x${h}`);
  }
  await context.close();
}
server.closeAllConnections?.();
server.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`shots: saved to ${out}, no console errors, no failed requests`);

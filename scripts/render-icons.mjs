// Renders the PNG app icons from the SVG ones with a headless browser.
// node scripts/render-icons.mjs
import { readFileSync } from 'node:fs';
import { launchContext } from '../test/browser.mjs';

const jobs = [
  ['docs/app/icons/icon.svg', 'docs/app/icons/icon-192.png', 192],
  ['docs/app/icons/icon.svg', 'docs/app/icons/icon-512.png', 512],
  ['docs/app/icons/maskable.svg', 'docs/app/icons/maskable-512.png', 512],
];
const context = await launchContext({ viewport: { width: 512, height: 512 } });
const page = await context.newPage();
for (const [src, out, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  const svg = readFileSync(src, 'utf8').replace('<svg ', `<svg style="width:${size}px;height:${size}px;display:block" `);
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  await page.screenshot({ path: out, omitBackground: true });
  console.log(`rendered ${out}`);
}
await context.close();

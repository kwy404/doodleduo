// Finds a Chromium based browser for the browser tests and starts it with a fresh profile in a
// temporary folder and fake media devices. Pass a path as the first argument or set BROWSER.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function browserPath() {
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chromium based browser found. Set BROWSER to its path.');
  return found;
}

const ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

/** A persistent context in its own fresh user data folder. close() also removes the folder. */
export async function launchContext(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'doodleduo-'));
  const context = await chromium.launchPersistentContext(dir, {
    executablePath: browserPath(),
    headless: true,
    args: ARGS,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    ...options,
  });
  const close = context.close.bind(context);
  context.close = async () => {
    await close().catch(() => {});
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  };
  return context;
}

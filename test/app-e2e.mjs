// End to end test in a real browser, with live public relays for the six word pairing.
// Three people, each in their own browser profile (a fresh user data folder):
//   1. Ana draws alone, then invites Bia with six words and a QR code; Bia joins and reads the
//      confirmation words back, which Ana types.
//   2. Ana and Bia draw at the same time with the mouse and edit the same elements at once.
//   3. Bia invites Caio, who joins late and must receive the whole board, pictures included.
//   4. All three draw and edit at the same time; every replica must end with the same state.
//   5. Undo by one person, exports and a board file round trip.
// The site is served under /doodleduo/, like GitHub Pages.
//
// Usage: node test/app-e2e.mjs   (BROWSER may point to a Chromium based browser)

import { serve } from '../scripts/serve.mjs';
import { launchContext } from './browser.mjs';

const port = 8700 + Math.floor(Math.random() * 200);
const server = await serve(port, 'docs');
const base = `http://127.0.0.1:${port}/doodleduo/app/`;
let step = 0;
const log = (msg) => console.log(`${String(++step).padStart(2, '0')} ${msg}`);
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`check failed: ${msg}`);
};
const people = [];

async function person(name) {
  const context = await launchContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
    if (process.env.E2E_VERBOSE) console.log(`[${name}] ${m.text()}`);
  });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#welcome-name', { state: 'visible', timeout: 60000 });
  await page.fill('#welcome-name', name);
  await page.click('#welcome-go');
  await page.waitForFunction(() => window.doodleduo?.S.ready && !window.doodleduo.S.dlg, null, { timeout: 30000 });
  const p = { name, page, context };
  people.push(p);
  return p;
}

const run = (p, fn, arg) => p.page.evaluate(fn, arg);

async function stroke(p, x, y, wave = 1) {
  const m = p.page.mouse;
  await p.page.click('[data-tool="pen"]');
  await m.move(x, y);
  await m.down();
  for (let i = 0; i < 30; i++) await m.move(x + i * 8, y + Math.sin(i / 3) * 30 * wave, { steps: 2 });
  await m.up();
}

async function pair(host, guest) {
  await host.page.click('#invite-btn');
  await host.page.waitForFunction(() => document.querySelector('#invite-words')?.dataset.words?.split(' ').length === 6, null, { timeout: 90000, polling: 250 });
  const words = (await host.page.getAttribute('#invite-words', 'data-words')).split(' ');
  ok(await host.page.locator('#invite-dialog .qr svg').count(), 'the invite shows a QR code');
  ok(!(await host.page.locator('#invite-dialog').innerText()).includes('http'), 'the invite shows no link');
  await guest.page.click('#join-btn');
  for (let i = 0; i < 6; i++) await guest.page.fill(`#join-word-${i}`, words[i]);
  await guest.page.click('#join-go');
  await guest.page.waitForFunction(() => document.querySelector('#show-words')?.dataset.words?.split(' ').length === 6, null, { timeout: 90000, polling: 250 });
  const confirm = (await guest.page.getAttribute('#show-words', 'data-words')).split(' ');
  await host.page.waitForSelector('#confirm-word-0', { state: 'visible', timeout: 30000 });
  for (let i = 0; i < 6; i++) await host.page.fill(`#confirm-word-${i}`, confirm[i]);
  await host.page.click('#confirm-btn');
  await guest.page.waitForFunction(() => window.doodleduo.S.pair.stage === 'done', null, { timeout: 30000 });
  return words;
}

async function converge(list, label, timeout = 45000) {
  const end = Date.now() + timeout;
  let prints = [];
  while (Date.now() < end) {
    prints = await Promise.all(list.map((p) => run(p, () => window.doodleduo.fingerprint())));
    if (prints.every((f) => f === prints[0])) {
      const counts = await Promise.all(list.map((p) => run(p, () => window.doodleduo.count())));
      log(`${label}: ${list.length} replicas identical, ${counts[0]} visible elements, ${prints[0].length} characters of state`);
      return counts[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label}: replicas did not converge (${prints.map((f) => f.length).join(', ')} characters)`);
}

// A real picture, drawn in the page: a gradient with a circle.
const pictureOf = (p) =>
  run(p, () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 320, 200);
    g.addColorStop(0, '#8fa8c2');
    g.addColorStop(1, '#c9a3a6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = '#ece9e1';
    ctx.beginPath();
    ctx.arc(160, 100, 50, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png').split(',')[1];
  }).then((b64) => Buffer.from(b64, 'base64'));

try {
  const ana = await person('Ana');
  const bia = await person('Bia');
  const stun = await run(ana, async () => {
    for (let i = 0; i < 40 && !window.doodleduo.S.stun.checked; i++) await new Promise((r) => setTimeout(r, 250));
    return window.doodleduo.S.stun;
  });
  log(`STUN check: ${stun.results.map((r) => `${r.host} ${r.ok ? 'answered' : 'silent'}`).join(', ')}`);

  await stroke(ana, 300, 300);
  await run(ana, () => window.doodleduo.edit('create', 3));
  await ana.page.setInputFiles('#image-file', { name: 'dot.png', mimeType: 'image/png', buffer: await pictureOf(ana) });
  await ana.page.waitForFunction(() => window.doodleduo.view().list.some((e) => e.type === 'image'), null, { timeout: 15000 });
  log('Ana drew a stroke, three shapes and a picture alone');

  // Two fingers: spread them apart to zoom in, then move both to pan.
  const pinch = await run(ana, async () => {
    const c = document.getElementById('board');
    const r = c.getBoundingClientRect();
    const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: r.left + x, clientY: r.top + y, bubbles: true }));
    const view = window.doodleduo.view();
    const z0 = view.cam.z;
    const count0 = view.list.length;
    fire('pointerdown', 11, 400, 400);
    fire('pointerdown', 12, 500, 400);
    for (let i = 1; i <= 10; i++) {
      fire('pointermove', 11, 400 - i * 10, 400);
      fire('pointermove', 12, 500 + i * 10, 400);
      await new Promise((r2) => setTimeout(r2, 16));
    }
    const z1 = view.cam.z;
    const x1 = view.cam.x;
    for (let i = 1; i <= 5; i++) {
      fire('pointermove', 11, 300 + i * 20, 400);
      fire('pointermove', 12, 600 + i * 20, 400);
      await new Promise((r2) => setTimeout(r2, 16));
    }
    fire('pointerup', 11, 400, 400);
    fire('pointerup', 12, 700, 400);
    return { zoomed: z1 / z0, panned: view.cam.x !== x1, drew: view.list.length - count0 };
  });
  ok(pinch.zoomed > 2.5 && pinch.panned && pinch.drew === 0, `two fingers pinch zoom and pan without drawing (${JSON.stringify(pinch)})`);
  await run(ana, () => window.doodleduo.view().fit());
  log(`two fingers zoomed ${pinch.zoomed.toFixed(1)} times and panned, without drawing`);

  const words = await pair(ana, bia);
  log(`Bia joined with six words (${words.length}) and the confirmation words matched`);
  await bia.page.waitForFunction(() => window.doodleduo.S.people.length === 2, null, { timeout: 30000 });
  await converge([ana, bia], 'after the first join');
  const hasPicture = (p) => run(p, async () => {
    for (let i = 0; i < 40; i++) {
      const el = window.doodleduo.view().list.find((e) => e.type === 'image');
      if (el) {
        const { getBlob } = await import('./js/db.js');
        if (await getBlob(el.src)) return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  });
  ok(await hasPicture(bia), 'Bia received the picture');
  log('Bia received the board and the picture');

  // Cursors: Ana's pointer shows on Bia's screen.
  await ana.page.mouse.move(700, 420);
  await ana.page.mouse.move(720, 430);
  await ana.page.waitForFunction(() => !window.doodleduo.S.dlg, null, { timeout: 10000 });
  for (let i = 0; i < 10; i++) await ana.page.mouse.move(700 + i * 4, 420 + i * 2);
  await bia.page.waitForSelector('#cursors .peer-cursor', { timeout: 10000 }).catch(async (err) => {
    console.log(await run(bia, () => JSON.stringify({ n: document.querySelectorAll('.peer-cursor').length, html: document.getElementById('cursors').outerHTML.slice(0, 300) })));
    console.log(await run(ana, () => JSON.stringify({ dlg: window.doodleduo.S.dlg, links: window.doodleduo.session().mesh?.links.size })));
    throw err;
  });
  log('the live cursor of Ana shows on the screen of Bia');

  await Promise.all([stroke(ana, 200, 520), stroke(bia, 260, 560, -1), run(ana, () => window.doodleduo.edit('move', 15)), run(bia, () => window.doodleduo.edit('color', 15))]);
  log('Ana and Bia drew and edited the same elements at the same time');
  await converge([ana, bia], 'two people at once');

  const caio = await person('Caio');
  await pair(bia, caio);
  log('Caio joined late through Bia');
  await caio.page.waitForFunction(() => window.doodleduo.S.people.length === 3, null, { timeout: 45000 });
  await converge([ana, bia, caio], 'late joiner');
  ok(await hasPicture(caio), 'Caio received the picture');
  log('Caio received the whole board, the picture too');

  await Promise.all([
    stroke(ana, 500, 300),
    stroke(bia, 520, 340, -1),
    stroke(caio, 540, 380),
    run(ana, () => window.doodleduo.edit('move', 20)),
    run(bia, () => window.doodleduo.edit('color', 20)),
    run(caio, () => window.doodleduo.edit('create', 10)),
    run(caio, () => window.doodleduo.edit('delete', 3)),
  ]);
  log('three people drew and edited at the same time');
  const total = await converge([ana, bia, caio], 'three people at once');
  ok(total > 8, 'the board has the elements of everyone');

  await run(caio, () => window.doodleduo.undo());
  await run(caio, () => window.doodleduo.undo());
  await converge([ana, bia, caio], 'after Caio undid two steps');

  const [png] = await Promise.all([ana.page.waitForEvent('download'), run(ana, () => window.doodleduo.S && document.querySelector('#export-png').click())]);
  ok((await png.suggestedFilename()).endsWith('.png'), 'PNG export downloads');
  const [svg] = await Promise.all([ana.page.waitForEvent('download'), run(ana, () => document.querySelector('#export-svg').click())]);
  ok((await svg.suggestedFilename()).endsWith('.svg'), 'SVG export downloads');
  const [file] = await Promise.all([ana.page.waitForEvent('download'), run(ana, () => document.querySelector('#export-file').click())]);
  ok((await file.suggestedFilename()).endsWith('.doodleduo'), 'board file downloads');
  log('PNG, SVG and the board file export');

  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  log('no console errors');
  console.log('e2e: all checks passed');
} catch (err) {
  console.error(err.stack || err.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await Promise.all(people.map((p) => Promise.race([p.context.close(), new Promise((r) => setTimeout(r, 15000))])));
  server.closeAllConnections?.();
  server.close();
  process.exit(process.exitCode || 0);
}

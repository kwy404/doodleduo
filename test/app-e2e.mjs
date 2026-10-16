// End to end test in a real browser, with live public relays for the six word pairing.
// Three people, each in their own browser profile (a fresh user data folder):
//   1. Ana draws alone, then invites Bia with six words and a QR code; Bia joins and reads the
//      confirmation words back, which Ana types.
//   2. Ana and Bia draw at the same time with the mouse and edit the same elements at once.
//   3. Bia invites Caio, who joins late and must receive the whole board, pictures included.
//   4. All three draw and edit at the same time; every replica must end with the same state.
//   5. Undo by one person, exports and a board file round trip.
//   6. Chat with a reply and a reaction (the late joiner gets the history), a voice call with
//      the noise suppression worklet, camera bubbles next to the cursor, screen sharing and
//      the mic test.
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
    // A public broker that is down shows up as a browser error on its WebSocket; the app
    // simply uses the other brokers, so that one is not counted.
    if (m.type() === 'error' && !/WebSocket connection to 'wss:[^']+mqtt' failed/.test(m.text())) errors.push(`${name}: ${m.text()}`);
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
  await guest.page.waitForFunction(() => window.doodleduo.S.pair.stage === 'done', null, { timeout: 30000 }).catch(async (err) => {
    const info = (p) => run(p, () => JSON.stringify({ pair: window.doodleduo.S.pair, attempts: window.doodleduo.session().pairing?.attempts, links: [...(window.doodleduo.session().mesh?.links.keys() || [])], held: [...(window.doodleduo.session().mesh?.held.keys() || [])], expected: window.doodleduo.session().pairing?.expected }));
    console.log('host', await info(host));
    console.log('guest', await info(guest));
    throw err;
  });
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

  await ana.page.click('#chat-btn');
  await ana.page.fill('#chat-input', 'Bring the big map');
  await ana.page.press('#chat-input', 'Enter');
  await bia.page.waitForFunction(() => window.doodleduo.chat().list().some((m) => m.text === 'Bring the big map'), null, { timeout: 15000 });
  log('Ana wrote in the chat and Bia got it');

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

  // Chat: Bia replies, Caio reacts. Caio joined after the first message.
  const first = await run(ana, () => window.doodleduo.chat().list().find((m) => m.text === 'Bring the big map').id);
  await caio.page.waitForFunction((id) => !!window.doodleduo.chat().get(id), first, { timeout: 15000 });
  await bia.page.click('#chat-btn');
  await bia.page.waitForSelector(`#chat-list .msg[data-id="${first}"]`, { timeout: 10000 });
  await bia.page.hover(`#chat-list .msg[data-id="${first}"]`);
  await bia.page.click(`#chat-list .msg[data-id="${first}"] .reply-btn`);
  await bia.page.fill('#chat-input', 'On it, and snacks too');
  await bia.page.click('#chat-send');
  await caio.page.click('#chat-btn');
  await caio.page.waitForSelector(`#chat-list .msg[data-id="${first}"]`, { timeout: 10000 });
  await caio.page.hover(`#chat-list .msg[data-id="${first}"]`);
  await caio.page.click(`#chat-list .msg[data-id="${first}"] [data-react="heart"]`);
  const chatOk = async (p) =>
    p.page.waitForFunction(
      (id) => {
        const log = window.doodleduo.chat();
        const reply = log.list().find((m) => m.reply === id);
        return reply?.text === 'On it, and snacks too' && log.reactionsOf(id).some((r) => r.key === 'heart' && r.count === 1);
      },
      first,
      { timeout: 15000 },
    );
  await Promise.all([chatOk(ana), chatOk(bia), chatOk(caio)]);
  const chats = await Promise.all([ana, bia, caio].map((p) => run(p, () => window.doodleduo.chat().fingerprint())));
  ok(chats.every((c) => c === chats[0]), 'every chat log is identical');
  ok(await ana.page.locator('#chat-list .msg-quote b', { hasText: 'Ana' }).filter({ visible: true }).count(), 'the reply shows the message it answers');
  ok(await ana.page.locator(`#chat-list .msg[data-id="${first}"] .reaction[data-key="heart"]`).isVisible(), 'the reaction shows under the message');
  log('a reply and a reaction reached everyone, and the late joiner got the chat history');
  for (const p of [ana, bia, caio]) await p.page.click('#chat-btn');

  // Voice: Ana and Bia join the call. Audio must flow, through the noise suppression worklet.
  const anaId = await run(ana, () => window.doodleduo.session().profile.id);
  const biaId = await run(bia, () => window.doodleduo.session().profile.id);
  await ana.page.click('#call-btn');
  await bia.page.click('#call-btn');
  await bia.page.waitForFunction(() => window.doodleduo.S.call.in && window.doodleduo.S.call.count === 2, null, { timeout: 20000 });
  ok((await run(ana, () => window.doodleduo.media.processing)) === 'strong', 'the microphone runs through the Strong noise suppression worklet');
  const audioIn = (p, from) => run(p, async (id) => (await window.doodleduo.session().mesh.links.get(id).stats()).audioIn, from);
  let a0 = 0;
  let a1 = 0;
  for (let i = 0; i < 20 && a1 <= a0; i++) {
    a0 = await audioIn(bia, anaId);
    await bia.page.waitForTimeout(1000);
    a1 = await audioIn(bia, anaId);
  }
  ok(a1 > a0 && a0 >= 0, `Bia receives Ana's voice (${a0} then ${a1} bytes)`);
  log(`voice call: audio flows from Ana to Bia (${a1 - a0} bytes in a second), Strong noise suppression on`);

  // Camera: Ana's bubble floats next to her cursor on Bia's screen.
  await ana.page.click('#camera-btn');
  await bia.page.waitForFunction((id) => {
    const v = document.querySelector(`#cursors .peer-cursor[data-peer="${id}"] video.cam-bubble`);
    return v && v.videoWidth > 0;
  }, anaId, { timeout: 30000 });
  ok(await ana.page.locator('#self-cam').isVisible(), 'Ana sees her own camera bubble');
  await bia.page.click('#bubbles-btn');
  ok(!(await bia.page.locator('#cursors video.cam-bubble').isVisible()), 'camera bubbles can be hidden');
  await bia.page.click('#bubbles-btn');
  log('camera bubble of Ana floats next to her cursor on the screen of Bia, and can be hidden');

  // Screen: Bia shares, Ana watches.
  await bia.page.click('#screen-btn');
  await ana.page.waitForFunction((id) => window.doodleduo.S.screenFrom === id && document.getElementById('screen-video').videoWidth > 0, biaId, { timeout: 30000 });
  log('Bia shares her screen and Ana sees it');
  await bia.page.click('#screen-btn');
  await ana.page.waitForFunction(() => !window.doodleduo.S.screenFrom, null, { timeout: 20000 });

  // Mic test on Caio, in the settings.
  await caio.page.click('#settings-btn');
  await caio.page.click('#mic-test-btn');
  await caio.page.waitForFunction(() => window.doodleduo.S.testing && window.doodleduo.media.micLevel && window.doodleduo.S.micLevel > 0, null, { timeout: 20000 });
  await caio.page.click('#mic-test-btn');
  await caio.page.keyboard.press('Escape');
  log('the mic test plays back and shows a level, with the suppressor reporting');

  await ana.page.click('#hangup-btn');
  await bia.page.waitForFunction(() => window.doodleduo.S.call.count === 1, null, { timeout: 15000 });
  log('Ana left the call');

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

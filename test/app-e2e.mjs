// End to end test in a real browser, with live public relays for the six word pairing.
// Two people, each in their own browser profile (a fresh user data folder) with fake devices:
//   0. Ana works alone with the context menu: right click on the empty board and on a note,
//      keys and a submenu, copy and paste, group, send to back, lock, Shift+F10, a long press
//      with a finger, and placement in the bottom right corner.
//   1. Ana draws alone, then invites Bia. The invite shows six words, a QR code and a link; the
//      test checks that all three carry the same words.
//   2. Bia joins three times, once each way, and lands in the same room every time: by opening
//      the invite link (the hash is cleared), by putting the whole phrase into the first box
//      (it spreads one word per box), and by the link decoded from the QR code. Each time she
//      reads the confirmation words back, which Ana types.
//   3. Ana and Bia draw and edit the same elements at once; both replicas must end identical.
//   4. Undo, chat with a reply and a reaction (and the menu of a message), a voice call (and
//      the menu of a call member) through the noise suppression
//      worklet, mute, the microphone and camera pickers, camera bubbles next to the cursor,
//      camera off, screen sharing, the mic test and the exports.
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
  // Keep Copy away from the system clipboard, which headless browsers on one machine share:
  // remember what the page copied instead.
  await context.addInitScript(() => {
    if (navigator.clipboard) navigator.clipboard.writeText = async (text) => void (window.copiedText = String(text));
  });
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

// Ana opens an invite. Returns the six words, the invite link and the link read back from the
// QR code (rendered to a canvas in the page and decoded with jsQR).
async function openInvite(host) {
  await host.page.click('#invite-btn');
  await host.page.waitForFunction(() => window.doodleduo.S.pair.stage === 'waiting' && document.querySelector('#invite-words')?.dataset.words?.split(' ').length === 6 && document.querySelector('#invite-link')?.value, null, { timeout: 90000, polling: 250 });
  const words = (await host.page.getAttribute('#invite-words', 'data-words')).split(' ');
  const link = await host.page.inputValue('#invite-link');
  ok(link === `${base}#join=${words.join('-')}`, `the invite link carries the six words in its hash (${link})`);
  ok(await host.page.locator('#invite-dialog .qr svg').count(), 'the invite shows a QR code');
  await host.page.addScriptTag({ path: 'node_modules/jsqr/dist/jsQR.js' });
  const qr = await run(host, async () => {
    const svg = document.querySelector('#invite-dialog .qr svg');
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 600, 600);
    ctx.drawImage(img, 0, 0, 600, 600);
    const data = ctx.getImageData(0, 0, 600, 600);
    return window.jsQR(data.data, 600, 600)?.data || '';
  });
  ok(qr === link, `the QR code decodes to the invite link (${qr})`);
  await run(host, () => (window.copiedText = ''));
  await host.page.click('#invite-copy');
  await host.page.waitForFunction(() => window.copiedText && window.doodleduo.S.pair.copied, null, { timeout: 5000 });
  const copied = await run(host, () => window.copiedText);
  ok(copied === link, `Copy puts the invite link on the clipboard (${copied})`);
  return { words, link, qr };
}

// The guest started joining (by link, words or QR): read the confirmation words back to Ana.
async function confirmPair(host, guest) {
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
  await guest.page.waitForFunction(() => window.doodleduo.S.people.length === 2 && !window.doodleduo.S.dlg, null, { timeout: 30000 });
  await host.page.waitForFunction(() => !window.doodleduo.S.dlg, null, { timeout: 10000 });
  const boards = await Promise.all([host, guest].map((p) => run(p, () => window.doodleduo.session().meta.id)));
  ok(boards[0] === boards[1], `both are in the same room (${boards.join(' and ')})`);
}

// Opens a link in a fresh page load, the way a tap on a shared link or a scanned QR code does.
async function openLink(guest, link) {
  await guest.page.goto('about:blank');
  await guest.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await guest.page.waitForFunction(() => window.doodleduo?.S.ready, null, { timeout: 60000 });
  await guest.page.waitForFunction(() => !location.hash, null, { timeout: 10000 });
}

// The guest leaves the room, and Ana sees it.
async function leave(host, guest) {
  await run(guest, () => window.doodleduo.leave());
  await host.page.waitForFunction(() => window.doodleduo.S.people.length === 1, null, { timeout: 30000 });
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
  await ana.page.waitForFunction(() => window.doodleduo.view().list.some((e) => e.type === 'image'), null, { timeout: 45000 });
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

  // Context menu on the board, alone: right click, keys, submenus, long press, edges.
  const menuOn = (p) => p.page.waitForSelector('.cmenu.is-open[role="menu"]', { timeout: 5000 });
  const menuGone = (p) => p.page.waitForSelector('.cmenu', { state: 'detached', timeout: 5000 });
  const pick = async (p, cmd) => {
    await p.page.click(`.cmenu [data-cmd="${cmd}"]`);
    await menuGone(p);
  };
  const notes = (p) => run(p, () => window.doodleduo.view().list.filter((e) => e.type === 'note').map((e) => ({ id: e.id, color: e.color, z: e.z, x: e.x, y: e.y, lock: !!e.lock, grp: e.grp || '', text: e.text })));
  const centerOf = (p, id) =>
    run(p, (id2) => {
      const v = window.doodleduo.view();
      const el = v.list.find((e) => e.id === id2);
      const r = v.canvas.getBoundingClientRect();
      const [x, y] = v.toScreen(el.x + el.w / 2, el.y + el.h / 2);
      return [r.left + x, r.top + y];
    }, id);
  const inside = (p, sel) => run(p, (s) => [...document.querySelectorAll(s)].every((m) => {
    const r = m.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0;
  }), sel);

  await ana.page.click('[data-tool="select"]');
  await run(ana, () => {
    const v = window.doodleduo.view();
    v.cam = { ...v.cam, x: v.cam.x + 6000 };
    v.dirty(true);
  });
  await ana.page.mouse.click(640, 420, { button: 'right' });
  await menuOn(ana);
  const boardCmds = await ana.page.$$eval('.cmenu [role="menuitem"]', (n) => n.map((x) => x.dataset.cmd));
  ok(['paste', 'add-note', 'add-text', 'fit'].every((c) => boardCmds.includes(c)), `the board menu has paste, sticky note, text and zoom to fit (${boardCmds.join(', ')})`);
  await pick(ana, 'add-note');
  await ana.page.waitForFunction(() => document.activeElement?.id === 'text-editor', null, { timeout: 5000 });
  await ana.page.keyboard.type('Plan');
  await ana.page.keyboard.press('Escape');
  const [note] = await notes(ana);
  ok(note?.text === 'Plan', 'Add a sticky note puts a note where the menu opened');
  log(`right click on the empty board: ${boardCmds.length} items, and "Add a sticky note" made a note there`);

  // Keys: type to jump to Color, open its submenu with the right arrow, pick with Enter.
  const [nx, ny] = await centerOf(ana, note.id);
  await ana.page.mouse.click(nx, ny, { button: 'right' });
  await menuOn(ana);
  const elCmds = await ana.page.$$eval('.cmenu [role="menuitem"]', (n) => n.map((x) => x.dataset.cmd));
  ok(['copy', 'duplicate', 'delete', 'front', 'back', 'lock', 'color', 'group'].every((c) => elCmds.includes(c)), `the element menu has every action (${elCmds.join(', ')})`);
  await ana.page.keyboard.type('col');
  ok((await run(ana, () => document.activeElement?.dataset.cmd)) === 'color', 'typing letters jumps to Color');
  await ana.page.keyboard.press('ArrowRight');
  await ana.page.waitForFunction(() => document.querySelectorAll('.cmenu').length === 2 && document.activeElement?.closest('.cmenu') === document.querySelectorAll('.cmenu')[1], null, { timeout: 5000 });
  ok((await run(ana, () => document.querySelector('[data-cmd="color"]').getAttribute('aria-expanded'))) === 'true', 'the Color item says its submenu is open');
  await ana.page.keyboard.press('ArrowLeft');
  ok((await run(ana, () => document.querySelectorAll('.cmenu').length === 1 && document.activeElement?.dataset.cmd === 'color')), 'the left arrow closes the submenu and goes back to Color');
  await ana.page.keyboard.press('ArrowRight');
  await ana.page.keyboard.press('ArrowDown');
  await ana.page.keyboard.press('Enter');
  await menuGone(ana);
  const recolored = (await notes(ana)).find((n) => n.id === note.id);
  ok(recolored.color !== note.color, `the color submenu recolors the note (${note.color} to ${recolored.color})`);
  log('keys: letters jump to Color, the right arrow opens its submenu, the left arrow closes it, Enter picks a color');

  // Copy, then paste on the empty board.
  await ana.page.mouse.click(nx, ny, { button: 'right' });
  await menuOn(ana);
  await pick(ana, 'copy');
  await ana.page.mouse.click(300, 600, { button: 'right' });
  await menuOn(ana);
  await pick(ana, 'paste');
  ok((await notes(ana)).length === 2, 'Paste here adds a copy of the note');
  log('Copy on the note and Paste here on the empty board made a second note');

  // Group: select both notes, group them, then one click selects both.
  await run(ana, () => {
    const v = window.doodleduo.view();
    const ids = v.list.filter((e) => e.type === 'note').map((e) => e.id);
    window.doodleduo.select(ids);
  });
  await ana.page.mouse.click(nx, ny, { button: 'right' });
  await menuOn(ana);
  await pick(ana, 'group');
  const grouped = await notes(ana);
  ok(grouped[0].grp && grouped.every((n) => n.grp === grouped[0].grp), 'Group gives both notes one group');
  await ana.page.mouse.click(900, 200);
  await ana.page.mouse.click(nx, ny);
  ok((await run(ana, () => window.doodleduo.S.selected)) === 2, 'a click on one grouped note selects the group');
  await ana.page.mouse.click(nx, ny, { button: 'right' });
  await menuOn(ana);
  await pick(ana, 'ungroup');
  ok((await notes(ana)).every((n) => !n.grp), 'Ungroup clears the group');
  log('Group, a click that selects the whole group, and Ungroup');

  // Send to back, then lock: a locked note does not move or erase, and unlocks from the menu.
  await ana.page.mouse.click(900, 200);
  await ana.page.mouse.click(nx, ny, { button: 'right' });
  await menuOn(ana);
  await pick(ana, 'back');
  const lowest = await run(ana, () => Math.min(...window.doodleduo.view().list.map((e) => e.z ?? 0)));
  ok((await notes(ana)).find((n) => n.id === note.id).z === lowest, 'Send to back puts the note below everything');
  await ana.page.mouse.click(nx, ny, { button: 'right' });
  await menuOn(ana);
  await pick(ana, 'lock');
  const before = (await notes(ana)).find((n) => n.id === note.id);
  await ana.page.mouse.move(nx, ny);
  await ana.page.mouse.down();
  await ana.page.mouse.move(nx + 120, ny + 60, { steps: 6 });
  await ana.page.mouse.up();
  await ana.page.click('[data-tool="eraser"]');
  await ana.page.mouse.move(nx - 30, ny);
  await ana.page.mouse.down();
  await ana.page.mouse.move(nx + 30, ny, { steps: 6 });
  await ana.page.mouse.up();
  await ana.page.click('[data-tool="select"]');
  const after = (await notes(ana)).find((n) => n.id === note.id);
  ok(after && after.lock && after.x === before.x && after.y === before.y, 'a locked note neither moves nor erases');
  await ana.page.mouse.click(nx, ny, { button: 'right' });
  await menuOn(ana);
  const lockedCmds = await ana.page.$$eval('.cmenu [role="menuitem"]', (n) => n.map((x) => x.dataset.cmd));
  ok(lockedCmds[0] === 'unlock' && !lockedCmds.includes('delete'), 'a locked note offers Unlock first and no Delete');
  await pick(ana, 'unlock');
  ok(!(await notes(ana)).find((n) => n.id === note.id).lock, 'Unlock frees the note');
  log('Send to back; a locked note stayed put under a drag and the eraser, then Unlock freed it');

  // Escape gives focus back; Shift+F10 opens on the selection with the first item focused.
  await ana.page.mouse.click(nx, ny);
  await run(ana, () => document.querySelector('[data-tool="select"]').focus());
  const focusBefore = await run(ana, () => document.activeElement?.dataset.tool || document.activeElement?.id);
  await ana.page.keyboard.press('Shift+F10');
  await menuOn(ana);
  ok((await run(ana, () => document.activeElement?.getAttribute('role'))) === 'menuitem', 'Shift+F10 focuses the first item');
  await ana.page.keyboard.press('Escape');
  await menuGone(ana);
  ok((await run(ana, () => document.activeElement?.dataset.tool || document.activeElement?.id)) === focusBefore, 'Escape closes the menu and gives the focus back');
  log('Shift+F10 opens the menu on the selection with the first item focused, and Escape returns the focus');

  // Long press with a finger.
  await run(ana, async ([x, y]) => {
    const c = document.getElementById('board');
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
    await new Promise((r) => setTimeout(r, 750));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
  }, [nx, ny]);
  await menuOn(ana);
  ok((await ana.page.$$eval('.cmenu [role="menuitem"]', (n) => n.map((x) => x.dataset.cmd))).includes('lock'), 'a long press opens the element menu');
  await ana.page.keyboard.press('Escape');
  log('a long press with a finger opens the same menu');

  // Edges: open in the bottom right corner, then the color submenu; both stay on screen.
  await run(ana, ([x, y]) => {
    const v = window.doodleduo.view();
    const el = v.list.find((e) => e.type === 'note');
    const r = v.canvas.getBoundingClientRect();
    v.cam = { ...v.cam, x: el.x + el.w / 2 - (x - r.left) / v.cam.z, y: el.y + el.h / 2 - (y - r.top) / v.cam.z };
    v.dirty(true);
  }, [1250, 640]);
  ok((await run(ana, () => document.elementFromPoint(1250, 640)?.id)) === 'board', 'the corner point is on the board');
  await ana.page.mouse.click(1250, 640, { button: 'right' });
  await menuOn(ana);
  await ana.page.hover('.cmenu [data-cmd="color"]');
  await ana.page.waitForFunction(() => document.querySelectorAll('.cmenu.is-open').length === 2, null, { timeout: 5000 });
  ok(await inside(ana, '.cmenu'), 'the menu and its submenu stay inside the viewport in the corner');
  ok((await run(ana, () => document.querySelectorAll('.cmenu')[1].dataset.side)) === 'left', 'the submenu flips to the left at the right edge');
  await ana.page.keyboard.press('Escape');
  await ana.page.keyboard.press('Escape');
  await menuGone(ana);
  await run(ana, () => window.doodleduo.view().fit());
  log('in the bottom right corner the menu flips up and left and its submenu opens to the left, all on screen');

  // Way 1: the invite link, opened in a fresh page load.
  const first = await openInvite(ana);
  log('the invite shows six words, a QR code and a link with Copy, all with the same words');
  await openLink(bia, first.link);
  log('Bia opened the invite link: the words left the address bar and the join started');
  await confirmPair(ana, bia);
  log('Bia joined by the link and the confirmation words matched');
  await converge([ana, bia], 'after joining by the link');
  const hasPicture = (p) =>
    run(p, async () => {
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

  // Way 2: the six words, pasted as one phrase into the first box.
  await leave(ana, bia);
  await stroke(ana, 260, 420);
  const second = await openInvite(ana);
  ok(second.words.join(' ') !== first.words.join(' '), 'every invite has new words');
  await bia.page.click('#join-btn');
  await bia.page.fill('#join-word-0', second.words.join(' '));
  const boxes = await Promise.all(second.words.map((_, i) => bia.page.inputValue(`#join-word-${i}`)));
  ok(boxes.join(' ') === second.words.join(' '), `the phrase spreads one word per box (${boxes.join(' | ')})`);
  log('the whole phrase put into the first box spread one word per box and the join started');
  await confirmPair(ana, bia);
  await converge([ana, bia], 'after joining by the words');
  log('Bia joined the same room again by the six words');

  // Way 3: the QR code, decoded to the link a phone camera would open.
  await leave(ana, bia);
  await run(ana, () => window.doodleduo.edit('create', 2));
  const third = await openInvite(ana);
  await openLink(bia, third.qr);
  await confirmPair(ana, bia);
  await converge([ana, bia], 'after joining by the QR code');
  log('Bia joined the same room a third time from the QR code');

  // Cursors: Ana's pointer shows on Bia's screen.
  await ana.page.mouse.move(700, 420);
  await ana.page.mouse.move(720, 430);
  for (let i = 0; i < 10; i++) await ana.page.mouse.move(700 + i * 4, 420 + i * 2);
  await bia.page.waitForSelector('#cursors .peer-cursor', { timeout: 10000 });
  log('the live cursor of Ana shows on the screen of Bia');

  await Promise.all([stroke(ana, 200, 520), stroke(bia, 260, 560, -1), run(ana, () => window.doodleduo.edit('move', 15)), run(bia, () => window.doodleduo.edit('color', 15)), run(bia, () => window.doodleduo.edit('delete', 2))]);
  log('Ana and Bia drew and edited the same elements at the same time');
  const total = await converge([ana, bia], 'two people at once');
  ok(total > 6, 'the board has the elements of both');
  await run(bia, () => window.doodleduo.undo());
  await run(bia, () => window.doodleduo.undo());
  await converge([ana, bia], 'after Bia undid two steps');

  // Chat: Ana writes, Bia replies, Ana reacts.
  await ana.page.click('#chat-btn');
  await ana.page.fill('#chat-input', 'Bring the big map');
  await ana.page.press('#chat-input', 'Enter');
  await bia.page.waitForFunction(() => window.doodleduo.chat().list().some((m) => m.text === 'Bring the big map'), null, { timeout: 15000 });
  const firstMsg = await run(ana, () => window.doodleduo.chat().list().find((m) => m.text === 'Bring the big map').id);
  await bia.page.click('#chat-btn');
  await bia.page.waitForSelector(`#chat-list .msg[data-id="${firstMsg}"]`, { timeout: 10000 });
  await bia.page.hover(`#chat-list .msg[data-id="${firstMsg}"]`);
  await bia.page.click(`#chat-list .msg[data-id="${firstMsg}"] .reply-btn`);
  await bia.page.fill('#chat-input', 'On it, and snacks too');
  await bia.page.click('#chat-send');
  await ana.page.waitForFunction((id) => window.doodleduo.chat().list().some((m) => m.reply === id), firstMsg, { timeout: 15000 });
  await ana.page.hover(`#chat-list .msg[data-id="${firstMsg}"]`);
  await ana.page.click(`#chat-list .msg[data-id="${firstMsg}"] [data-react="heart"]`);
  const chatOk = (p) =>
    p.page.waitForFunction(
      (id) => {
        const log = window.doodleduo.chat();
        const reply = log.list().find((m) => m.reply === id);
        return reply?.text === 'On it, and snacks too' && log.reactionsOf(id).some((r) => r.key === 'heart' && r.count === 1);
      },
      firstMsg,
      { timeout: 15000 },
    );
  await Promise.all([chatOk(ana), chatOk(bia)]);
  const chats = await Promise.all([ana, bia].map((p) => run(p, () => window.doodleduo.chat().fingerprint())));
  ok(chats[0] === chats[1], 'both chat logs are identical');
  ok(await ana.page.locator('#chat-list .msg-quote b', { hasText: 'Ana' }).filter({ visible: true }).count(), 'the reply shows the message it answers');
  ok(await bia.page.locator(`#chat-list .msg[data-id="${firstMsg}"] .reaction[data-key="heart"]`).isVisible(), 'the reaction shows under the message');
  log('a message, a reply and a reaction reached both');

  // The menu of a chat message: React in a submenu, by right click.
  await bia.page.click(`#chat-list .msg[data-id="${firstMsg}"] .msg-text`, { button: 'right' });
  await menuOn(bia);
  ok((await bia.page.$$eval('.cmenu [role="menuitem"]', (n) => n.map((x) => x.dataset.cmd))).join(',') === 'reply,react,copy-text', 'a chat message offers Reply, React and Copy the text');
  await bia.page.hover('.cmenu [data-cmd="react"]');
  await bia.page.waitForSelector('.cmenu [data-cmd="react-laugh"]', { timeout: 5000 });
  await pick(bia, 'react-laugh');
  await ana.page.waitForFunction((id) => window.doodleduo.chat().reactionsOf(id).some((r) => r.key === 'laugh' && r.count === 1), firstMsg, { timeout: 15000 });
  log('the menu of a chat message reacted with a laugh, and Ana got it');
  for (const p of [ana, bia]) await p.page.click('#chat-btn');

  // Voice: Ana and Bia join the call. Audio must flow, through the noise suppression worklet.
  const anaId = await run(ana, () => window.doodleduo.session().profile.id);
  const biaId = await run(bia, () => window.doodleduo.session().profile.id);
  await ana.page.click('#call-btn');
  await bia.page.click('#call-btn');
  await bia.page.waitForFunction(() => window.doodleduo.S.call.in && window.doodleduo.S.call.count === 2, null, { timeout: 20000 });
  ok((await run(ana, () => window.doodleduo.media.processing)) === 'strong', 'the microphone runs through the Strong noise suppression worklet');
  const audioIn = (p, from) => run(p, async (id) => (await window.doodleduo.session().mesh.links.get(id).stats()).audioIn, from);
  const flowing = async () => {
    let a0 = 0;
    let a1 = 0;
    for (let i = 0; i < 20 && a1 <= a0; i++) {
      a0 = await audioIn(bia, anaId);
      await bia.page.waitForTimeout(1000);
      a1 = await audioIn(bia, anaId);
    }
    return a1 - a0;
  };
  let bytes = await flowing();
  ok(bytes > 0, `Bia receives Ana's voice (${bytes} bytes in a second)`);
  log(`voice call: audio flows from Ana to Bia (${bytes} bytes in a second), Strong noise suppression on`);

  // The menu of a call member: Mute for me on Bia's side only.
  await bia.page.click(`.people .person[data-peer="${anaId}"]`, { button: 'right' });
  await menuOn(bia);
  await pick(bia, 'mute-for-me');
  const silenced = () => run(bia, (id) => [...window.doodleduo.media.remote.get(id).audio.values()].map((a) => a.muted), anaId);
  ok((await silenced()).every(Boolean), 'Mute for me silences Ana on the device of Bia');
  ok(!(await run(ana, () => window.doodleduo.media.muted)), 'Ana herself is not muted');
  await bia.page.click(`.people .person[data-peer="${anaId}"]`, { button: 'right' });
  await menuOn(bia);
  await pick(bia, 'mute-for-me');
  ok((await silenced()).every((m) => !m), 'Unmute for me brings Ana back');
  log('the menu of a call member muted Ana for Bia only, then unmuted her');

  // Mute: the track goes off, Bia sees it, and unmute brings it back.
  await ana.page.click('#mute-btn');
  await bia.page.waitForSelector(`.people .person.is-muted[data-peer="${anaId}"]`, { timeout: 15000 });
  ok((await run(ana, (id) => window.doodleduo.session().mesh.links.get(id).senders.mic?.track?.enabled, biaId)) === false, 'the muted microphone track is off');
  await ana.page.click('#mute-btn');
  await bia.page.waitForSelector(`.people .person.is-muted[data-peer="${anaId}"]`, { state: 'detached', timeout: 15000 });
  ok((await run(ana, (id) => window.doodleduo.session().mesh.links.get(id).senders.mic?.track?.enabled, biaId)) === true, 'the microphone track is back on');
  log('Ana muted (Bia saw it) and unmuted');

  // Microphone picker: switch to another fake microphone during the call.
  await ana.page.click('#settings-btn');
  await ana.page.waitForFunction(() => document.querySelectorAll('#mic-select option').length > 1, null, { timeout: 15000 });
  const mics = await ana.page.$$eval('#mic-select option', (o) => o.map((x) => ({ id: x.value, label: x.textContent })).filter((x) => x.id));
  const micBefore = await run(ana, () => window.doodleduo.media.micDevice);
  const micPick = mics.find((m) => m.id !== micBefore && m.id !== 'default') || mics[0];
  await ana.page.selectOption('#mic-select', micPick.id);
  await ana.page.waitForFunction((id) => window.doodleduo.media.micDevice === id, micPick.id, { timeout: 15000 });
  bytes = await flowing();
  ok(bytes > 0, 'the voice still flows after the microphone change');
  log(`microphone picker: ${mics.length} microphones listed, switched to "${micPick.label}" and the voice still flows`);
  await ana.page.keyboard.press('Escape');

  // Camera: Ana's bubble floats next to her cursor on Bia's screen.
  await ana.page.click('#camera-btn');
  const bubble = () =>
    bia.page.waitForFunction(
      (id) => {
        const v = document.querySelector(`#cursors .peer-cursor[data-peer="${id}"] video.cam-bubble`);
        return v && v.videoWidth > 0;
      },
      anaId,
      { timeout: 30000 },
    );
  await bubble();
  ok(await ana.page.locator('#self-cam').isVisible(), 'Ana sees her own camera bubble');
  await bia.page.click('#bubbles-btn');
  ok(!(await bia.page.locator('#cursors video.cam-bubble').isVisible()), 'camera bubbles can be hidden');
  await bia.page.click('#bubbles-btn');
  log('camera bubble of Ana floats next to her cursor on the screen of Bia, and can be hidden');

  // Camera picker: switch cameras while the camera is on.
  await ana.page.click('#settings-btn');
  await ana.page.waitForFunction(() => document.querySelectorAll('#cam-select option').length > 1, null, { timeout: 15000 });
  const cams = await ana.page.$$eval('#cam-select option', (o) => o.map((x) => ({ id: x.value, label: x.textContent })).filter((x) => x.id));
  const camBefore = await run(ana, () => window.doodleduo.media.camDevice);
  const camPick = cams.find((c) => c.id !== camBefore) || cams[0];
  await ana.page.selectOption('#cam-select', camPick.id);
  await ana.page.waitForFunction((id) => window.doodleduo.media.camDevice === id, camPick.id, { timeout: 15000 });
  await ana.page.keyboard.press('Escape');
  await bubble();
  log(`camera picker: ${cams.length} cameras listed, switched to "${camPick.label}" and Bia still sees the bubble`);

  // Camera off: the bubble leaves Bia's screen.
  await ana.page.click('#camera-btn');
  await bia.page.waitForFunction((id) => !document.querySelector(`#cursors .peer-cursor[data-peer="${id}"] video.cam-bubble`), anaId, { timeout: 20000 });
  ok(!(await ana.page.locator('#self-cam').isVisible()), 'Ana no longer sees her own camera');
  log('Ana turned the camera off and her bubble left the screen of Bia');

  // Screen: Bia shares, Ana watches.
  await bia.page.click('#screen-btn');
  await ana.page.waitForFunction((id) => window.doodleduo.S.screenFrom === id && document.getElementById('screen-video').videoWidth > 0, biaId, { timeout: 30000 });
  log('Bia shares her screen and Ana sees it');
  await bia.page.click('#screen-btn');
  await ana.page.waitForFunction(() => !window.doodleduo.S.screenFrom, null, { timeout: 20000 });

  await ana.page.click('#hangup-btn');
  await bia.page.waitForFunction(() => window.doodleduo.S.call.count === 1, null, { timeout: 15000 });
  log('Ana left the call');

  // Mic test on Bia, in the settings.
  await bia.page.click('#settings-btn');
  await bia.page.click('#mic-test-btn');
  await bia.page.waitForFunction(() => window.doodleduo.S.testing && window.doodleduo.media.micLevel && window.doodleduo.S.micLevel > 0, null, { timeout: 20000 });
  await bia.page.click('#mic-test-btn');
  await bia.page.keyboard.press('Escape');
  log('the mic test plays back and shows a level, with the suppressor reporting');

  const [png] = await Promise.all([ana.page.waitForEvent('download'), run(ana, () => document.querySelector('#export-png').click())]);
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

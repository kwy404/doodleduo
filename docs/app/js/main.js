// doodleduo app: the state the interface shows (a Voodoo.js reactive store), the board on the
// canvas, the tools, pairing, boards saved in this browser and the exports. Voodoo is loaded
// with data-manual: this module publishes the store and the actions on V.config.globals and
// then calls V.start(), so the markup in index.html declares what it shows.

import { THEMES, INKS, NOTES, NOTE_FS, measureText } from '../core/shapes.js';
import { probeAllStun, parseTurn } from '../core/rtc.js';
import { randomId } from '../core/crypto.js';
import { resolvePhrase, wordsFromLink } from '../core/words.js';
import { STROKE_TYPES } from '../core/crdt.js';
import { FILE_EXTENSION } from '../core/format.js';
import { Gesture, Input, View } from './canvas.js';
import { Session, MAX_MEMBERS } from './session.js';
import { wordInputs } from './words-ui.js';
import { bindStore, detectLang, t } from './i18n.js';
import * as db from './db.js';
import * as images from './images.js';
import * as exporter from './exporter.js';

const V = window.V;
const $ = (s) => document.querySelector(s);
const PEOPLE_COLORS = ['#9fb4c9', '#c9a3a6', '#a9bf9f', '#d8c08f', '#b5a8cc'];
const TOOLS = { v: 'select', h: 'hand', p: 'pen', m: 'hl', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', t: 'text', n: 'note' };

// ---------- Preferences ----------

const pref = (k, d) => {
  try {
    const v = localStorage.getItem(`doodleduo:${k}`);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const setPref = (k, v) => {
  try {
    localStorage.setItem(`doodleduo:${k}`, JSON.stringify(v));
  } catch {
    // private mode: preferences last for this visit only
  }
};

const S = V.reactive({
  ready: false,
  lang: pref('lang', detectLang()),
  theme: pref('theme', 'dark'),
  name: pref('name', ''),
  me: pref('color', PEOPLE_COLORS[Math.floor(Math.random() * PEOPLE_COLORS.length)]),
  tool: 'pen',
  color: 'ink',
  size: pref('size', 4),
  fill: false,
  note: NOTES[0],
  shapes: false,
  zoom: 100,
  canUndo: false,
  canRedo: false,
  selected: 0,
  boardName: '',
  boardId: '',
  people: [],
  connected: false,
  dlg: '',
  pair: { role: '', stage: '', words: [], qr: '', left: '', relays: 0, relaysTotal: 0, peerName: '', expected: [], reason: '', tries: 3 },
  boards: [],
  sure: '',
  stun: { checked: false, ok: true, results: [] },
  turnUrl: pref('turn', null)?.urls?.join(' ') || '',
  turnUser: pref('turn', null)?.username || '',
  turnPass: pref('turn', null)?.credential || '',
  turnError: '',
  toasts: [],
  canInstall: false,
  empty: true,
  saved: true,
});
bindStore(S);

const theme = () => ({ ...THEMES[S.theme], select: '#8fa8c2', selectFill: 'rgba(143,168,194,.12)' });
const replica = randomId(6);
let session = null;
let view = null;
let installEvent = null;

function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.theme);
  document.documentElement.style.colorScheme = S.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', S.theme === 'dark' ? '#0c0e11' : '#f2f1ec');
  view?.refresh();
}

function toast(text, kind = 'info', ms = 4200) {
  const id = randomId(4);
  S.toasts.push({ id, text, kind });
  setTimeout(() => {
    const i = S.toasts.findIndex((x) => x.id === id);
    if (i >= 0) S.toasts.splice(i, 1);
  }, ms);
}

// ---------- Board actions ----------

const app = {
  get board() {
    return session.board;
  },
  get history() {
    return session.history;
  },
  get view() {
    return view;
  },
  send: (op) => session.send(op),
  newId: () => session.newId(),
  tool: () => S.tool,
  style: () => ({ color: S.color, size: S.size, fill: S.fill, note: S.note }),
  changedHistory() {
    S.canUndo = session.history.canUndo;
    S.canRedo = session.history.canRedo;
  },
  cursor: (x, y) => session.cursor(x, y),
  select(ids) {
    view.selection = new Set(ids);
    S.selected = view.selection.size;
    view.dirty();
  },
  editText: (el, isNew) => editText(el, isNew),
  afterShape() {},
};

function newBoardId() {
  return randomId(8);
}

async function openBoard(id, name = null, options = {}) {
  closeEditor(true);
  const meta = await session.open(id, name || t('board.untitled'), options);
  setPref('last', meta.id);
  view.setBoard(session.board);
  session.board.onChange(() => {
    S.empty = view.list.length === 0;
    S.saved = false;
    thumbSoon();
  });
  S.boardName = meta.name;
  S.boardId = meta.id;
  S.empty = view.list.length === 0;
  app.changedHistory();
  app.select([]);
  view.fit();
  if (view.list.length === 0) {
    view.cam = { x: -view.w / 2, y: -view.h / 2, z: 1 };
    view.dirty(true);
  }
  return meta;
}

let thumbTimer = 0;
function thumbSoon() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    const thumb = await exporter.thumbnail(session.board.visible(), S.theme).catch(() => '');
    await session.save(thumb);
    S.saved = true;
  }, 2500);
}

function setTool(tool) {
  closeEditor(true);
  S.tool = tool;
  S.shapes = false;
  if (tool !== 'select') app.select([]);
  view.eraser = null;
  view.dirty();
  $('#board').dataset.tool = tool;
}

function applyStyle(fields) {
  const sel = view.selected().filter((el) => el.type !== 'image');
  if (!sel.length) return;
  const g = new Gesture(app);
  for (const el of sel) {
    const f = { ...fields };
    if (el.type === 'note' && f.color) f.color = f.color === 'ink' ? NOTES[0] : f.color;
    if ('fill' in f && el.type !== 'rect' && el.type !== 'ellipse') delete f.fill;
    if ('size' in f && (el.type === 'text' || el.type === 'note')) delete f.size;
    if ('size' in f && el.type === 'hl') f.size = (f.size * 4 + 8) / view.cam.z;
    else if ('size' in f) f.size = f.size / view.cam.z;
    if (Object.keys(f).length) g.change(el.id, f);
  }
  g.commit();
}

function setColor(c) {
  S.color = c;
  applyStyle({ color: c });
}

function setNote(c) {
  S.note = c;
  const sel = view.selected().filter((el) => el.type === 'note');
  if (!sel.length) return;
  const g = new Gesture(app);
  for (const el of sel) g.change(el.id, { color: c });
  g.commit();
}

function setSize(n) {
  S.size = n;
  setPref('size', n);
  applyStyle({ size: n });
}

function toggleFill() {
  S.fill = !S.fill;
  applyStyle({ fill: S.fill });
}

function undo() {
  closeEditor(true);
  for (const op of session.history.undo()) session.send(op);
  app.changedHistory();
}

function redo() {
  closeEditor(true);
  for (const op of session.history.redo()) session.send(op);
  app.changedHistory();
}

function removeSelected() {
  const sel = view.selected();
  if (!sel.length) return;
  const g = new Gesture(app);
  for (const el of sel) g.change(el.id, { del: true });
  g.commit();
  app.select([]);
}

function duplicate() {
  const sel = view.selected();
  if (!sel.length) return;
  const g = new Gesture(app);
  const ids = [];
  let z = session.board.topZ();
  for (const el of sel) {
    const id = session.newId();
    const { id: _id, by: _by, z: _z, del: _del, points, ...fields } = el;
    if (STROKE_TYPES.has(el.type)) {
      const [sx, sy, tx, ty] = el.m || [1, 1, 0, 0];
      fields.m = [sx, sy, tx + 24, ty + 24];
    } else {
      fields.x = (el.x || 0) + 24;
      fields.y = (el.y || 0) + 24;
    }
    g.create(id, { ...fields, z: ++z });
    if (points?.length) session.send(session.board.addPoints(id, points.flat()));
    ids.push(id);
  }
  g.commit();
  app.select(ids);
}

function toFront() {
  const sel = view.selected();
  if (!sel.length) return;
  const g = new Gesture(app);
  let z = session.board.topZ();
  for (const el of sel) g.change(el.id, { z: ++z });
  g.commit();
}

function selectAll() {
  setTool('select');
  app.select(view.list.map((e) => e.id));
}

function zoomBy(k) {
  view.zoomAt(view.w / 2, view.h / 2, k);
}

// ---------- Text and notes ----------

let editing = null; // { el, isNew, node }

function placeEditor() {
  if (!editing) return;
  const { el, node } = editing;
  const z = view.cam.z;
  if (el.type === 'note') {
    const pad = 14;
    const [x, y] = view.toScreen(el.x + pad, el.y + pad);
    Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${(el.w - pad * 2) * z}px`, height: `${(el.h - pad * 2) * z}px`, fontSize: `${(el.fs || NOTE_FS) * z}px`, color: THEMES[S.theme].noteText });
  } else {
    const [x, y] = view.toScreen(el.x, el.y);
    const fs = (el.fs || 28) * z;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.fontSize = `${fs}px`;
    node.style.color = el.color === 'ink' || !el.color ? THEMES[S.theme].ink : el.color;
    node.style.height = 'auto';
    node.style.width = 'auto';
    const lines = node.value.split('\n');
    node.style.width = `${Math.max(fs * 2, ...lines.map((l) => view.measure(l, el.fs || 28) * z)) + fs}px`;
    node.style.height = `${lines.length * fs * 1.3 + 6}px`;
  }
}

function editText(el, isNew) {
  closeEditor(true);
  const node = $('#text-editor');
  let target = el;
  if (isNew && el.type === 'note') {
    const g = new Gesture(app);
    const id = session.newId();
    g.create(id, { type: 'note', x: el.x, y: el.y, w: el.w, h: el.h, color: el.color, fs: el.fs, text: '' });
    g.commit();
    target = session.board.get(id);
    isNew = false;
    editing = { el: target, isNew: false, node, created: true };
  } else {
    editing = { el: target, isNew, node };
  }
  view.editing = target.id || null;
  node.className = `text-editor ${target.type === 'note' ? 'is-note' : 'is-text'}`;
  node.value = target.text || '';
  node.hidden = false;
  placeEditor();
  view.dirty();
  requestAnimationFrame(() => {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  });
}

function closeEditor(commit) {
  if (!editing) return;
  const { el, isNew, node } = editing;
  editing = null;
  node.hidden = true;
  view.editing = null;
  const text = node.value.replace(/\s+$/, '');
  if (commit) {
    const g = new Gesture(app);
    if (el.type === 'text') {
      const box = measureText(text, el.fs || 28, view.measure);
      if (isNew && text) g.create(session.newId(), { type: 'text', x: el.x, y: el.y, fs: el.fs, color: el.color, text, w: box.w, h: box.h });
      else if (!isNew && !text) g.change(el.id, { del: true });
      else if (!isNew && text !== el.text) g.change(el.id, { text, w: box.w, h: box.h });
    } else if (el.type === 'note' && text !== (el.text || '')) {
      g.change(el.id, { text });
    }
    g.commit();
  }
  view.dirty();
}

// ---------- Images and files ----------

async function addImage(file, at = null) {
  try {
    const pic = await images.compress(file);
    await images.store(pic.hash, pic.mime, pic.bytes);
    const [cx, cy] = at || view.center();
    const k = Math.min(1, 480 / view.cam.z / Math.max(pic.w, pic.h));
    const w = Math.round(pic.w * k);
    const h = Math.round(pic.h * k);
    const g = new Gesture(app);
    const id = session.newId();
    g.create(id, { type: 'image', x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, src: pic.hash });
    g.commit();
    session.sendBlob(pic.hash);
    setTool('select');
    app.select([id]);
  } catch {
    toast(t('image.failed'), 'warning');
  }
}

async function openFiles(files, at = null) {
  for (const file of files) {
    if (file.type.startsWith('image/')) await addImage(file, at);
    else if (file.name.endsWith(FILE_EXTENSION) || file.type === 'application/json') await importBoard(file);
  }
}

async function importBoard(file) {
  try {
    const id = await exporter.importFile(file);
    await openBoard(id);
    toast(t('boards.imported'), 'success');
    await listBoards();
  } catch (err) {
    toast(err.message || t('boards.importFailed'), 'warning', 6000);
  }
}

// ---------- Boards dialog ----------

async function listBoards() {
  const all = await db.listBoards();
  S.boards = all.map((b) => ({ id: b.id, name: b.name, thumb: b.thumb || '', when: new Date(b.updated || b.created || Date.now()).toLocaleString(S.lang === 'pt' ? 'pt-BR' : 'en'), current: b.id === S.boardId }));
}

async function newBoard() {
  S.dlg = '';
  await openBoard(newBoardId(), t('board.untitled'));
  await listBoards();
}

async function openFromList(id) {
  S.dlg = '';
  if (id !== S.boardId) await openBoard(id);
}

async function deleteBoard(id) {
  if (S.sure !== id) {
    S.sure = id;
    return;
  }
  S.sure = '';
  await db.deleteBoard(id);
  if (id === S.boardId) {
    const rest = await db.listBoards();
    await openBoard(rest[0]?.id || newBoardId(), rest[0] ? null : t('board.untitled'));
  }
  await listBoards();
}

async function renameBoard(name) {
  const clean = String(name || '').trim();
  if (!clean || clean === S.boardName) {
    S.boardName = session.meta.name;
    return;
  }
  await session.rename(clean);
  S.boardName = session.meta.name;
}

// ---------- Pairing ----------

let joinInputs = null;
let confirmInputs = null;
let countdown = 0;

function syncPair(p) {
  if (!p) {
    S.pair = { role: '', stage: '', words: [], qr: '', left: '', relays: 0, relaysTotal: 0, peerName: '', expected: [], reason: '', tries: 3 };
    return;
  }
  Object.assign(S.pair, {
    role: p.role,
    stage: p.stage,
    words: p.words || [],
    qr: p.qr || '',
    relays: p.relays || 0,
    relaysTotal: p.relaysTotal || 0,
    peerName: p.peerName || '',
    expected: p.role === 'joiner' ? p.expected || [] : [],
    reason: p.reason || '',
    tries: 3 - (p.attempts || 0),
  });
  if (p.stage === 'confirm' && confirmInputs) {
    if (!S.pair.confirmShown) {
      confirmInputs.reset();
      setTimeout(() => confirmInputs.focus(), 60);
    }
    S.pair.confirmShown = true;
  }
  if (p.stage === 'done') {
    clearInterval(countdown);
    toast(t('pair.done', { name: p.peerName || t('people.friend') }), 'success');
    setTimeout(() => {
      if (S.pair.stage === 'done') S.dlg = '';
    }, 1400);
  }
  if (p.stage === 'failed') clearInterval(countdown);
}

async function invite() {
  if (!S.name) return (S.dlg = 'welcome');
  S.dlg = 'invite';
  S.pair.confirmShown = false;
  clearInterval(countdown);
  const p = await session.invite(new URL('./', location.href).href);
  if (!p) return;
  const tick = () => {
    const left = Math.max(0, (p.expires || Date.now()) - Date.now());
    S.pair.left = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  };
  tick();
  countdown = setInterval(tick, 1000);
}

function openJoin(words = null) {
  if (!S.name) {
    pendingWords = words;
    return (S.dlg = 'welcome');
  }
  session.stopPairing();
  syncPair(null);
  S.pair.role = 'joiner';
  S.pair.stage = 'type';
  S.dlg = 'join';
  joinInputs.reset();
  if (words) {
    joinInputs.fill(words);
    startJoin();
  } else setTimeout(() => joinInputs.focus(), 80);
}

async function startJoin() {
  const res = joinInputs.values();
  if (!res.ok) {
    joinInputs.setError();
    toast(t('words.incomplete'), 'warning');
    return;
  }
  S.pair.stage = 'finding';
  await session.join(res.words, async (board, options) => {
    await openBoard(board.id, board.name, options);
  });
}

function confirmTyped() {
  const res = confirmInputs.values();
  if (!res.ok) {
    confirmInputs.setError();
    return;
  }
  const out = session.confirm(res.words);
  if (out === 'wrong') {
    confirmInputs.setError();
    S.pair.tries = 3 - (session.pairing?.attempts || 0);
  }
}

function closeDialog() {
  if ((S.dlg === 'invite' || S.dlg === 'join') && S.pair.stage !== 'done') {
    session.stopPairing();
    syncPair(null);
    clearInterval(countdown);
  }
  S.dlg = '';
  S.sure = '';
}

function leaveBoard() {
  session.leave();
  S.connected = false;
  toast(t('people.left'), 'info');
}

// ---------- Cursors of other people ----------

const cursors = new Map();

function cursorEl(id) {
  let c = cursors.get(id);
  if (!c) {
    const node = document.createElement('div');
    node.className = 'peer-cursor';
    node.innerHTML = '<svg viewBox="0 0 16 22" aria-hidden="true"><path d="M1 1 L1 18 L5.6 14 L9 21 L11.8 19.8 L8.6 13 L14.8 12.8 Z"/></svg><span class="peer-name"></span>';
    $('#cursors').append(node);
    c = { node, x: 0, y: 0, timer: 0 };
    cursors.set(id, c);
  }
  return c;
}

function placeCursor(c) {
  const [x, y] = view.toScreen(c.x, c.y);
  c.node.style.transform = `translate(${x}px, ${y}px)`;
}

function onCursor({ id, x, y, gone }) {
  if (gone) {
    const c = cursors.get(id);
    c?.node.remove();
    cursors.delete(id);
    return;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const person = S.people.find((p) => p.id === id);
  const c = cursorEl(id);
  c.x = x;
  c.y = y;
  c.node.style.setProperty('--c', person?.color || PEOPLE_COLORS[0]);
  c.node.querySelector('.peer-name').textContent = person?.name || t('people.friend');
  c.node.classList.remove('is-idle');
  clearTimeout(c.timer);
  c.timer = setTimeout(() => c.node.classList.add('is-idle'), 6000);
  placeCursor(c);
}

// ---------- Settings ----------

function saveProfile() {
  S.name = String(S.name || '').trim().slice(0, 32);
  setPref('name', S.name);
  setPref('color', S.me);
  session.setProfile({ name: S.name || t('people.you'), color: S.me });
}

function setLang(lang) {
  S.lang = lang;
  setPref('lang', lang);
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
}

function setTheme(name) {
  S.theme = name;
  setPref('theme', name);
  applyTheme();
}

function saveTurn() {
  S.turnError = '';
  if (!S.turnUrl.trim()) {
    setPref('turn', null);
    session.turn = null;
    toast(t('settings.turnCleared'), 'info');
    return;
  }
  try {
    const turn = parseTurn({ urls: S.turnUrl, username: S.turnUser, credential: S.turnPass });
    setPref('turn', turn);
    session.turn = turn;
    toast(t('settings.turnSaved'), 'success');
  } catch (err) {
    S.turnError = t(`turn.${err.reason}`) || err.message;
  }
}

async function checkStun() {
  S.stun.checked = false;
  const results = await probeAllStun();
  S.stun = { checked: true, ok: results.some((r) => r.ok), results: results.map((r) => ({ host: r.url.replace(/^stun:/, ''), ok: r.ok, ms: r.ms })) };
}

let pendingWords = null;

async function welcomeDone() {
  if (!String(S.name || '').trim()) {
    S.name = t('people.defaultName', { n: Math.floor(10 + Math.random() * 89) });
  }
  saveProfile();
  setPref('welcomed', true);
  S.dlg = '';
  if (pendingWords) {
    const w = pendingWords;
    pendingWords = null;
    openJoin(w);
  }
}

async function install() {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  S.canInstall = false;
}

// ---------- Keyboard, paste and drop ----------

function onKey(e) {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    if (editing) return closeEditor(true);
    if (S.dlg) return;
    app.select([]);
    S.shapes = false;
    return;
  }
  if (typing) {
    if (editing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeEditor(true);
    return;
  }
  if (S.dlg) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && k === 'y') {
    e.preventDefault();
    return redo();
  }
  if (mod && k === 'd') {
    e.preventDefault();
    return duplicate();
  }
  if (mod && k === 'a') {
    e.preventDefault();
    return selectAll();
  }
  if (mod) return;
  if (e.key === 'Delete' || e.key === 'Backspace') return removeSelected();
  if (e.key === ' ') {
    view.canvas.classList.add('is-hand');
    input.space = true;
    e.preventDefault();
    return;
  }
  if (e.key === '+' || e.key === '=') return zoomBy(1.2);
  if (e.key === '-') return zoomBy(1 / 1.2);
  if (e.key === '0') return view.setZoom(1);
  if (e.key === '1') return view.fit();
  if (e.key.startsWith('Arrow') && view.selection.size) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) / view.cam.z;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const g = new Gesture(app);
    for (const el of view.selected()) g.change(el.id, el.m ? { m: [el.m[0], el.m[1], el.m[2] + dx, el.m[3] + dy] } : { x: el.x + dx, y: el.y + dy });
    g.commit();
    return;
  }
  if (TOOLS[k]) setTool(TOOLS[k]);
  if (k === 'i') $('#image-file').click();
}

let input = null;

// ---------- Start ----------

async function start() {
  applyTheme();
  document.documentElement.lang = S.lang === 'pt' ? 'pt-BR' : 'en';
  const profile = { id: replica, name: S.name || t('people.you'), color: S.me };
  session = new Session({ profile, turn: pref('turn', null) });
  view = new View($('#board'), { getTheme: theme });
  view.onNeed = (hash) => session.need(hash);
  input = new Input($('#board'), app);
  view.onCamera(() => {
    S.zoom = Math.round(view.cam.z * 100);
    for (const c of cursors.values()) placeCursor(c);
    placeEditor();
  });

  session.on('people', (list) => {
    S.people = list;
    S.connected = session.connected;
  });
  session.on('cursor', onCursor);
  session.on('pairing', syncPair);
  session.on('image', (hash) => {
    view.missing.delete(hash);
    view.refresh();
  });
  session.on('board', (meta) => {
    S.boardName = meta.name;
    S.boardId = meta.id;
  });
  session.on('notice', (n) => {
    if (n.kind === 'full' || n.kind === 'rejected') toast(t('people.full', { max: MAX_MEMBERS }), 'warning', 6000);
  });

  joinInputs = wordInputs($('#join-words'), { idPrefix: 'join-word', onReady: () => startJoin() });
  confirmInputs = wordInputs($('#confirm-words'), { idPrefix: 'confirm-word', onReady: () => confirmTyped() });

  const last = pref('last', null);
  const known = last ? await db.getBoard(last) : null;
  await openBoard(known ? last : newBoardId(), known ? null : t('board.first'));

  // Six words carried by a scanned QR code: join right away, then forget the words.
  const fromLink = wordsFromLink(location.hash);
  if (fromLink) {
    history.replaceState(null, '', location.pathname + location.search);
    const res = resolvePhrase(fromLink);
    if (res.ok) openJoin(res.words);
  }
  if (!pref('welcomed', false) && S.dlg !== 'join') S.dlg = 'welcome';

  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      input.space = false;
      view.canvas.classList.remove('is-hand');
    }
  });
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      openFiles(files);
    }
  });
  const stage = $('#stage');
  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.classList.add('is-drop');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('is-drop'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('is-drop');
    const r = view.canvas.getBoundingClientRect();
    openFiles([...(e.dataTransfer?.files || [])], view.toBoard(e.clientX - r.left, e.clientY - r.top));
  });
  $('#image-file').addEventListener('change', (e) => {
    openFiles([...e.target.files]);
    e.target.value = '';
  });
  $('#board-file').addEventListener('change', (e) => {
    openFiles([...e.target.files]);
    e.target.value = '';
  });
  const editor = $('#text-editor');
  editor.addEventListener('input', placeEditor);
  editor.addEventListener('blur', () => closeEditor(true));
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    S.canInstall = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) session.save();
  });
  window.addEventListener('pagehide', () => session.save());

  // Dialogs follow S.dlg.
  V.effect(() => {
    const want = S.dlg;
    for (const d of document.querySelectorAll('dialog[data-dlg]')) {
      if (d.dataset.dlg === want && !d.open) d.showModal();
      else if (d.dataset.dlg !== want && d.open) d.close();
    }
    if (want === 'boards') listBoards();
  });
  for (const d of document.querySelectorAll('dialog[data-dlg]')) {
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (d.dataset.dlg !== 'welcome') closeDialog();
    });
  }

  checkStun();
  db.persist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  setTool('pen');
  S.ready = true;
  S.people = session.people;
  // A small handle for the browser tests: read the board and make edits through the same
  // path as the tools (one undo step each, sent to every peer).
  window.doodleduo = {
    session: () => session,
    view: () => view,
    S,
    fingerprint: () => session.board.fingerprint(),
    count: () => view.list.length,
    edit(kind, n = 1) {
      for (let i = 0; i < n; i++) {
        const list = view.list;
        const g = new Gesture(app);
        const pick = list[Math.floor(Math.random() * list.length)];
        if (kind === 'create' || !pick) {
          const type = ['rect', 'ellipse', 'arrow', 'note'][Math.floor(Math.random() * 4)];
          g.create(session.newId(), { type, x: Math.round(Math.random() * 800), y: Math.round(Math.random() * 500), w: 80, h: 60, color: INKS[Math.floor(Math.random() * INKS.length)], size: 3, text: type === 'note' ? 'hi' : undefined });
        } else if (kind === 'move') g.change(pick.id, pick.m ? { m: [pick.m[0], pick.m[1], pick.m[2] + 7, pick.m[3] + 3] } : { x: (pick.x || 0) + 7, y: (pick.y || 0) + 3 });
        else if (kind === 'color') g.change(pick.id, { color: INKS[Math.floor(Math.random() * INKS.length)] });
        else if (kind === 'delete') g.change(pick.id, { del: true });
        g.commit();
      }
    },
    undo,
    redo,
  };
}

Object.assign(V.config.globals, {
  S,
  t,
  INKS,
  NOTES,
  PEOPLE_COLORS,
  MAX_MEMBERS,
  setTool,
  setColor,
  setNote,
  setSize,
  toggleFill,
  undo,
  redo,
  duplicate,
  removeSelected,
  toFront,
  zoomBy,
  fit: () => view.fit(),
  resetZoom: () => view.setZoom(1),
  invite,
  openJoin: () => openJoin(),
  startJoin,
  confirmTyped,
  closeDialog,
  leaveBoard,
  openDialog: (name) => (S.dlg = name),
  newBoard,
  openFromList,
  deleteBoard,
  renameBoard,
  exportPng: () => exporter.exportPng(session, S.theme),
  exportSvg: () => exporter.exportSvg(session, S.theme),
  exportFile: () => exporter.exportFile(session),
  pickImage: () => $('#image-file').click(),
  pickBoardFile: () => $('#board-file').click(),
  saveProfile,
  setLang,
  setTheme,
  saveTurn,
  checkStun,
  welcomeDone,
  install,
  initial: (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?',
  inkColor: (c) => (c === 'ink' ? THEMES[S.theme].ink : c),
});

V.start();
start();

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
import { ContextMenu } from './menu.js';
import { topAt, unionBounds } from '../core/geometry.js';
import { Session, MAX_MEMBERS } from './session.js';
import { MediaManager } from './media.js';
import { REACTIONS } from '../core/chat.js';
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
  pair: { role: '', stage: '', words: [], qr: '', link: '', copied: false, left: '', relays: 0, relaysTotal: 0, peerName: '', expected: [], reason: '', tries: 3 },
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
  chatOpen: false,
  chat: [],
  unread: 0,
  draft: '',
  replyTo: null,
  call: { in: false, muted: false, camera: false, screen: false, count: 0 },
  bubbles: true,
  speaking: [],
  screenFrom: '',
  screenName: '',
  screenBig: false,
  noiseMode: pref('noise', 'strong'),
  sensitivity: pref('sensitivity', 50),
  micId: pref('mic', ''),
  camId: pref('cam', ''),
  outId: pref('speaker', ''),
  devices: { mic: [], cam: [], out: [] },
  canPickSpeaker: false,
  testing: false,
  micLevel: 0,
  micGate: false,
});
bindStore(S);

const theme = () => ({ ...THEMES[S.theme], select: '#8fa8c2', selectFill: 'rgba(143,168,194,.12)' });
const replica = randomId(6);
let session = null;
let view = null;
const media = new MediaManager({
  get noiseMode() {
    return S.noiseMode;
  },
  set noiseMode(v) {
    S.noiseMode = v;
  },
  get sensitivity() {
    return S.sensitivity;
  },
  set sensitivity(v) {
    S.sensitivity = v;
  },
  get micId() {
    return S.micId;
  },
  set micId(v) {
    S.micId = v;
  },
  get camId() {
    return S.camId;
  },
  set camId(v) {
    S.camId = v;
  },
  get outId() {
    return S.outId;
  },
  set outId(v) {
    S.outId = v;
  },
  save() {
    setPref('noise', S.noiseMode);
    setPref('sensitivity', S.sensitivity);
    setPref('mic', S.micId);
    setPref('cam', S.camId);
    setPref('speaker', S.outId);
  },
});
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
    // Picking one element of a group picks the whole group.
    const want = new Set(ids);
    const groups = new Set();
    for (const el of view.list) if (want.has(el.id) && el.grp) groups.add(el.grp);
    if (groups.size) for (const el of view.list) if (groups.has(el.grp) && !el.lock) want.add(el.id);
    view.selection = want;
    S.selected = view.selection.size;
    view.dirty();
  },
  editText: (el, isNew) => editText(el, isNew),
  contextMenu: (sx, sy, cx, cy) => boardMenu(sx, sy, cx, cy),
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
    S.pair = { role: '', stage: '', words: [], qr: '', link: '', copied: false, left: '', relays: 0, relaysTotal: 0, peerName: '', expected: [], reason: '', tries: 3 };
    return;
  }
  Object.assign(S.pair, {
    role: p.role,
    stage: p.stage,
    words: p.words || [],
    qr: p.qr || '',
    link: p.link || '',
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
  // Forget the words and the link of an earlier invite before the new ones arrive.
  syncPair(null);
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

/** Joins with the words in the address bar hash (#join=...), then removes them from it. */
function joinFromHash() {
  const fromLink = wordsFromLink(location.hash);
  if (!fromLink) return;
  history.replaceState(null, '', location.pathname + location.search);
  const res = resolvePhrase(fromLink);
  if (res.ok) openJoin(res.words);
  else toast(t('words.incomplete'), 'warning');
}

async function copyInvite() {
  const link = S.pair.link;
  if (!link) return;
  let done = false;
  try {
    await navigator.clipboard.writeText(link);
    done = true;
  } catch {
    // No clipboard permission: select the link so the person can copy it by hand.
    const field = $('#invite-link');
    field?.focus();
    field?.select();
  }
  if (done) {
    S.pair.copied = true;
    toast(t('invite.copied'), 'success');
    setTimeout(() => (S.pair.copied = false), 2000);
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
    node.dataset.peer = id;
    const person = S.people.find((p) => p.id === id);
    node.style.setProperty('--c', person?.color || PEOPLE_COLORS[0]);
    node.querySelector('.peer-name').textContent = person?.name || t('people.friend');
    $('#cursors').append(node);
    c = { node, x: 0, y: 0, timer: 0, seen: false };
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
    if (c?.node.classList.contains('has-cam') && media.peers.has(id)) {
      c.node.classList.add('is-idle');
      return;
    }
    c?.node.remove();
    cursors.delete(id);
    return;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const person = S.people.find((p) => p.id === id);
  const c = cursorEl(id);
  c.x = x;
  c.y = y;
  c.seen = true;
  c.node.style.setProperty('--c', person?.color || PEOPLE_COLORS[0]);
  c.node.querySelector('.peer-name').textContent = person?.name || t('people.friend');
  c.node.classList.remove('is-idle');
  clearTimeout(c.timer);
  c.timer = setTimeout(() => c.node.classList.add('is-idle'), 6000);
  placeCursor(c);
}

// ---------- Chat ----------

const timeFmt = () => new Intl.DateTimeFormat(S.lang === 'pt' ? 'pt-BR' : 'en', { hour: '2-digit', minute: '2-digit' });

function renderChat() {
  const me = replica;
  const fmt = timeFmt();
  const before = S.chat.length;
  S.chat = session.chat.list().map((m) => {
    const parent = m.reply ? session.chat.get(m.reply) : null;
    return {
      id: m.id,
      name: m.name,
      color: m.color,
      text: m.text,
      mine: m.from === me,
      time: m.ts ? fmt.format(new Date(m.ts)) : '',
      replyName: parent?.name || '',
      replyText: parent ? parent.text.slice(0, 90) : '',
      reactions: session.chat.reactionsOf(m.id, me),
    };
  });
  if (S.chatOpen) {
    S.unread = 0;
    if (S.chat.length !== before) requestAnimationFrame(() => {
      const list = $('#chat-list');
      if (list) list.scrollTop = list.scrollHeight;
    });
  }
}

function toggleChat() {
  S.chatOpen = !S.chatOpen;
  if (S.chatOpen) {
    S.unread = 0;
    renderChat();
    requestAnimationFrame(() => {
      const list = $('#chat-list');
      if (list) list.scrollTop = list.scrollHeight;
      $('#chat-input')?.focus();
    });
  }
}

function sendChat() {
  const text = String(S.draft || '').trim();
  if (!text) return;
  session.say(text, S.replyTo?.id || null);
  S.draft = '';
  S.replyTo = null;
  renderChat();
  requestAnimationFrame(() => {
    const list = $('#chat-list');
    if (list) list.scrollTop = list.scrollHeight;
  });
}

function replyTo(id) {
  const m = session.chat.get(id);
  if (!m) return;
  S.replyTo = { id, name: m.name, text: m.text.slice(0, 90) };
  $('#chat-input')?.focus();
}

function react(id, key) {
  session.react(id, key);
  renderChat();
}

// ---------- Call, cameras and screens ----------

function syncCall() {
  const st = media.state;
  let count = st.call ? 1 : 0;
  for (const p of media.peers.values()) if (p.call) count++;
  S.call = { in: st.call, muted: st.muted, camera: st.camera, screen: st.screen, count };
  S.testing = media.testing;
  renderPeople();
}

function renderPeople() {
  const speaking = media.speaking;
  S.people = session.people.map((p) => {
    const peer = p.me ? media.state : media.peers.get(p.id);
    return { ...p, call: !!peer?.call, muted: !!peer?.call && !!peer?.muted, speaking: speaking.has(p.me ? 'self' : p.id) };
  });
}

function renderVideo() {
  // Camera bubbles next to each person's cursor.
  for (const [id, p] of media.peers) {
    const stream = p.camera ? media.remoteVideo(id, 'camera') : null;
    const c = stream ? cursorEl(id) : cursors.get(id);
    if (!c) continue;
    let video = c.node.querySelector('video.cam-bubble');
    if (stream) {
      if (!video) {
        video = document.createElement('video');
        video.className = 'cam-bubble';
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        c.node.append(video);
      }
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        video.play().catch(() => {});
      }
      c.node.classList.add('has-cam');
      if (!c.seen) dock(c, id);
    } else if (video) {
      video.srcObject = null;
      video.remove();
      c.node.classList.remove('has-cam');
    }
  }
  const self = $('#self-cam');
  if (self.srcObject !== media.camera) self.srcObject = media.camera || null;
  if (media.camera) self.play().catch(() => {});
  // The first screen someone shares.
  let from = '';
  let stream = null;
  for (const [id, p] of media.peers) {
    const s = p.screen ? media.remoteVideo(id, 'screen') : null;
    if (s) {
      from = id;
      stream = s;
      break;
    }
  }
  const sv = $('#screen-video');
  if (sv.srcObject !== stream) {
    sv.srcObject = stream;
    if (stream) sv.play().catch(() => {});
  }
  S.screenFrom = from;
  S.screenName = from ? S.people.find((p) => p.id === from)?.name || t('people.friend') : '';
}

/** A camera bubble for someone whose cursor has not moved yet waits at the side of the slate. */
function dock(c, id) {
  const i = [...media.peers.keys()].indexOf(id);
  const [x, y] = view.toBoard(view.w - 140, 150 + Math.max(0, i) * 120);
  c.x = x;
  c.y = y;
  c.node.classList.remove('is-idle');
  placeCursor(c);
}

async function joinCall() {
  await media.join();
  syncCall();
  refreshDevices();
}

function mediaError(code) {
  toast(t(`media.${code}`) || t('media.failed'), 'warning', 6000);
}

async function toggleMicTest() {
  if (media.testing) media.stopMicTest();
  else {
    try {
      await media.startMicTest();
    } catch (err) {
      mediaError(err.name === 'NotAllowedError' ? 'mic-denied' : 'mic-failed');
    }
  }
  S.testing = media.testing;
  refreshDevices();
}

/** Fills the device pickers. Names show once the browser has granted the mic or the camera. */
async function refreshDevices() {
  const d = await media.devices();
  const named = (list, key) => list.map((x, i) => ({ id: x.id, label: x.label || t(key, { n: i + 1 }) }));
  S.devices = { mic: named(d.audioinput, 'devices.micN'), cam: named(d.videoinput, 'devices.camN'), out: named(d.audiooutput, 'devices.outN') };
  S.canPickSpeaker = media.canPickSpeaker && d.audiooutput.length > 0;
}

// ---------- Settings ----------

function saveProfile() {
  S.name = String(S.name || '').trim().slice(0, 32);
  setPref('name', S.name);
  setPref('color', S.me);
  session.setProfile({ name: S.name || t('people.you'), color: S.me });
  renderPeople();
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

// ---------- Context menu ----------

const menu = new ContextMenu();
const CLIP_MARK = 'doodleduo/elements:';
let clip = null; // the elements copied last, as plain fields
const COLOR_NAMES = {
  ink: 'ink',
  '#9fb4c9': 'blue',
  '#c9a3a6': 'rose',
  '#a9bf9f': 'sage',
  '#d8c08f': 'sand',
  '#b5a8cc': 'lilac',
  '#e6d9a8': 'butter',
  '#c9d8b8': 'mint',
  '#e6c3bd': 'peach',
  '#bccfdd': 'sky',
  '#d3c6df': 'lavender',
};

/** Plain copies of elements, strokes with their points, ready to paste anywhere. */
function snapshot(els) {
  return els.map((el) => {
    const { id: _id, by: _by, del: _del, lock: _lock, ...fields } = el;
    return JSON.parse(JSON.stringify(fields));
  });
}

/** Adds copies of plain elements moved by (dx, dy), on top, with new ids and new group ids. */
function placeCopies(els, dx, dy) {
  const g = new Gesture(app);
  const ids = [];
  const groups = new Map();
  let z = session.board.topZ();
  for (const src of [...els].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
    const id = session.newId();
    const { points, ...fields } = src;
    if (STROKE_TYPES.has(src.type)) {
      const [sx, sy, tx, ty] = src.m || [1, 1, 0, 0];
      fields.m = [sx, sy, tx + dx, ty + dy];
    } else {
      fields.x = (src.x || 0) + dx;
      fields.y = (src.y || 0) + dy;
    }
    if (src.grp) {
      if (!groups.has(src.grp)) groups.set(src.grp, `g${session.newId()}`);
      fields.grp = groups.get(src.grp);
    }
    g.create(id, { ...fields, z: ++z });
    if (points?.length) session.send(session.board.addPoints(id, points.flat()));
    ids.push(id);
  }
  g.commit();
  app.select(ids);
  return ids;
}

function copySelection() {
  const sel = view.selected();
  if (!sel.length) return;
  clip = snapshot(sel);
  navigator.clipboard?.writeText(CLIP_MARK + JSON.stringify({ v: 1, els: clip })).catch(() => {});
  toast(t('menu.copied', { n: sel.length }), 'success', 1800);
}

/** Pastes plain elements centered on a board point, or a step away from where they were. */
function pasteElements(els, at = null) {
  if (!els?.length) return;
  setTool('select');
  let dx = 24;
  let dy = 24;
  if (at) {
    const b = unionBounds(els.map((e) => ({ ...e, id: e.id || 'x' })));
    if (b) {
      dx = at[0] - (b.x + b.w / 2);
      dy = at[1] - (b.y + b.h / 2);
    }
  }
  placeCopies(els, dx, dy);
}

function readClip(text) {
  if (typeof text !== 'string' || !text.startsWith(CLIP_MARK)) return null;
  try {
    const data = JSON.parse(text.slice(CLIP_MARK.length));
    return Array.isArray(data?.els) ? data.els.slice(0, 2000).filter((e) => e && typeof e === 'object' && typeof e.type === 'string') : null;
  } catch {
    return null;
  }
}

async function pasteAt(at) {
  let els = clip;
  if (!els && navigator.clipboard?.readText) els = readClip(await navigator.clipboard.readText().catch(() => ''));
  if (!els?.length) return toast(t('menu.nothing'), 'info', 2400);
  pasteElements(els, at);
}

function sendToBack() {
  const sel = view.selected().sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  if (!sel.length) return;
  const g = new Gesture(app);
  let z = session.board.bottomZ() - sel.length;
  for (const el of sel) g.change(el.id, { z: z++ });
  g.commit();
}

function setLock(els, lock) {
  if (!els.length) return;
  const g = new Gesture(app);
  for (const el of els) g.change(el.id, { lock });
  g.commit();
  app.select(lock ? [] : els.map((e) => e.id));
  toast(t(lock ? 'menu.locked' : 'menu.unlocked', { n: els.length }), 'info', 2000);
}

function setGroup(on) {
  const sel = view.selected();
  if (on ? sel.length < 2 : !sel.some((e) => e.grp)) return;
  const grp = on ? `g${session.newId()}` : '';
  const g = new Gesture(app);
  for (const el of sel) g.change(el.id, { grp });
  g.commit();
  app.select(sel.map((e) => e.id));
}

/** Colors an element can take: the note colors for notes only, else the inks. */
function colorItems(els) {
  const notes = els.every((e) => e.type === 'note');
  const list = notes ? NOTES : INKS;
  const current = els.length === 1 ? els[0].color : null;
  return list.map((c) => ({
    label: t(`color.${COLOR_NAMES[c] || 'ink'}`),
    swatch: c === 'ink' ? THEMES[S.theme].ink : c,
    checked: current === c,
    action: () => (notes ? setNote(c) : setColor(c)),
  }));
}

function elementItems(els) {
  const locked = els.length === 1 && els[0].lock;
  if (locked) {
    return [
      { id: 'unlock', label: t('menu.unlock'), icon: 'unlock', action: () => setLock(els, false) },
      { separator: true },
      { id: 'copy', label: t('menu.copy'), icon: 'copy', hint: 'Ctrl+C', action: () => ((clip = snapshot(els)), toast(t('menu.copied', { n: 1 }), 'success', 1800)) },
    ];
  }
  const styled = els.filter((e) => e.type !== 'image');
  const grouped = els.some((e) => e.grp);
  return [
    { id: 'copy', label: t('menu.copy'), icon: 'copy', hint: 'Ctrl+C', action: copySelection },
    { id: 'duplicate', label: t('sel.duplicate'), icon: 'duplicate', hint: 'Ctrl+D', action: duplicate },
    { id: 'delete', label: t('sel.delete'), icon: 'trash', hint: 'Del', danger: true, action: removeSelected },
    { separator: true },
    { id: 'front', label: t('sel.front'), icon: 'front', action: toFront },
    { id: 'back', label: t('menu.back'), icon: 'back', action: sendToBack },
    { separator: true },
    { id: 'color', label: t('menu.color'), icon: 'palette', disabled: !styled.length, submenu: colorItems(styled.length ? styled : els) },
    grouped ? { id: 'ungroup', label: t('menu.ungroup'), icon: 'ungroup', action: () => setGroup(false) } : { id: 'group', label: t('menu.group'), icon: 'group', hint: 'Ctrl+G', disabled: els.length < 2, action: () => setGroup(true) },
    { id: 'lock', label: t('menu.lock'), icon: 'lock', action: () => setLock(view.selected(), true) },
  ];
}

function boardItems(bx, by) {
  const z = view.cam.z;
  return [
    { id: 'paste', label: t('menu.paste'), icon: 'paste', hint: 'Ctrl+V', disabled: !clip && !navigator.clipboard?.readText, action: () => pasteAt([bx, by]) },
    { separator: true },
    {
      id: 'add-note',
      label: t('menu.addNote'),
      icon: 'note',
      action: () => {
        const w = 200 / Math.max(z, 0.5);
        editText({ type: 'note', x: bx - w / 2, y: by - w / 2, w, h: w, color: S.note, fs: NOTE_FS / Math.max(z, 0.5), text: '' }, true);
      },
    },
    { id: 'add-text', label: t('menu.addText'), icon: 'text', action: () => editText({ type: 'text', x: bx, y: by - 17 / z, fs: Math.round((28 / z) * 10) / 10, color: S.color, text: '' }, true) },
    { separator: true },
    { id: 'fit', label: t('zoom.fit'), icon: 'fit', hint: '1', disabled: !view.list.length, action: () => view.fit() },
    { id: 'select-all', label: t('menu.selectAll'), icon: 'select', hint: 'Ctrl+A', disabled: !view.list.some((e) => !e.lock), action: selectAll },
  ];
}

/** The canvas asked for a menu at a screen point (a right click or a long press). */
function boardMenu(sx, sy, cx, cy, keyboard = false) {
  if (S.dlg) return;
  closeEditor(true);
  const [bx, by] = view.toBoard(sx, sy);
  const el = topAt(view.list, bx, by, 6 / view.cam.z);
  if (el?.lock) {
    app.select([]);
    return menu.open(cx, cy, elementItems([el]), { label: t('menu.selection'), keyboard });
  }
  if (el) {
    if (!view.selection.has(el.id)) {
      setTool('select');
      app.select([el.id]);
    }
    return menu.open(cx, cy, elementItems(view.selected()), { label: t('menu.selection'), keyboard });
  }
  menu.open(cx, cy, boardItems(bx, by), { label: t('menu.board'), keyboard });
}

function messageItems(m) {
  const mine = session.profile.id;
  return [
    { id: 'reply', label: t('chat.reply'), icon: 'reply', action: () => replyTo(m.id) },
    { id: 'react', label: t('menu.react'), icon: 'heart', submenu: REACTIONS.map((k) => ({ id: `react-${k}`, label: t(`react.${k}`), icon: k, checked: session.chat.reactionsOf(m.id, mine).some((r) => r.key === k && r.mine), action: () => react(m.id, k) })) },
    { id: 'copy-text', label: t('menu.copyText'), icon: 'copy', action: () => navigator.clipboard?.writeText(m.text).then(() => toast(t('menu.copiedText'), 'success', 1600)).catch(() => {}) },
  ];
}

function messageMenu(node, cx, cy, keyboard) {
  const m = session.chat.get(node.dataset.id);
  if (m) menu.open(cx, cy, messageItems(m), { label: t('menu.message', { name: m.name }), keyboard, returnFocus: node });
}

function personItems(p) {
  if (p.me) {
    if (!S.call.in) {
      return [
        { id: 'join-call', label: t('top.call'), icon: 'call', disabled: !S.connected, action: joinCall },
        { id: 'settings', label: t('top.settings'), icon: 'settings', action: () => V.config.globals.openDialog('settings') },
      ];
    }
    return [
      { id: 'mute', label: S.call.muted ? t('call.unmute') : t('call.mute'), icon: S.call.muted ? 'mic' : 'mic-off', action: () => media.toggleMute() },
      { id: 'camera', label: S.call.camera ? t('menu.cameraOff') : t('menu.cameraOn'), icon: S.call.camera ? 'camera-off' : 'camera', action: () => media.toggleCamera() },
      { id: 'settings', label: t('top.settings'), icon: 'settings', action: () => V.config.globals.openDialog('settings') },
      { separator: true },
      { id: 'leave-call', label: t('call.leave'), icon: 'hangup', danger: true, action: () => media.leave() },
    ];
  }
  const c = cursors.get(p.id);
  const off = media.isMutedForMe(p.id);
  return [
    { id: 'goto', label: t('menu.goto', { name: p.name }), icon: 'locate', disabled: !c?.seen, action: () => goToCursor(p.id) },
    { id: 'mute-for-me', label: off ? t('menu.unmuteFor') : t('menu.muteFor'), icon: off ? 'volume' : 'mute', disabled: !p.call, action: () => media.setMutedForMe(p.id, !off) },
  ];
}

function personMenu(node, cx, cy, keyboard) {
  const p = S.people.find((x) => x.id === node.dataset.peer);
  if (p) menu.open(cx, cy, personItems(p), { label: p.name, keyboard, returnFocus: node });
}

function goToCursor(id) {
  const c = cursors.get(id);
  if (!c) return;
  view.cam = { ...view.cam, x: c.x - view.w / 2 / view.cam.z, y: c.y - view.h / 2 / view.cam.z };
  view.dirty(true);
  for (const k of cursors.values()) placeCursor(k);
}

/** The Menu key or Shift+F10: a menu for what has the focus, or for the selection or the board. */
function keyboardMenu(target) {
  const msg = target.closest?.('#chat-list .msg');
  const person = target.closest?.('.people .person');
  const at = (node) => {
    const r = node.getBoundingClientRect();
    return [r.left + Math.min(24, r.width / 2), r.top + Math.min(24, r.height / 2)];
  };
  if (msg) return messageMenu(msg, ...at(msg), true);
  if (person) return personMenu(person, ...at(person), true);
  const rect = view.canvas.getBoundingClientRect();
  const box = unionBounds(view.selected());
  let [sx, sy] = [view.w / 2, view.h / 2];
  if (box) [sx, sy] = view.toScreen(box.x + box.w / 2, box.y + box.h / 2);
  boardMenu(sx, sy, rect.left + sx, rect.top + sy, true);
}

/** Right click, the browser's own long press, and our long press on touch for chat and people. */
function wireMenus() {
  const onContext = (e) => {
    const msg = e.target.closest('#chat-list .msg');
    const person = e.target.closest('.people .person');
    if (!msg && !person) return;
    if (e.target.closest('input, textarea')) return;
    e.preventDefault();
    if (menu.isOpen && performance.now() - menu.openedAt < 800) return;
    if (msg) messageMenu(msg, e.clientX, e.clientY, false);
    else personMenu(person, e.clientX, e.clientY, false);
  };
  document.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const node = e.target.closest('#chat-list .msg, .people .person');
    if (!node) return;
    const start = [e.clientX, e.clientY];
    const timer = setTimeout(() => {
      if (node.matches('.msg')) messageMenu(node, start[0], start[1], false);
      else personMenu(node, start[0], start[1], false);
    }, 550);
    const stop = (ev) => {
      if (ev.type === 'pointermove' && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 10) return;
      clearTimeout(timer);
      removeEventListener('pointermove', stop);
      removeEventListener('pointerup', stop);
      removeEventListener('pointercancel', stop);
    };
    addEventListener('pointermove', stop);
    addEventListener('pointerup', stop);
    addEventListener('pointercancel', stop);
  });
}

// ---------- Keyboard, paste and drop ----------

function onKey(e) {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && !typing && !S.dlg && !menu.isOpen) {
    e.preventDefault();
    return keyboardMenu(e.target);
  }
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
  if (mod && k === 'c' && view.selection.size) {
    e.preventDefault();
    return copySelection();
  }
  if (mod && k === 'g') {
    e.preventDefault();
    return setGroup(!e.shiftKey);
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
  session.media = media;
  media.use(session);
  media.on('change', syncCall);
  media.on('video', renderVideo);
  media.on('speaking', renderPeople);
  media.on('error', mediaError);
  media.on('devices', refreshDevices);
  media.on('levels', () => {
    if (!media.testing) return;
    S.micLevel = Math.min(100, Math.round(media.level('test') * 400));
    S.micGate = !!media.micLevel?.open;
  });
  view = new View($('#board'), { getTheme: theme });
  view.onNeed = (hash) => session.need(hash);
  input = new Input($('#board'), app);
  view.onCamera(() => {
    S.zoom = Math.round(view.cam.z * 100);
    for (const c of cursors.values()) placeCursor(c);
    placeEditor();
  });

  session.on('people', () => {
    renderPeople();
    S.connected = session.connected;
    for (const [id, c] of cursors) if (!S.people.some((p) => p.id === id)) {
      c.node.remove();
      cursors.delete(id);
    }
  });
  session.on('chat-message', (m) => {
    if (!S.chatOpen && m && m.from !== replica) S.unread++;
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

  let chatOff = null;
  session.on('board', () => {
    chatOff?.();
    chatOff = session.chat.onChange(renderChat);
    renderChat();
  });
  const last = pref('last', null);
  const known = last ? await db.getBoard(last) : null;
  await openBoard(known ? last : newBoardId(), known ? null : t('board.first'));

  // An invite link (opened, or scanned from the QR code) carries the six words in its hash:
  // clear it from the address bar, then join right away.
  joinFromHash();
  addEventListener('hashchange', joinFromHash);
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
      return;
    }
    // Elements copied from a board (here or in another tab), or the ones copied last here.
    const text = e.clipboardData?.getData('text') || '';
    const els = readClip(text) || (!text ? clip : null);
    if (els?.length) {
      e.preventDefault();
      pasteElements(els);
    }
  });
  wireMenus();
  document.addEventListener('contextmenu', (e) => {
    // The Menu key on the page itself (no element of ours under it): the board menu.
    if (e.button === -1 || (e.clientX === 0 && e.clientY === 0 && !e.target.closest('input, textarea'))) {
      if (performance.now() - menu.openedAt > 800 && !S.dlg && !e.target.closest('#chat-list .msg, .people .person, .cmenu')) {
        e.preventDefault();
        keyboardMenu(e.target);
      }
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
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendChat();
    }
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
  renderPeople();
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
    media,
    leave: leaveBoard,
    select: (ids) => app.select(ids),
    menu,
    chat: () => session.chat,
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
  copyInvite,
  openJoin: () => openJoin(),
  startJoin,
  confirmTyped,
  closeDialog,
  leaveBoard,
  openDialog: (name) => {
    S.dlg = name;
    if (name === 'settings') refreshDevices();
  },
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
  REACTIONS,
  toggleChat,
  sendChat,
  replyTo,
  cancelReply: () => (S.replyTo = null),
  react,
  joinCall,
  leaveCall: () => media.leave(),
  toggleMute: () => media.toggleMute(),
  toggleCamera: () => media.toggleCamera(),
  toggleScreen: () => media.toggleScreen(),
  toggleBubbles: () => (S.bubbles = !S.bubbles),
  toggleScreenSize: () => (S.screenBig = !S.screenBig),
  setNoise: (mode) => media.setNoiseMode(mode),
  setMic: (id) => media.setMic(id).then(refreshDevices),
  setCamera: (id) => media.setCamera(id).then(refreshDevices),
  setSpeaker: (id) => media.setSpeaker(id),
  setSensitivity: (v) => media.setSensitivity(Number(v)),
  toggleMicTest,
});

V.start();
start();

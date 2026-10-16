// One open board and the people drawing on it. Local edits become CRDT operations that go to
// every peer through the mesh (batched every 40 ms); a peer who connects gets the whole board in
// small parts and asks for the pictures it lacks. Pairing uses six words through public relays:
// the inviter shows the words, a QR code and an invite link that all carry the same words, the
// friend types, scans or opens them, then the friend's screen shows six confirmation words that
// the inviter types back before anything is shared.

import { Board, History } from '../core/crdt.js';
import { ChatLog } from '../core/chat.js';
import { Emitter, Mesh, MAX_MEMBERS } from '../core/mesh.js';
import { RtcLink, buildIceServers } from '../core/rtc.js';
import { CodeCreator, CodeJoiner, CODE_LIFETIME_MS } from '../core/pairing.js';
import { invitePayload, packCode, readInvite, readReply, replyPayload, unpackCode } from '../core/invite.js';
import { confirmWords, wordsLink } from '../core/words.js';
import { randomId, sdpFingerprints } from '../core/crypto.js';
import { BlobAssembler, blobMessages } from '../core/blobs.js';
import { encodeQR, qrSvg } from '../core/qr.js';
import { cleanName } from '../core/format.js';
import * as db from './db.js';
import * as images from './images.js';

const FLUSH_MS = 40;
const CURSOR_MS = 50;

export class Session extends Emitter {
  /** profile: { id, name, color }, turn: TURN settings or null. */
  constructor({ profile, turn = null }) {
    super();
    this.profile = profile;
    this.turn = turn;
    this.replica = profile.id;
    this.counter = 0;
    this.meta = null;
    this.board = null;
    this.history = null;
    this.mesh = null;
    this.queue = [];
    this.timer = 0;
    this.cursorAt = 0;
    this.cursorPending = null;
    this.assembler = new BlobAssembler();
    this.asked = new Set();
    this.pairing = null; // { role, words, nonce, peer, expected, attempts, stage }
    this.saveTimer = 0;
    this.chat = new ChatLog();
    this.media = null;
  }

  newId() {
    return `${this.replica}${(++this.counter).toString(36)}`;
  }

  // ---------- Boards ----------

  /** Opens a board by id (creating it when missing). Leaves the people on the current board. */
  async open(id, name = null, { keepPairing = false } = {}) {
    if (keepPairing) this._leaveMesh();
    else this.leave();
    await this.save();
    let meta = await db.getBoard(id);
    if (!meta) {
      meta = { id, name: cleanName(name, 'Untitled board'), created: Date.now(), updated: Date.now(), thumb: '' };
      await db.putBoard(meta);
    }
    this.meta = meta;
    this.board = new Board(this.replica);
    const state = await db.getState(id);
    if (state) {
      try {
        this.board.mergeState(state);
      } catch {
        // A damaged saved state: start empty rather than not open at all.
      }
    }
    this.history = new History(this.board);
    this.board.onChange(() => this.saveSoon());
    this.chat = new ChatLog();
    const chat = await db.getState(`chat:${id}`);
    if (chat) this.chat.merge(chat);
    this.chat.onChange(() => this.saveSoon());
    this.emit('board', this.meta);
    return this.meta;
  }

  async rename(name) {
    this.meta.name = cleanName(name);
    this.meta.updated = Date.now();
    await db.putBoard(this.meta);
    if (this.mesh) this.mesh.board = { ...this.mesh.board, name: this.meta.name };
    this.broadcast({ type: 'name', board: this.meta.id, name: this.meta.name });
    this.emit('board', this.meta);
  }

  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 700);
  }

  async save(thumb = null) {
    clearTimeout(this.saveTimer);
    if (!this.board || !this.meta) return;
    this.meta.updated = Date.now();
    if (thumb) this.meta.thumb = thumb;
    await db.putState(this.meta.id, this.board.toState());
    await db.putState(`chat:${this.meta.id}`, this.chat.toState());
    await db.putBoard(this.meta);
    this.emit('saved', this.meta);
  }

  // ---------- Sending ----------

  /** Queues a local operation for every peer. */
  send(op) {
    if (!op || !this.mesh || !this.mesh.links.size) return;
    this.queue.push(op);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    this.timer = 0;
    if (!this.queue.length || !this.mesh) return;
    let batch = [];
    let size = 0;
    for (const op of this.queue) {
      const n = JSON.stringify(op).length;
      if (batch.length && size + n > 60000) {
        this.broadcast({ type: 'ops', board: this.meta.id, ops: batch });
        batch = [];
        size = 0;
      }
      batch.push(op);
      size += n;
    }
    if (batch.length) this.broadcast({ type: 'ops', board: this.meta.id, ops: batch });
    this.queue = [];
  }

  broadcast(body) {
    if (this.mesh && this.mesh.links.size) this.mesh.broadcast(body);
  }

  /** Where my pointer is on the board, at most 20 times a second. null when it left. */
  cursor(x, y) {
    if (!this.mesh || !this.mesh.links.size) return;
    this.cursorPending = x == null ? { type: 'cur', gone: true } : { type: 'cur', x: Math.round(x), y: Math.round(y) };
    const wait = CURSOR_MS - (Date.now() - this.cursorAt);
    if (wait <= 0) this._sendCursor();
    else if (!this.cursorTimer) this.cursorTimer = setTimeout(() => this._sendCursor(), wait);
  }

  _sendCursor() {
    this.cursorTimer = 0;
    if (!this.cursorPending) return;
    this.cursorAt = Date.now();
    this.mesh.broadcast(this.cursorPending);
    this.cursorPending = null;
  }

  /** Sends a stored picture to one peer, or to everyone. */
  async sendBlob(hash, to = null) {
    const rec = await db.getBlob(hash);
    if (!rec || !this.mesh) return;
    for (const msg of blobMessages(hash, rec.mime, rec.bytes)) {
      if (to) this.mesh.sendTo(to, msg);
      else this.mesh.broadcast(msg);
      // Give the channel time to drain between chunks of a big picture.
      await new Promise((r) => setTimeout(r, 4));
    }
  }

  /** Asks peers for a picture this device does not have yet. */
  need(hash) {
    if (this.asked.has(hash) || !this.mesh || !this.mesh.links.size) return;
    this.asked.add(hash);
    this.broadcast({ type: 'need', hs: [hash] });
    setTimeout(() => this.asked.delete(hash), 8000);
  }

  // ---------- The mesh ----------

  get people() {
    if (!this.mesh) return [{ id: this.profile.id, name: this.profile.name, color: this.profile.color, me: true, online: true }];
    return this.mesh
      .memberList()
      .filter((m) => m.online)
      .map((m) => ({ id: m.id, name: m.name, color: m.accent || '#9fb4c9', me: m.id === this.profile.id, online: true }));
  }

  get connected() {
    return !!this.mesh && this.mesh.links.size > 0;
  }

  setProfile(profile) {
    this.profile = { ...this.profile, ...profile };
    this.mesh?.setProfile({ name: this.profile.name, accent: this.profile.color });
  }

  _transport() {
    return { createLink: () => new RtcLink({ iceServers: buildIceServers(this.turn) }) };
  }

  _ensureMesh(host) {
    if (this.mesh && !this.mesh.closed) return this.mesh;
    const mesh = new Mesh({
      self: { id: this.profile.id, name: this.profile.name, avatar: '', accent: this.profile.color },
      board: { id: this.meta.id, name: this.meta.name },
      transport: this._transport(),
      host,
    });
    this.mesh = mesh;
    mesh.on('members', () => this.emit('people', this.people));
    mesh.on('link-open', ({ peerId, link }) => this._onPeer(peerId, link));
    mesh.on('link-close', ({ peerId }) => {
      this.media?.detach(peerId);
      this.emit('cursor', { id: peerId, gone: true });
    });
    mesh.on('message', (m) => this._onMessage(m));
    mesh.on('held', ({ peerId }) => this._onHeld(peerId));
    mesh.on('full', (info) => this.emit('notice', { kind: 'full', ...info }));
    mesh.on('rejected', (info) => this.emit('notice', { kind: 'rejected', ...info }));
    mesh.on('refused', () => this._pairFailed('refused'));
    mesh.on('link-failed', ({ link }) => {
      if (this.pairing && !this.pairing.done) this._pairFailed(link?.diagnose?.(navigator.onLine) || 'timeout');
    });
    mesh.on('welcome', ({ board }) => {
      if (board?.name && board.name !== this.meta.name) {
        this.meta.name = cleanName(board.name);
        db.putBoard(this.meta);
        this.emit('board', this.meta);
      }
    });
    return mesh;
  }

  /** A peer is in: send the whole board and say which pictures I have. */
  _onPeer(peerId, link) {
    this.emit('people', this.people);
    if (link) {
      // The peer with the larger id gives way when both renegotiate media at once.
      link.polite = this.profile.id > peerId;
      this.media?.attach(peerId, link);
    }
    for (const part of this.board.stateParts()) this.mesh.sendTo(peerId, { type: 'state', board: this.meta.id, state: part });
    for (const part of chatParts(this.chat.toState())) this.mesh.sendTo(peerId, { type: 'chat-state', board: this.meta.id, state: part });
  }

  // ---------- Chat ----------

  /** Sends a chat message, optionally as a reply. Returns the message. */
  say(text, reply = null) {
    const msg = { id: this.newId(), from: this.profile.id, name: this.profile.name, color: this.profile.color, text, reply, ts: Date.now() };
    if (!this.chat.add(msg)) return null;
    this.broadcast({ type: 'chat', board: this.meta.id, msg: this.chat.get(msg.id) });
    return msg;
  }

  /** Switches my reaction on a message. */
  react(msgId, key) {
    const op = this.chat.toggle(msgId, key, this.profile.id);
    this.broadcast({ type: 'react', board: this.meta.id, op });
  }

  async _onMessage({ from, body }) {
    if (!body || typeof body !== 'object') return;
    switch (body.type) {
      case 'ops':
        if (body.board === this.meta?.id && Array.isArray(body.ops)) this.board.applyAll(body.ops.slice(0, 5000));
        return;
      case 'state':
        if (body.board !== this.meta?.id) return;
        try {
          this.board.mergeState(body.state);
        } catch {
          return;
        }
        this._askMissing(from);
        return;
      case 'chat':
        if (body.board === this.meta?.id && this.chat.add(body.msg)) this.emit('chat-message', this.chat.get(body.msg?.id));
        return;
      case 'react':
        if (body.board === this.meta?.id) this.chat.react(body.op);
        return;
      case 'chat-state':
        if (body.board === this.meta?.id) this.chat.merge(body.state);
        return;
      case 'voice':
        this.media?.peerState(from, body);
        return;
      case 'cur':
        this.emit('cursor', { id: from, x: Number(body.x), y: Number(body.y), gone: !!body.gone });
        return;
      case 'need':
        for (const h of (body.hs || []).slice(0, 20)) if (await db.hasBlob(String(h))) this.sendBlob(String(h), from);
        return;
      case 'blob': {
        const done = await this.assembler.push(body);
        if (done && !(await db.hasBlob(done.hash))) {
          await images.store(done.hash, done.mime, done.bytes);
          this.emit('image', done.hash);
        }
        return;
      }
      case 'name':
        if (body.board === this.meta?.id && typeof body.name === 'string') {
          this.meta.name = cleanName(body.name);
          await db.putBoard(this.meta);
          this.emit('board', this.meta);
        }
        return;
      case 'pair':
        if (this.pairing?.role === 'joiner' && from === this.pairing.peer) {
          if (body.ok) {
            this.pairing.done = true;
            this.pairing.stage = 'done';
            this.emit('pairing', this.pairing);
          } else this._pairFailed('words');
        }
        return;
      default:
    }
  }

  async _askMissing(from) {
    const missing = [];
    for (const el of this.board.visible()) if (el.type === 'image' && el.src && !(await db.hasBlob(el.src))) missing.push(el.src);
    if (missing.length) this.mesh?.sendTo(from, { type: 'need', hs: [...new Set(missing)].slice(0, 20) });
  }

  // ---------- Pairing ----------

  _confirmFor(peerId, nonce) {
    const link = this.mesh?.links.get(peerId) || this.mesh?.held.get(peerId);
    const local = sdpFingerprints(link?.pc?.localDescription?.sdp).join(',');
    const remote = sdpFingerprints(link?.pc?.remoteDescription?.sdp).join(',');
    if (!local || !remote) {
      console.warn('doodleduo: no fingerprints yet', !!link, link?.pc?.signalingState);
      return null;
    }
    return confirmWords(local, remote, nonce);
  }

  /** Starts an invite: six words, an invite link and a QR code of that link. Emits 'pairing' as it moves along. */
  async invite(appUrl) {
    this.stopPairing();
    const mesh = this._ensureMesh(true);
    if (mesh.full) {
      this.emit('notice', { kind: 'full', max: MAX_MEMBERS, count: mesh.onlineCount() });
      return null;
    }
    const nonce = randomId(12);
    const offer = (async () => {
      const { inviteId, sdp } = await mesh.createInvite();
      const code = await packCode(invitePayload({ inviteId, board: { id: this.meta.id, name: this.meta.name }, host: { id: this.profile.id, name: this.profile.name, avatar: '' }, sdp }));
      return { invite: code, nonce };
    })();
    const creator = new CodeCreator(offer);
    const pairing = { role: 'creator', creator, nonce, stage: 'starting', attempts: 0, relays: 0, relaysTotal: 0 };
    this.pairing = pairing;
    creator.on('status', (s) => {
      pairing.relays = s.connected.length;
      pairing.relaysTotal = s.total;
      this.emit('pairing', pairing);
    });
    creator.on('expired', () => {
      if (this.pairing === pairing && !pairing.done) this._pairFailed('expired');
    });
    creator.on('answer', async (msg) => {
      if (this.pairing !== pairing) return;
      try {
        const reply = readReply(await unpackCode(String(msg.reply || '')));
        pairing.peer = reply.peer.id;
        pairing.peerName = reply.peer.name;
        pairing.stage = 'connecting';
        this.emit('pairing', pairing);
        await mesh.acceptReply(reply, { hold: true });
      } catch (err) {
        this._pairFailed('damaged', err.message);
      }
    });
    try {
      const words = await creator.start();
      if (this.pairing !== pairing) return null;
      pairing.words = words;
      pairing.expires = creator.expires;
      // The link carries the same six words in its hash, and the QR code carries the link.
      pairing.link = wordsLink(appUrl, words);
      pairing.qr = qrSvg(encodeQR(pairing.link, { ecl: 'M' }), { margin: 2, dark: '#101317', light: '#f4f2ec', title: 'QR code with the invite link' });
      pairing.stage = 'waiting';
      this.emit('pairing', pairing);
      return pairing;
    } catch (err) {
      this._pairFailed('relays', err.message);
      return null;
    }
  }

  _onHeld(peerId) {
    const p = this.pairing;
    if (!p || p.role !== 'creator' || p.peer !== peerId) {
      this.mesh.refuse(peerId, 'unexpected');
      return;
    }
    p.expected = this._confirmFor(peerId, p.nonce);
    p.stage = 'confirm';
    p.creator.stop();
    this.emit('pairing', p);
  }

  /** The inviter typed the words on the friend's screen. Returns 'ok', 'wrong' or 'refused'. */
  confirm(words) {
    const p = this.pairing;
    if (!p || p.role !== 'creator' || p.stage !== 'confirm') return 'wrong';
    p.expected ??= this._confirmFor(p.peer, p.nonce);
    if (!p.expected) return 'wrong';
    if (words.join(' ') === p.expected.join(' ')) {
      p.done = true;
      p.stage = 'done';
      this.mesh.sendTo(p.peer, { type: 'pair', ok: true });
      this.mesh.release(p.peer);
      this.emit('pairing', p);
      return 'ok';
    }
    p.attempts++;
    if (p.attempts >= 3) {
      this.mesh.sendTo(p.peer, { type: 'pair', ok: false });
      this.mesh.refuse(p.peer, 'words');
      this._pairFailed('words');
      return 'refused';
    }
    this.emit('pairing', p);
    return 'wrong';
  }

  /** Joins a friend's board with their six words. switchTo(board) opens that board here first. */
  async join(words, switchTo) {
    this.stopPairing();
    const joiner = new CodeJoiner();
    const pairing = { role: 'joiner', joiner, stage: 'finding', relays: 0, relaysTotal: 0 };
    this.pairing = pairing;
    joiner.on('status', (s) => {
      pairing.relays = s.connected.length;
      pairing.relaysTotal = s.total;
      this.emit('pairing', pairing);
    });
    joiner.on('timeout', () => {
      if (this.pairing === pairing && !pairing.peer) this._pairFailed('nobody');
    });
    joiner.on('offer', async (msg) => {
      if (this.pairing !== pairing) return;
      try {
        const invite = readInvite(await unpackCode(String(msg.invite || '')));
        pairing.nonce = String(msg.nonce || '').slice(0, 64);
        pairing.peer = invite.host.id;
        pairing.peerName = invite.host.name;
        pairing.stage = 'connecting';
        this.emit('pairing', pairing);
        await switchTo(invite.board, { keepPairing: true });
        if (this.pairing !== pairing) return;
        const mesh = this._ensureMesh(false);
        mesh.on('link-open', ({ peerId }) => {
          if (peerId !== pairing.peer || pairing.expected) return;
          pairing.expected = this._confirmFor(peerId, pairing.nonce);
          pairing.stage = 'show';
          joiner.stop();
          this.emit('pairing', pairing);
        });
        const reply = await mesh.acceptInvite(invite);
        joiner.sendAnswer({ reply: await packCode(replyPayload(reply)) });
      } catch (err) {
        this._pairFailed('damaged', err.message);
      }
    });
    try {
      await joiner.start(words);
    } catch (err) {
      this._pairFailed('relays', err.message);
    }
    return pairing;
  }

  _pairFailed(reason, detail = '') {
    const p = this.pairing;
    if (!p) return;
    p.stage = 'failed';
    p.reason = reason;
    p.detail = detail;
    p.creator?.stop();
    p.joiner?.stop();
    this.emit('pairing', p);
  }

  /** Cancels a pairing in progress (the board connection, if any, stays). */
  stopPairing() {
    const p = this.pairing;
    if (!p) return;
    p.creator?.stop();
    p.joiner?.stop();
    if (!p.done && p.peer && this.mesh?.held.has(p.peer)) this.mesh.refuse(p.peer, 'cancelled');
    this.pairing = null;
  }

  /** Leaves the people on this board (the board itself stays on this device). */
  leave() {
    this.stopPairing();
    this._leaveMesh();
  }

  _leaveMesh() {
    this.media?.leave();
    this.flush();
    if (this.mesh) {
      this.mesh.leave();
      this.mesh = null;
      this.emit('people', this.people);
    }
  }
}

/** Splits a chat state into parts of at most maxChars of JSON. */
export function chatParts(state, maxChars = 100000) {
  const parts = [];
  let cur = { messages: [], reactions: [] };
  let size = 0;
  const push = (kind, item) => {
    const n = JSON.stringify(item).length;
    if (size + n > maxChars && (cur.messages.length || cur.reactions.length)) {
      parts.push(cur);
      cur = { messages: [], reactions: [] };
      size = 0;
    }
    cur[kind].push(item);
    size += n;
  };
  for (const m of state.messages) push('messages', m);
  for (const r of state.reactions) push('reactions', r);
  if (cur.messages.length || cur.reactions.length) parts.push(cur);
  return parts;
}

export { CODE_LIFETIME_MS, MAX_MEMBERS };

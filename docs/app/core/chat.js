// Copied from src/ by scripts/sync-core.mjs. Edit the file in src/ instead.
// The chat next to the board. Messages are a grow only set keyed by id, so they merge in any
// order; a reply names the message it answers. Reactions are last writer wins switches per
// message, reaction and person, stamped with a Lamport time, so a quick on and off from two
// screens settles the same way everywhere. A late joiner merges the whole log.

export const REACTIONS = ['heart', 'laugh', 'thumbs', 'wow', 'sparkle'];
export const MAX_TEXT = 2000;
export const MAX_MESSAGES = 500;

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
const color = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#9fb4c9');

/** A clean message, or null. */
export function cleanMessage(m) {
  if (!m || typeof m !== 'object' || !validId(m.id) || !validId(m.from)) return null;
  const text = typeof m.text === 'string' ? m.text.replace(/\r\n?/g, '\n').slice(0, MAX_TEXT).trim() : '';
  if (!text) return null;
  return {
    id: m.id,
    from: m.from,
    name: String(m.name || '').slice(0, 32) || 'friend',
    color: color(m.color),
    text,
    reply: validId(m.reply) ? m.reply : null,
    ts: Number.isFinite(m.ts) ? Math.round(m.ts) : 0,
  };
}

export class ChatLog {
  constructor() {
    this.messages = new Map();
    this.reactions = new Map(); // `${msg}|${key}|${by}` -> { on, t, r }
    this.clock = 0;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _changed() {
    for (const fn of this.listeners) fn();
  }

  /** Adds a message. Returns true when it is new. */
  add(m, notify = true) {
    const msg = cleanMessage(m);
    if (!msg || this.messages.has(msg.id)) return false;
    this.messages.set(msg.id, msg);
    if (this.messages.size > MAX_MESSAGES) {
      const oldest = this.list()[0];
      this.messages.delete(oldest.id);
    }
    if (notify) this._changed();
    return true;
  }

  /** A local reaction switch. Returns the operation to send. */
  toggle(msg, key, by) {
    const cur = this.reactions.get(`${msg}|${key}|${by}`);
    const op = { msg, key, by, on: !cur?.on, t: ++this.clock };
    this.react(op);
    return op;
  }

  /** Applies a reaction operation. Returns true when it changed anything. */
  react(op, notify = true) {
    if (!op || !validId(op.msg) || !validId(op.by) || !REACTIONS.includes(op.key) || !Number.isInteger(op.t) || op.t < 1) return false;
    if (op.t > this.clock) this.clock = op.t;
    const k = `${op.msg}|${op.key}|${op.by}`;
    const cur = this.reactions.get(k);
    if (cur && (cur.t > op.t || (cur.t === op.t && cur.r >= op.by))) return false;
    this.reactions.set(k, { on: !!op.on, t: op.t, r: op.by });
    if (notify) this._changed();
    return true;
  }

  /** Messages, oldest first. */
  list() {
    return [...this.messages.values()].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  }

  get(id) {
    return this.messages.get(id) || null;
  }

  /** [{ key, count, mine }] for one message, in the fixed order of REACTIONS. */
  reactionsOf(msgId, me) {
    const out = [];
    for (const key of REACTIONS) {
      let count = 0;
      let mine = false;
      for (const [k, v] of this.reactions) {
        if (!v.on) continue;
        const [m, rk, by] = k.split('|');
        if (m === msgId && rk === key) {
          count++;
          if (by === me) mine = true;
        }
      }
      if (count) out.push({ key, count, mine });
    }
    return out;
  }

  toState() {
    return {
      messages: this.list(),
      reactions: [...this.reactions].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => {
        const [msg, key, by] = k.split('|');
        return { msg, key, by, on: v.on, t: v.t };
      }),
    };
  }

  merge(state) {
    let changed = false;
    for (const m of state?.messages || []) changed = this.add(m, false) || changed;
    for (const r of state?.reactions || []) changed = this.react(r, false) || changed;
    if (changed) this._changed();
    return changed;
  }

  fingerprint() {
    return JSON.stringify(this.toState());
  }
}

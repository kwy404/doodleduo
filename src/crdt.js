// The board as a CRDT: every replica can change it at any time, offline or not, and replicas
// that have seen the same operations hold the same board, in whatever order they arrived.
//
// - Each element is a map of fields. Each field is a last writer wins register stamped with a
//   Lamport time and the replica id, so two people can move and recolor the same shape at once
//   and both changes survive. Ties on time are broken by replica id, the same way everywhere.
// - Deleting is a field too (del), so undoing a delete is just a newer write.
// - The points of a pen stroke are an ordered list that only its author appends to. Every point
//   has a fixed index, so chunks may arrive late, twice or out of order and still line up.
// - Merging a whole state (a late joiner, a board file) applies the same rules field by field.

export const STATE_VERSION = 1;
export const TYPES = ['pen', 'hl', 'rect', 'ellipse', 'line', 'arrow', 'text', 'note', 'image'];
export const STROKE_TYPES = new Set(['pen', 'hl']);
export const MAX_POINTS = 20000;
const LIMIT = 1e7;

const num = (v, min = -LIMIT, max = LIMIT) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Field rules: each returns the cleaned value, or undefined to drop it. */
export const FIELDS = {
  type: (v) => (TYPES.includes(v) ? v : undefined),
  x: (v) => num(v),
  y: (v) => num(v),
  w: (v) => num(v),
  h: (v) => num(v),
  m: (v) => (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [num(v[0], 1e-3, 1e3), num(v[1], 1e-3, 1e3), num(v[2]), num(v[3])] : undefined),
  color: (v) => (v === 'ink' || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v.toLowerCase() : undefined),
  size: (v) => num(v, 0.5, 200),
  fs: (v) => num(v, 4, 800),
  fill: (v) => (typeof v === 'boolean' ? v : undefined),
  text: (v) => str(v, 5000),
  src: (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : undefined),
  z: (v) => num(v, -1e12, 1e12),
  del: (v) => (typeof v === 'boolean' ? v : undefined),
  end: (v) => (typeof v === 'boolean' ? v : undefined),
  by: (v) => (typeof v === 'string' && v.length <= 40 ? v : undefined),
  // Locked elements cannot be selected, moved or erased until someone unlocks them.
  lock: (v) => (typeof v === 'boolean' ? v : undefined),
  // Elements that share a group id are selected together. An empty string means no group.
  grp: (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{0,40}$/.test(v) ? v : undefined),
};

/** Cleans a set of fields, dropping unknown names and bad values. */
export function cleanFields(fields) {
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [name, value] of Object.entries(fields)) {
    const rule = Object.hasOwn(FIELDS, name) ? FIELDS[name] : null;
    const v = rule ? rule(value) : undefined;
    if (v !== undefined) out[name] = v;
  }
  return out;
}

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
const validReplica = (r) => typeof r === 'string' && r.length > 0 && r.length <= 40;

/** True when stamp a = (t, r) is newer than stamp b. */
export function newer(t1, r1, t2, r2) {
  return t1 !== t2 ? t1 > t2 : r1 > r2;
}

/** Rounds a coordinate so states stay small and every replica stores the same number. */
export const round = (n) => Math.round(n * 100) / 100;

export class Board {
  constructor(replica) {
    if (!validReplica(replica)) throw new TypeError('A replica needs an id');
    this.replica = replica;
    this.clock = 0;
    this.elements = new Map();
    this.listeners = new Set();
  }

  /** Calls fn(ids) after every change with the set of element ids that changed. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _changed(ids) {
    if (!ids.size) return;
    for (const fn of this.listeners) fn(ids);
  }

  _entry(id) {
    let e = this.elements.get(id);
    if (!e) {
      e = { f: new Map(), p: [] };
      this.elements.set(id, e);
    }
    return e;
  }

  /** The next Lamport time for a local write. */
  tick() {
    return ++this.clock;
  }

  // Local changes. Each returns the operation to send to the other replicas.

  /** Creates an element. fields must hold a type. Returns { op, id }. */
  create(id, fields) {
    const t = this.tick();
    const op = { k: 's', id, t, r: this.replica, f: cleanFields({ z: t, del: false, by: this.replica, ...fields }) };
    if (!op.f.type) throw new TypeError('An element needs a type');
    this.apply(op);
    return op;
  }

  /** Writes fields of an element. Returns { op, before } where before has the old registers. */
  change(id, fields) {
    const e = this.elements.get(id);
    const before = {};
    const f = cleanFields(fields);
    for (const name of Object.keys(f)) before[name] = e?.f.get(name) ? { ...e.f.get(name) } : undefined;
    const op = { k: 's', id, t: this.tick(), r: this.replica, f };
    this.apply(op);
    return { op, before };
  }

  /** Appends points [x, y, pressure, ...] to a stroke this replica owns. Returns the op. */
  addPoints(id, flat) {
    const e = this._entry(id);
    const op = { k: 'p', id, i: e.p.length / 3, d: flat.map(round) };
    this.apply(op);
    return op;
  }

  // Remote and local operations.

  /** Applies an operation. Returns true when it changed anything. Bad operations are ignored. */
  apply(op, ids = null) {
    const own = !ids;
    ids ??= new Set();
    if (!op || !validId(op.id)) return false;
    if (op.k === 's') {
      if (!Number.isInteger(op.t) || op.t < 1 || !validReplica(op.r)) return false;
      if (op.t > this.clock) this.clock = op.t;
      const f = cleanFields(op.f);
      const e = this._entry(op.id);
      let changed = false;
      for (const [name, v] of Object.entries(f)) {
        const cur = e.f.get(name);
        if (cur && !newer(op.t, op.r, cur.t, cur.r)) continue;
        if (name === 'type' && cur) continue; // the type of an element never changes
        e.f.set(name, { v, t: op.t, r: op.r });
        changed = true;
      }
      if (changed) ids.add(op.id);
    } else if (op.k === 'p') {
      if (!Number.isInteger(op.i) || op.i < 0 || !Array.isArray(op.d) || op.d.length % 3) return false;
      if (op.i + op.d.length / 3 > MAX_POINTS) return false;
      if (!op.d.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMIT)) return false;
      const e = this._entry(op.id);
      let changed = false;
      for (let k = 0; k < op.d.length; k++) {
        const at = op.i * 3 + k;
        if (e.p[at] === undefined) {
          e.p[at] = op.d[k];
          changed = true;
        }
      }
      if (changed) ids.add(op.id);
    } else return false;
    if (own) this._changed(ids);
    return ids.size > 0;
  }

  /** Applies many operations and reports the changes once. */
  applyAll(ops) {
    const ids = new Set();
    for (const op of ops || []) this.apply(op, ids);
    this._changed(ids);
    return ids;
  }

  // Reading.

  /** The element as a plain object, with points as [[x, y, p], ...], or null. */
  get(id) {
    const e = this.elements.get(id);
    if (!e || !e.f.has('type')) return null;
    const out = { id };
    for (const name of [...e.f.keys()].sort()) out[name] = e.f.get(name).v;
    if (STROKE_TYPES.has(out.type)) out.points = contiguous(e.p);
    return out;
  }

  /** The register (value, time, replica) behind one field. */
  register(id, name) {
    return this.elements.get(id)?.f.get(name) || null;
  }

  /** Elements that are not deleted, bottom first. */
  visible() {
    const out = [];
    for (const id of this.elements.keys()) {
      const el = this.get(id);
      if (el && !el.del) out.push(el);
    }
    return out.sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The highest z in use, for bringing an element to the front. */
  topZ() {
    let z = 0;
    for (const e of this.elements.values()) z = Math.max(z, e.f.get('z')?.v ?? 0);
    return z;
  }

  /** The lowest z in use, for sending an element to the back. */
  bottomZ() {
    let z = 0;
    for (const e of this.elements.values()) z = Math.min(z, e.f.get('z')?.v ?? 0);
    return z;
  }

  // Whole states, for late joiners and board files.

  /** Plain, canonical state: elements sorted by id, fields by name, points as runs. */
  toState() {
    const ids = [...this.elements.keys()].sort();
    const elements = [];
    for (const id of ids) {
      const e = this.elements.get(id);
      const f = {};
      for (const name of [...e.f.keys()].sort()) {
        const reg = e.f.get(name);
        f[name] = [reg.v, reg.t, reg.r];
      }
      const item = [id, f];
      const runs = pointRuns(e.p);
      if (runs.length) item.push(runs);
      elements.push(item);
    }
    return { v: STATE_VERSION, elements };
  }

  /** Splits the state into parts of at most maxChars of JSON, for small network messages. */
  stateParts(maxChars = 120000) {
    const parts = [];
    let cur = [];
    let size = 0;
    for (const item of this.toState().elements) {
      const n = JSON.stringify(item).length;
      if (cur.length && size + n > maxChars) {
        parts.push({ v: STATE_VERSION, elements: cur });
        cur = [];
        size = 0;
      }
      cur.push(item);
      size += n;
    }
    if (cur.length) parts.push({ v: STATE_VERSION, elements: cur });
    return parts;
  }

  /** Merges a state from toState. Returns the set of changed ids. Throws on a newer version. */
  mergeState(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.elements)) throw new TypeError('Not a board state');
    if (state.v !== STATE_VERSION) throw new RangeError(`Board state version ${state.v} is not supported`);
    const ids = new Set();
    for (const item of state.elements) {
      if (!Array.isArray(item) || !validId(item[0]) || !item[1] || typeof item[1] !== 'object') continue;
      const [id, fields, runs] = item;
      for (const [name, reg] of Object.entries(fields)) {
        if (!Array.isArray(reg) || reg.length !== 3) continue;
        this.apply({ k: 's', id, t: reg[1], r: reg[2], f: { [name]: reg[0] } }, ids);
      }
      if (Array.isArray(runs)) for (const run of runs) if (Array.isArray(run)) this.apply({ k: 'p', id, i: run[0], d: run.slice(1) }, ids);
    }
    this._changed(ids);
    return ids;
  }

  /** A short canonical text of the whole board, equal on replicas that converged. */
  fingerprint() {
    return JSON.stringify(this.toState().elements);
  }
}

/** Points up to the first gap, as [[x, y, p], ...]. */
export function contiguous(flat) {
  const out = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    if (flat[i] === undefined || flat[i + 1] === undefined || flat[i + 2] === undefined) break;
    out.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  return out;
}

/** Sparse flat points as runs [startIndex, x, y, p, ...] of known points. */
export function pointRuns(flat) {
  const runs = [];
  let run = null;
  for (let i = 0; i < flat.length; i += 3) {
    const known = flat[i] !== undefined && flat[i + 1] !== undefined && flat[i + 2] !== undefined;
    if (known) {
      if (!run) {
        run = [i / 3];
        runs.push(run);
      }
      run.push(flat[i], flat[i + 1], flat[i + 2]);
    } else run = null;
  }
  return runs;
}

/**
 * Undo and redo for one person. Every entry is a group of changes this replica made. Undo
 * writes the old values back as a new change, so it travels like any other edit, and it only
 * touches fields whose current value was written by this person: a field someone else changed
 * since is left alone.
 */
export class History {
  constructor(board, { limit = 200 } = {}) {
    this.board = board;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Records a group of { op, before } results (or create ops) as one undo step. */
  record(results) {
    const changes = [];
    for (const r of [].concat(results)) {
      if (!r) continue;
      const op = r.op || r;
      if (op.k !== 's') continue;
      changes.push({ id: op.id, t: op.t, before: r.before || {}, after: op.f });
    }
    if (!changes.length) return;
    this.undoStack.push(changes);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  _revert(changes, pick) {
    const ops = [];
    const next = [];
    for (const c of changes) {
      const fields = {};
      for (const name of Object.keys(c.after)) {
        const reg = this.board.register(c.id, name);
        if (!reg || reg.r !== this.board.replica) continue; // someone else wrote it since
        const v = pick(c, name);
        if (v !== undefined) fields[name] = v;
      }
      if (!Object.keys(fields).length) continue;
      const { op, before } = this.board.change(c.id, fields);
      ops.push(op);
      next.push({ id: c.id, t: op.t, before, after: op.f, prior: c });
    }
    return { ops, next };
  }

  /** Undoes the newest step that still has an effect. Returns the ops to send. */
  undo() {
    while (this.undoStack.length) {
      const changes = this.undoStack.pop();
      const { ops, next } = this._revert(changes, (c, name) => (c.before[name] ? c.before[name].v : name === 'del' ? true : undefined));
      if (ops.length) {
        this.redoStack.push(next);
        return ops;
      }
    }
    return [];
  }

  /** Redoes the step undone last. Returns the ops to send. */
  redo() {
    while (this.redoStack.length) {
      const changes = this.redoStack.pop();
      const { ops, next } = this._revert(changes, (c, name) => c.prior.after[name]);
      if (ops.length) {
        this.undoStack.push(next.map((n) => ({ id: n.id, t: n.t, before: n.before, after: n.after })));
        return ops;
      }
    }
    return [];
  }
}

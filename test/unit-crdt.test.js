import { describe, expect, it } from 'vitest';
import { Board, FIELDS, History, MAX_POINTS, cleanFields, contiguous, newer, pointRuns } from '../src/crdt.js';

// A small seeded generator so a failing seed can be replayed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Three replicas edit at random while a lossy, reordering, duplicating network sits between
 * them. Nothing is lost for good: undelivered messages are flushed at the end, in random
 * order, and one replica also merges another's whole state like a late joiner would.
 */
function simulate(seed, steps = 300) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const names = ['ana', 'bia', 'caio'];
  const boards = names.map((n) => new Board(n));
  const histories = boards.map((b) => new History(b));
  const queues = boards.map(() => []); // inbox per replica
  const own = boards.map(() => []); // strokes each replica created
  let next = 0;
  const send = (from, ops) => {
    for (let i = 0; i < boards.length; i++) {
      if (i === from) continue;
      for (const op of [].concat(ops)) {
        queues[i].push(op);
        if (random() < 0.1) queues[i].push(op); // duplicate
      }
    }
  };
  const deliverSome = (i) => {
    const q = queues[i];
    const n = Math.floor(random() * (q.length + 1));
    for (let k = 0; k < n && q.length; k++) {
      const at = Math.floor(random() * q.length); // out of order
      boards[i].apply(q.splice(at, 1)[0]);
    }
  };
  for (let step = 0; step < steps; step++) {
    const i = Math.floor(random() * boards.length);
    const b = boards[i];
    const ids = [...b.elements.keys()].filter((id) => b.get(id));
    const roll = random();
    if (roll < 0.2 || !ids.length) {
      const id = `${names[i]}${next++}`;
      const type = pick(['pen', 'hl', 'rect', 'ellipse', 'arrow', 'text', 'note']);
      const op = b.create(id, { type, x: Math.round(random() * 500), y: Math.round(random() * 500), w: 40, h: 30, color: pick(['ink', '#9fb4c9', '#c9a3a6']), size: 3, text: type === 'text' || type === 'note' ? 'hi' : undefined });
      histories[i].record(op);
      send(i, op);
      if (type === 'pen' || type === 'hl') own[i].push(id);
    } else if (roll < 0.35 && own[i].length) {
      const id = pick(own[i]);
      const pts = [];
      for (let k = 0; k < 1 + Math.floor(random() * 5); k++) pts.push(random() * 400, random() * 400, random());
      send(i, b.addPoints(id, pts));
    } else if (roll < 0.6) {
      const id = pick(ids);
      const r = b.change(id, pick([{ x: Math.round(random() * 900) }, { color: pick(['#a9bf9f', '#d8c08f', 'ink']) }, { text: `t${step}` }, { z: b.topZ() + 1 }, { m: [1 + random(), 1, random() * 10, 0] }]));
      histories[i].record(r);
      send(i, r.op);
    } else if (roll < 0.7) {
      const r = b.change(pick(ids), { del: true });
      histories[i].record(r);
      send(i, r.op);
    } else if (roll < 0.8) {
      send(i, histories[i].undo());
    } else if (roll < 0.85) {
      send(i, histories[i].redo());
    } else {
      deliverSome(i);
    }
  }
  // A late joiner style full state merge before the final flush.
  boards[2].mergeState(boards[0].toState());
  for (let i = 0; i < boards.length; i++) {
    const q = queues[i];
    while (q.length) boards[i].apply(q.splice(Math.floor(random() * q.length), 1)[0]);
  }
  return boards;
}

describe('convergence', () => {
  it('three replicas with random concurrent edits end with the same board, for many seeds', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const [a, b, c] = simulate(seed);
      const fa = a.fingerprint();
      expect(b.fingerprint(), `seed ${seed}`).toBe(fa);
      expect(c.fingerprint(), `seed ${seed}`).toBe(fa);
      expect(JSON.stringify(b.visible())).toBe(JSON.stringify(a.visible()));
      expect(a.visible().length + [...a.elements.values()].filter((e) => e.f.get('del')?.v).length).toBeGreaterThan(0);
    }
  });

  it('gives the same result whatever order the operations arrive in', () => {
    const src = new Board('src');
    const ops = [src.create('e1', { type: 'rect', x: 1, y: 2, w: 3, h: 4 })];
    ops.push(src.change('e1', { x: 10 }).op, src.change('e1', { color: '#9fb4c9' }).op, src.change('e1', { del: true }).op, src.change('e1', { del: false }).op);
    const random = rng(7);
    const reference = new Board('ref');
    reference.applyAll(ops);
    for (let n = 0; n < 30; n++) {
      const shuffled = ops.slice().sort(() => random() - 0.5);
      const b = new Board(`r${n}`);
      b.applyAll(shuffled);
      expect(b.fingerprint()).toBe(reference.fingerprint());
    }
  });

  it('keeps both of two concurrent edits to different fields', () => {
    const a = new Board('a');
    const b = new Board('b');
    const create = a.create('n1', { type: 'note', x: 0, y: 0, w: 100, h: 100, text: 'plan' });
    b.apply(create);
    const moveA = a.change('n1', { x: 300 }).op;
    const colorB = b.change('n1', { color: '#c9d8b8' }).op;
    a.apply(colorB);
    b.apply(moveA);
    expect(a.get('n1')).toMatchObject({ x: 300, color: '#c9d8b8' });
    expect(a.fingerprint()).toBe(b.fingerprint());
  });

  it('breaks a tie on the same field by replica id, the same way everywhere', () => {
    const a = new Board('a');
    const b = new Board('b');
    const create = a.create('t1', { type: 'text', x: 0, y: 0, text: 'x' });
    b.apply(create);
    const fromA = a.change('t1', { text: 'from a' }).op;
    const fromB = b.change('t1', { text: 'from b' }).op;
    expect(fromA.t).toBe(fromB.t);
    a.apply(fromB);
    b.apply(fromA);
    expect(a.get('t1').text).toBe('from b');
    expect(b.get('t1').text).toBe('from b');
    expect(newer(5, 'a', 4, 'z')).toBe(true);
    expect(newer(5, 'b', 5, 'a')).toBe(true);
  });

  it('moves the Lamport clock past every time it sees', () => {
    const a = new Board('a');
    a.apply({ k: 's', id: 'x1', t: 41, r: 'z', f: { type: 'rect' } });
    expect(a.clock).toBe(41);
    expect(a.change('x1', { x: 1 }).op.t).toBe(42);
  });
});

describe('stroke points', () => {
  it('places chunks by index, so late, repeated and reordered chunks line up', () => {
    const a = new Board('a');
    a.create('s1', { type: 'pen', color: 'ink', size: 4 });
    const p1 = a.addPoints('s1', [0, 0, 0.5, 1, 1, 0.5]);
    const p2 = a.addPoints('s1', [2, 2, 0.5]);
    const p3 = a.addPoints('s1', [3, 3, 0.5, 4, 4, 0.5]);
    expect(p3.i).toBe(3);
    const b = new Board('b');
    b.applyAll([p3, p1, p3]);
    expect(b.get('s1')).toBeNull(); // no type yet: nothing to draw
    b.apply({ k: 's', id: 's1', t: 1, r: 'a', f: { type: 'pen' } });
    expect(b.get('s1').points).toHaveLength(2); // the gap at index 2 stops the line
    b.apply(p2);
    expect(b.get('s1').points.map((p) => p[0])).toEqual([0, 1, 2, 3, 4]);
    expect(b.toState().elements[0][2]).toEqual([[0, 0, 0, 0.5, 1, 1, 0.5, 2, 2, 0.5, 3, 3, 0.5, 4, 4, 0.5]]);
  });

  it('rounds coordinates and keeps the first value written at an index', () => {
    const a = new Board('a');
    a.create('s1', { type: 'pen' });
    a.addPoints('s1', [1.23456, 2.98765, 0.33333]);
    a.apply({ k: 'p', id: 's1', i: 0, d: [9, 9, 9] });
    expect(a.get('s1').points).toEqual([[1.23, 2.99, 0.33]]);
  });

  it('describes sparse points as runs and reads them back', () => {
    const flat = [];
    flat[0] = 1;
    flat[1] = 2;
    flat[2] = 0.5;
    flat[9] = 7;
    flat[10] = 8;
    flat[11] = 0.4;
    expect(pointRuns(flat)).toEqual([[0, 1, 2, 0.5], [3, 7, 8, 0.4]]);
    expect(contiguous(flat)).toEqual([[1, 2, 0.5]]);
  });

  it('refuses chunks past the point limit and bad numbers', () => {
    const a = new Board('a');
    expect(a.apply({ k: 'p', id: 's1', i: MAX_POINTS, d: [1, 1, 1] })).toBe(false);
    expect(a.apply({ k: 'p', id: 's1', i: 0, d: [1, NaN, 1] })).toBe(false);
    expect(a.apply({ k: 'p', id: 's1', i: 0, d: [1, 1] })).toBe(false);
  });
});

describe('validation', () => {
  it('drops unknown fields and bad values from peers', () => {
    expect(cleanFields({ type: 'rect', x: 1, evil: '<script>', color: 'red', size: 1e9, src: 'x', text: 5 })).toEqual({ type: 'rect', x: 1, size: 200 });
    expect(FIELDS.color('#9FB4C9')).toBe('#9fb4c9');
    expect(FIELDS.m([1, 1, 0])).toBeUndefined();
    expect(FIELDS.m([0, 5000, 1, 2])).toEqual([1e-3, 1e3, 1, 2]);
    expect(FIELDS.text('a'.repeat(6000))).toHaveLength(5000);
  });

  it('keeps the lock and group fields, and drops bad ones', () => {
    expect(cleanFields({ lock: true, grp: 'g1abc' })).toEqual({ lock: true, grp: 'g1abc' });
    expect(cleanFields({ lock: 'yes', grp: 'no spaces!' })).toEqual({});
    expect(FIELDS.grp('')).toBe('');
    const a = new Board('a');
    a.create('e1', { type: 'rect', z: 3 });
    a.create('e2', { type: 'rect', z: -2 });
    a.change('e1', { lock: true, grp: 'g1' });
    expect(a.get('e1')).toMatchObject({ lock: true, grp: 'g1' });
    expect(a.bottomZ()).toBe(-2);
    expect(a.topZ()).toBe(3);
  });

  it('ignores malformed operations', () => {
    const a = new Board('a');
    for (const op of [null, {}, { k: 's', id: 'bad id!', t: 1, r: 'x', f: { type: 'rect' } }, { k: 's', id: 'ok1', t: 0, r: 'x', f: { type: 'rect' } }, { k: 's', id: 'ok1', t: 1.5, r: 'x', f: {} }, { k: 'zzz', id: 'ok1' }]) {
      expect(a.apply(op)).toBe(false);
    }
    expect(a.visible()).toEqual([]);
  });

  it('never changes the type of an element', () => {
    const a = new Board('a');
    a.create('e1', { type: 'rect' });
    a.apply({ k: 's', id: 'e1', t: 99, r: 'z', f: { type: 'image' } });
    expect(a.get('e1').type).toBe('rect');
  });
});

describe('states', () => {
  it('merges a state into an empty replica with the same result', () => {
    const a = new Board('a');
    a.create('e1', { type: 'rect', x: 1 });
    a.create('s1', { type: 'pen' });
    a.addPoints('s1', [1, 1, 0.5, 2, 2, 0.5]);
    a.change('e1', { x: 5 });
    const b = new Board('b');
    const changed = b.mergeState(JSON.parse(JSON.stringify(a.toState())));
    expect([...changed].sort()).toEqual(['e1', 's1']);
    expect(b.fingerprint()).toBe(a.fingerprint());
    expect(b.mergeState(a.toState()).size).toBe(0); // idempotent
    expect(b.clock).toBe(a.clock);
  });

  it('splits a big state into parts that merge to the same board', () => {
    const a = new Board('a');
    for (let i = 0; i < 200; i++) a.create(`e${i}`, { type: 'text', x: i, y: i, text: 'x'.repeat(200) });
    const parts = a.stateParts(5000);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) expect(JSON.stringify(p).length).toBeLessThan(5000 + 400);
    const b = new Board('b');
    for (const p of parts.reverse()) b.mergeState(p);
    expect(b.fingerprint()).toBe(a.fingerprint());
  });

  it('refuses a state from another version', () => {
    expect(() => new Board('a').mergeState({ v: 2, elements: [] })).toThrow(/version 2/);
    expect(() => new Board('a').mergeState({})).toThrow(/Not a board state/);
  });

  it('orders visible elements by z, then by id', () => {
    const a = new Board('a');
    a.create('b', { type: 'rect' });
    a.create('a', { type: 'rect' });
    a.change('b', { z: a.topZ() + 1 });
    expect(a.visible().map((e) => e.id)).toEqual(['a', 'b']);
    a.change('b', { del: true });
    expect(a.visible().map((e) => e.id)).toEqual(['a']);
  });

  it('tells listeners which elements changed', () => {
    const a = new Board('a');
    const seen = [];
    a.onChange((ids) => seen.push([...ids]));
    a.create('e1', { type: 'rect' });
    a.applyAll([{ k: 's', id: 'e2', t: 50, r: 'b', f: { type: 'rect' } }, { k: 's', id: 'e3', t: 51, r: 'b', f: { type: 'note' } }]);
    a.apply({ k: 's', id: 'e2', t: 1, r: 'b', f: { type: 'note' } }); // older: no change, no call
    expect(seen).toEqual([['e1'], ['e2', 'e3']]);
  });
});

describe('undo and redo per person', () => {
  it('undoes a creation, a move and a delete, and redoes them', () => {
    const a = new Board('a');
    const h = new History(a);
    h.record(a.create('e1', { type: 'rect', x: 0 }));
    h.record(a.change('e1', { x: 50 }));
    h.record(a.change('e1', { del: true }));
    expect(a.get('e1').del).toBe(true);
    h.undo();
    expect(a.get('e1')).toMatchObject({ del: false, x: 50 });
    h.undo();
    expect(a.get('e1').x).toBe(0);
    h.undo();
    expect(a.get('e1').del).toBe(true);
    expect(h.canUndo).toBe(false);
    h.redo();
    expect(a.get('e1').del).toBe(false);
    h.redo();
    expect(a.get('e1').x).toBe(50);
    h.undo();
    expect(a.get('e1').x).toBe(0);
  });

  it('only undoes my own change and leaves a later edit by someone else alone', () => {
    const a = new Board('a');
    const b = new Board('b');
    const ha = new History(a);
    const create = b.create('e1', { type: 'note', x: 0, color: '#e6d9a8' });
    a.apply(create);
    const mine = a.change('e1', { x: 100, color: '#c9d8b8' });
    ha.record(mine);
    b.apply(mine.op);
    a.apply(b.change('e1', { x: 999 }).op); // b moves it after me
    const ops = ha.undo();
    expect(a.get('e1')).toMatchObject({ x: 999, color: '#e6d9a8' });
    b.applyAll(ops);
    expect(b.fingerprint()).toBe(a.fingerprint());
  });

  it('records a group of changes as one step', () => {
    const a = new Board('a');
    const h = new History(a);
    a.create('e1', { type: 'rect', x: 0 });
    a.create('e2', { type: 'rect', x: 0 });
    h.record([a.change('e1', { x: 5 }), a.change('e2', { x: 5 })]);
    expect(h.undo()).toHaveLength(2);
    expect(a.get('e1').x + a.get('e2').x).toBe(0);
  });

  it('a new change clears the redo stack', () => {
    const a = new Board('a');
    const h = new History(a);
    h.record(a.create('e1', { type: 'rect' }));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.record(a.create('e2', { type: 'rect' }));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toEqual([]);
  });
});

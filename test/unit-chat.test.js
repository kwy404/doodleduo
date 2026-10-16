import { describe, expect, it } from 'vitest';
import { ChatLog, MAX_MESSAGES, cleanMessage } from '../src/chat.js';

const msg = (id, from, text, ts, reply = null) => ({ id, from, name: from.toUpperCase(), color: '#9fb4c9', text, ts, reply });

describe('chat', () => {
  it('merges messages and replies in any order', () => {
    const a = new ChatLog();
    const b = new ChatLog();
    const m1 = msg('m1', 'ana', 'hi', 1);
    const m2 = msg('m2', 'bia', 'hello', 2, 'm1');
    a.add(m1);
    a.add(m2);
    b.add(m2);
    b.add(m1);
    b.add(m1);
    expect(b.fingerprint()).toBe(a.fingerprint());
    expect(a.list().map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(a.get('m2').reply).toBe('m1');
  });

  it('settles reaction switches the same way on every screen', () => {
    const a = new ChatLog();
    const b = new ChatLog();
    a.add(msg('m1', 'ana', 'hi', 1));
    b.merge(a.toState());
    const on = a.toggle('m1', 'heart', 'bia');
    const off = a.toggle('m1', 'heart', 'bia');
    const laugh = b.toggle('m1', 'laugh', 'ana');
    b.react(off);
    b.react(on);
    a.react(laugh);
    expect(a.fingerprint()).toBe(b.fingerprint());
    expect(a.reactionsOf('m1', 'ana')).toEqual([{ key: 'laugh', count: 1, mine: true }]);
  });

  it('a late joiner merges the whole log', () => {
    const a = new ChatLog();
    a.add(msg('m1', 'ana', 'one', 1));
    a.add(msg('m2', 'ana', 'two', 2));
    a.toggle('m2', 'thumbs', 'ana');
    const c = new ChatLog();
    expect(c.merge(JSON.parse(JSON.stringify(a.toState())))).toBe(true);
    expect(c.fingerprint()).toBe(a.fingerprint());
    expect(c.merge(a.toState())).toBe(false);
  });

  it('cleans what peers send', () => {
    expect(cleanMessage({ id: 'bad id', from: 'a', text: 'x' })).toBeNull();
    expect(cleanMessage({ id: 'm1', from: 'a', text: '   ' })).toBeNull();
    const m = cleanMessage({ id: 'm1', from: 'a', text: 'x'.repeat(3000), color: 'red', name: '', reply: '<b>' });
    expect(m.text).toHaveLength(2000);
    expect(m).toMatchObject({ color: '#9fb4c9', name: 'friend', reply: null });
    const log = new ChatLog();
    expect(log.react({ msg: 'm1', key: 'script', by: 'a', on: true, t: 1 })).toBe(false);
  });

  it('keeps the newest messages when the log is full', () => {
    const log = new ChatLog();
    for (let i = 0; i < MAX_MESSAGES + 5; i++) log.add(msg(`m${i}`, 'ana', 'x', i));
    expect(log.messages.size).toBe(MAX_MESSAGES);
    expect(log.get('m0')).toBeNull();
    expect(log.get(`m${MAX_MESSAGES + 4}`)).not.toBeNull();
  });
});

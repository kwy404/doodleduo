import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DICT, t, bindStore } from '../docs/app/js/i18n.js';

const used = (text) => [...text.matchAll(/\bt\('([a-zA-Z0-9.-]+)'/g)].map((m) => m[1]);

describe('app languages', () => {
  it('has every English text in Portuguese too', () => {
    expect(Object.keys(DICT.pt).sort()).toEqual(Object.keys(DICT.en).sort());
  });

  it('defines every key the app uses', () => {
    const files = ['docs/app/index.html', 'docs/app/js/main.js', 'docs/app/js/words-ui.js'];
    const keys = new Set(files.flatMap((f) => used(readFileSync(f, 'utf8'))));
    for (const reason of ['relays', 'nobody', 'expired', 'words', 'refused', 'damaged', 'timeout', 'no-stun', 'blocked', 'strict-nat', 'offline']) keys.add(`fail.${reason}`);
    const missing = [...keys].filter((k) => !(k in DICT.en) && !k.endsWith('.'));
    expect(missing).toEqual([]);
  });

  it('fills in values and follows the store language', () => {
    const store = { lang: 'en' };
    bindStore(store);
    expect(t('people.live', { n: 3 })).toBe('3 drawing');
    store.lang = 'pt';
    expect(t('people.live', { n: 3 })).toBe('3 desenhando');
    expect(t('nope')).toBe('');
  });
});

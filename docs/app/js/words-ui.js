// Six word inputs with autocomplete from the word list, a whole phrase or an invite link
// pasted into any box spread one word per box (phone keyboards paste through an input event
// with no paste event, so both paths share spread()), the first four letters accepted, single
// typos fixed and a clear state per word.

import { WORDLIST } from '../core/wordlist.js';
import { WORD_COUNT, normalizeWord, resolvePhrase, resolveWord, splitPhrase, suggestWords, wordsFromLink } from '../core/words.js';
import { t } from './i18n.js';

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

let listMade = false;
function ensureDatalist() {
  if (listMade) return;
  listMade = true;
  const list = el('datalist', { id: 'word-list' });
  list.append(...WORDLIST.map((w) => el('option', { value: w })));
  document.body.append(list);
}

/**
 * Builds six inputs inside container. onReady(words) runs when all six resolve and the person
 * presses Enter or finishes the last word. Returns { values, fill, reset, focus, setError }.
 */
export function wordInputs(container, { idPrefix, onReady, onChange } = {}) {
  ensureDatalist();
  const inputs = [];
  const hints = [];
  const grid = el('div', { class: 'word-grid' });
  for (let i = 0; i < WORD_COUNT; i++) {
    const id = `${idPrefix}-${i}`;
    const input = el('input', {
      id,
      class: 'input word-field',
      type: 'text',
      list: 'word-list',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      enterkeyhint: i === WORD_COUNT - 1 ? 'go' : 'next',
      'aria-label': t('words.n', { n: i + 1 }),
    });
    const hint = el('span', { class: 'word-hint', 'aria-live': 'polite' });
    grid.append(el('div', { class: 'word-cell' }, el('span', { class: 'word-n', text: String(i + 1), 'aria-hidden': 'true' }), input, hint));
    inputs.push(input);
    hints.push(hint);

    input.addEventListener('paste', (e) => {
      if (spread(i, e.clipboardData?.getData('text') ?? '')) e.preventDefault();
    });
    input.addEventListener('input', (e) => {
      // Text with a separator in one box (a paste from a phone keyboard, or a typed phrase).
      if (/[^A-Za-zÀ-ɏ]/.test(input.value.trim()) && spread(i, input.value)) return;
      update();
      if (e.inputType && !e.inputType.startsWith('insert')) return;
      const raw = normalizeWord(input.value);
      const r = resolveWord(raw);
      if (!r || r.how !== 'exact' || (raw.length < 4 && suggestWords(raw, 2).length !== 1)) return;
      if (i < WORD_COUNT - 1) inputs[i + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (i < WORD_COUNT - 1) inputs[i + 1].focus();
        const res = resolvePhrase(inputs.map((x) => x.value));
        if (res.ok) onReady?.(res.words);
      } else if (e.key === ' ' && input.value.trim() && i < WORD_COUNT - 1) {
        e.preventDefault();
        inputs[i + 1].focus();
      } else if (e.key === 'Backspace' && !input.value && i > 0) {
        inputs[i - 1].focus();
      }
    });
    input.addEventListener('blur', () => {
      const r = resolveWord(input.value);
      if (r && r.how !== 'exact') input.value = r.word;
      update();
    });
  }
  container.replaceChildren(grid);

  // Puts a pasted phrase, share text or invite link into the boxes, one word per box, starting
  // at the first box for a whole phrase. Returns false when the text holds a single word.
  function spread(i, text) {
    let parts = wordsFromLink(text) || splitPhrase(text);
    if (parts.length < 2) return false;
    if (parts.length > WORD_COUNT) {
      // A share text with a label around the words: keep only the exact list words.
      const known = parts.filter((p) => resolveWord(p)?.how === 'exact');
      if (known.length >= WORD_COUNT) parts = known.slice(-WORD_COUNT);
    }
    const start = parts.length >= WORD_COUNT ? 0 : i;
    inputs[i].value = '';
    parts.slice(0, WORD_COUNT - start).forEach((p, k) => (inputs[start + k].value = p));
    update();
    (inputs.find((x) => !resolveWord(x.value)) ?? inputs[WORD_COUNT - 1]).focus();
    const res = resolvePhrase(inputs.map((x) => x.value));
    if (res.ok) onReady?.(res.words);
    return true;
  }

  function update() {
    let ok = 0;
    inputs.forEach((input, i) => {
      const raw = input.value.trim();
      const r = resolveWord(raw);
      const cell = input.parentElement;
      cell.classList.toggle('is-ok', !!r);
      cell.classList.toggle('is-bad', !!raw && !r && raw.length >= 3);
      hints[i].textContent = r && r.how !== 'exact' ? r.word : raw && !r && raw.length >= 3 ? t('words.unknown') : '';
      if (r) ok++;
    });
    grid.classList.remove('is-wrong');
    onChange?.(ok);
    return ok;
  }

  return {
    inputs,
    values: () => resolvePhrase(inputs.map((x) => x.value)),
    fill(words) {
      words.slice(0, WORD_COUNT).forEach((w, i) => (inputs[i].value = w));
      update();
    },
    reset() {
      for (const x of inputs) x.value = '';
      update();
    },
    focus: () => inputs[0].focus(),
    setError() {
      grid.classList.add('is-wrong');
    },
  };
}

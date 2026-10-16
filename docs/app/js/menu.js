// One context menu for the whole app: a dark panel with role="menu" and role="menuitem" items,
// submenus, arrow keys, Home and End, type to jump, Escape and Tab, and placement that keeps
// every level inside the viewport (core/placement.js). Opened by a right click, a long press,
// the Menu key or Shift+F10; the caller decides what the items are.
//
// Items: { label, icon, hint, action(), disabled, checked, danger, swatch, submenu: [items] }
// or { separator: true }.

import { nextIndex, placeMenu, placeSubmenu, typeahead } from '../core/placement.js';

const SUB_DELAY = 180;
let uid = 0;

export class ContextMenu {
  constructor({ icons = 'icons.svg' } = {}) {
    this.icons = icons;
    this.levels = []; // [{ el, items, nodes, index, parentIndex }]
    this.returnFocus = null;
    this.openedAt = 0;
    this.typed = '';
    this.typedAt = 0;
    this.hoverTimer = 0;
    this.onClose = null;
    this._outside = (e) => {
      if (!this.levels.some((l) => l.el.contains(e.target))) this.close({ focus: false });
    };
    this._dismiss = () => this.close({ focus: false });
  }

  get isOpen() {
    return this.levels.length > 0;
  }

  /**
   * Opens the menu at a viewport point. options: { label, returnFocus, keyboard } where keyboard
   * focuses the first item (pointer opening focuses the menu itself so the first arrow key picks).
   */
  open(x, y, items, { label = '', returnFocus = document.activeElement, keyboard = false } = {}) {
    this.close({ focus: false });
    if (!items.some((it) => !it.separator)) return;
    this.returnFocus = returnFocus;
    this.openedAt = performance.now();
    const level = this._build(items, label);
    this.levels.push(level);
    const r = level.el.getBoundingClientRect();
    const p = placeMenu({ x, y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight });
    this._place(level.el, p);
    level.el.classList.add('is-open');
    if (keyboard) this._focus(0, nextIndex(level.items, -1, 1));
    else level.el.focus({ preventScroll: true });
    document.addEventListener('pointerdown', this._outside, true);
    addEventListener('resize', this._dismiss);
    addEventListener('blur', this._dismiss);
  }

  /** Closes every level. focus: give focus back to where it was before the menu opened. */
  close({ focus = true } = {}) {
    if (!this.levels.length) return;
    clearTimeout(this.hoverTimer);
    for (const l of this.levels) l.el.remove();
    this.levels = [];
    document.removeEventListener('pointerdown', this._outside, true);
    removeEventListener('resize', this._dismiss);
    removeEventListener('blur', this._dismiss);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (focus && back?.isConnected) back.focus?.({ preventScroll: true });
    this.onClose?.();
  }

  _build(items, label) {
    const el = document.createElement('div');
    el.className = 'cmenu';
    el.setAttribute('role', 'menu');
    el.id = `cmenu-${++uid}`;
    el.tabIndex = -1;
    if (label) el.setAttribute('aria-label', label);
    const level = { el, items, nodes: [], index: -1 };
    items.forEach((it, i) => {
      if (it.separator) {
        const sep = document.createElement('div');
        sep.className = 'cmenu-sep';
        sep.setAttribute('role', 'separator');
        el.append(sep);
        level.nodes.push(sep);
        return;
      }
      const node = document.createElement('div');
      node.className = 'cmenu-item';
      node.setAttribute('role', it.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (it.checked !== undefined) node.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      node.tabIndex = -1;
      if (it.id) node.dataset.cmd = it.id;
      if (it.disabled) node.setAttribute('aria-disabled', 'true');
      if (it.danger) node.classList.add('is-danger');
      if (it.submenu) {
        node.setAttribute('aria-haspopup', 'menu');
        node.setAttribute('aria-expanded', 'false');
      }
      const lead = document.createElement('span');
      lead.className = 'cmenu-lead';
      lead.setAttribute('aria-hidden', 'true');
      if (it.swatch) {
        lead.classList.add('cmenu-swatch');
        lead.style.setProperty('--c', it.swatch);
      } else if (it.icon) lead.innerHTML = `<svg class="ic"><use href="${this.icons}#i-${it.icon}"/></svg>`;
      else if (it.checked) lead.innerHTML = `<svg class="ic"><use href="${this.icons}#i-check"/></svg>`;
      const text = document.createElement('span');
      text.className = 'cmenu-label';
      text.textContent = it.label;
      node.append(lead, text);
      if (it.hint || it.submenu) {
        const hint = document.createElement('span');
        hint.className = it.submenu ? 'cmenu-more' : 'cmenu-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = it.submenu ? '' : it.hint;
        node.append(hint);
      }
      node.addEventListener('pointerenter', () => this._hover(level, i));
      node.addEventListener('click', (e) => {
        e.preventDefault();
        this._activate(level, i, false);
      });
      el.append(node);
      level.nodes.push(node);
    });
    el.addEventListener('keydown', (e) => this._key(e, level));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(el);
    return level;
  }

  _place(el, p) {
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.maxHeight = `${p.maxH}px`;
  }

  _depth(level) {
    return this.levels.indexOf(level);
  }

  _focus(depth, i) {
    const level = this.levels[depth];
    if (!level || i < 0) return;
    level.index = i;
    level.nodes.forEach((n, k) => n.classList?.toggle('is-active', k === i));
    level.nodes[i].focus({ preventScroll: false });
  }

  _closeAfter(depth) {
    while (this.levels.length > depth + 1) {
      const l = this.levels.pop();
      l.el.remove();
    }
    const parent = this.levels[depth];
    parent?.nodes.forEach((n) => n.getAttribute?.('aria-haspopup') && n.setAttribute('aria-expanded', 'false'));
  }

  _openSub(level, i, focusFirst) {
    const depth = this._depth(level);
    const item = level.items[i];
    if (!item?.submenu || item.disabled) return;
    if (this.levels[depth + 1]?.parentIndex === i) {
      if (focusFirst) this._focus(depth + 1, nextIndex(this.levels[depth + 1].items, -1, 1));
      return;
    }
    this._closeAfter(depth);
    const sub = this._build(item.submenu, item.label);
    sub.parentIndex = i;
    this.levels.push(sub);
    const node = level.nodes[i];
    node.setAttribute('aria-expanded', 'true');
    node.setAttribute('aria-controls', sub.el.id);
    const ir = node.getBoundingClientRect();
    const r = sub.el.getBoundingClientRect();
    const p = placeSubmenu({ ix: ir.left, iy: ir.top, iw: ir.width, ih: ir.height, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight });
    this._place(sub.el, p);
    sub.el.dataset.side = p.side;
    sub.el.classList.add('is-open');
    if (focusFirst) this._focus(depth + 1, nextIndex(sub.items, -1, 1));
  }

  _hover(level, i) {
    const depth = this._depth(level);
    if (depth < 0) return;
    const item = level.items[i];
    if (item.disabled) return;
    this._focus(depth, i);
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => {
      if (!this.levels.includes(level)) return;
      if (item.submenu) this._openSub(level, i, false);
      else this._closeAfter(depth);
    }, SUB_DELAY);
  }

  _activate(level, i, fromKey) {
    const item = level.items[i];
    if (!item || item.disabled) return;
    if (item.submenu) return this._openSub(level, i, fromKey);
    this.close({ focus: true });
    item.action?.();
  }

  _key(e, level) {
    const depth = this._depth(level);
    const items = level.items;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowDown') this._focus(depth, nextIndex(items, level.index, 1));
    else if (k === 'ArrowUp') this._focus(depth, nextIndex(items, level.index < 0 ? 0 : level.index, -1));
    else if (k === 'Home') this._focus(depth, nextIndex(items, -1, 1));
    else if (k === 'End') this._focus(depth, nextIndex(items, 0, -1));
    else if (k === 'ArrowRight' && items[level.index]?.submenu) this._openSub(level, level.index, true);
    else if ((k === 'ArrowLeft' || k === 'Escape') && depth > 0) {
      const parent = this.levels[depth - 1];
      this._closeAfter(depth - 1);
      this._focus(depth - 1, parent.index);
    } else if (k === 'Escape') this.close({ focus: true });
    else if (k === 'Enter' || k === ' ') {
      if (level.index >= 0) this._activate(level, level.index, true);
    } else if (k === 'Tab') this.close({ focus: true });
    else if (k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now();
      this.typed = now - this.typedAt < 700 ? this.typed + k : k;
      this.typedAt = now;
      this._focus(depth, typeahead(items, this.typed.length > 1 ? level.index - 1 : level.index, this.typed));
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

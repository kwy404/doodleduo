// The infinite slate: a camera over the board, a renderer that draws the CRDT elements through
// the same primitives as the SVG export, and the pointer input for every tool. Two fingers pan
// and pinch to zoom on touch screens; with a pen in use, a single finger pans instead of drawing.

import { primitives, baseline, TEXT_FONT, NOTE_FS, NOTE_PAD, LINE, measureText } from '../core/shapes.js';
import { bounds, eraserTouches, hit, moveFields, normBox, overlaps, resizeFields, topAt, unionBounds } from '../core/geometry.js';
import { speedToPressure, streamline } from '../core/smooth.js';
import { STROKE_TYPES } from '../core/crdt.js';
import * as images from './images.js';

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 8;
const HANDLE = 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Text width in board units with the board font, from a canvas context. */
export function measurer(ctx) {
  return (text, fs) => {
    ctx.font = `${fs}px ${TEXT_FONT}`;
    return ctx.measureText(text).width;
  };
}

function entry(el, theme, measure) {
  const prims = primitives(el, { theme, measure });
  return { prims, paths: prims.map((p) => (p.t === 'path' ? new Path2D(p.d) : null)), box: bounds(el) };
}

/**
 * Draws elements (bottom first) with a camera { x, y, z } onto a canvas context of
 * width by height CSS pixels. cache maps element ids to drawn shapes; drop an id when it changes.
 */
export function paint(ctx, list, { theme, cam, dpr = 1, width, height, cache = new Map(), grid = true, measure, onMissing, hideText = null }) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, width * dpr, height * dpr);
  if (grid) {
    let step = 24;
    while (step * cam.z < 14) step *= 2;
    while (step * cam.z > 56) step /= 2;
    const size = Math.max(1, 1.4 * dpr);
    ctx.fillStyle = theme.dot;
    const sx = Math.ceil(cam.x / step) * step;
    const sy = Math.ceil(cam.y / step) * step;
    for (let bx = sx; bx < cam.x + width / cam.z; bx += step) {
      const px = (bx - cam.x) * cam.z * dpr;
      for (let by = sy; by < cam.y + height / cam.z; by += step) ctx.fillRect(px - size / 2, (by - cam.y) * cam.z * dpr - size / 2, size, size);
    }
  }
  ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, -cam.x * cam.z * dpr, -cam.y * cam.z * dpr);
  const vx = cam.x;
  const vy = cam.y;
  const vw = width / cam.z;
  const vh = height / cam.z;
  for (const el of list) {
    let c = cache.get(el.id);
    if (!c) {
      c = entry(el, theme, measure);
      cache.set(el.id, c);
    }
    const b = c.box;
    if (b.x > vx + vw || b.y > vy + vh || b.x + b.w < vx || b.y + b.h < vy) continue;
    c.prims.forEach((p, i) => (p.t === 'text' && el.id === hideText ? null : drawPrim(ctx, p, c.paths[i], cam, theme, onMissing)));
  }
  ctx.globalAlpha = 1;
}

function drawPrim(ctx, p, path, cam, theme, onMissing) {
  if (p.t === 'path') {
    const alpha = p.alpha ?? 1;
    if (p.fill) {
      ctx.globalAlpha = p.fillAlpha ?? alpha;
      ctx.fillStyle = p.fill;
      ctx.fill(path);
    }
    if (p.stroke) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
  } else if (p.t === 'note') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 14 * cam.z;
    ctx.shadowOffsetY = 4 * cam.z;
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, p.w, p.h, 6);
    ctx.fill();
    ctx.restore();
  } else if (p.t === 'text') {
    ctx.fillStyle = p.color;
    ctx.font = `${p.fs}px ${p.font}`;
    ctx.textBaseline = 'alphabetic';
    p.lines.forEach((line, i) => ctx.fillText(line, p.x, baseline(p, i)));
  } else if (p.t === 'image') {
    const img = images.ready(p.src);
    if (img?.img?.naturalWidth) ctx.drawImage(img.img, p.x, p.y, p.w, p.h);
    else {
      ctx.strokeStyle = theme.dot;
      ctx.lineWidth = 2 / cam.z;
      ctx.setLineDash([8 / cam.z, 6 / cam.z]);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.setLineDash([]);
      onMissing?.(p.src);
    }
  }
}

export class View {
  constructor(canvas, { getTheme }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getTheme = getTheme;
    this.cam = { x: -80, y: -60, z: 1 };
    this.cache = new Map();
    this.list = [];
    this.selection = new Set();
    this.marquee = null;
    this.eraser = null;
    this.board = null;
    this.measure = measurer(document.createElement('canvas').getContext('2d'));
    this.listeners = new Set();
    this.missing = new Set();
    this.frame = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Shows a board. Its changes drop the shapes they touch from the cache. */
  setBoard(board) {
    this.off?.();
    this.board = board;
    this.cache.clear();
    this.selection.clear();
    this.list = board.visible();
    this.off = board.onChange((ids) => {
      for (const id of ids) this.cache.delete(id);
      this.list = board.visible();
      for (const id of [...this.selection]) if (!this.list.some((e) => e.id === id)) this.selection.delete(id);
      this.dirty();
    });
    this.dirty();
  }

  /** Redraws everything, for a theme change or a picture that arrived. */
  refresh() {
    this.cache.clear();
    this.dirty();
  }

  onCamera(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dirty(true);
  }

  dirty(camera = false) {
    if (camera) for (const fn of this.listeners) fn(this.cam);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  toBoard(sx, sy) {
    return [sx / this.cam.z + this.cam.x, sy / this.cam.z + this.cam.y];
  }

  toScreen(bx, by) {
    return [(bx - this.cam.x) * this.cam.z, (by - this.cam.y) * this.cam.z];
  }

  /** Zooms by factor keeping the board point under the screen point (sx, sy) in place. */
  zoomAt(sx, sy, factor) {
    const [bx, by] = this.toBoard(sx, sy);
    this.cam.z = clamp(this.cam.z * factor, MIN_ZOOM, MAX_ZOOM);
    this.cam.x = bx - sx / this.cam.z;
    this.cam.y = by - sy / this.cam.z;
    this.dirty(true);
  }

  setZoom(z) {
    this.zoomAt(this.w / 2, this.h / 2, z / this.cam.z);
  }

  pan(dx, dy) {
    this.cam.x -= dx / this.cam.z;
    this.cam.y -= dy / this.cam.z;
    this.dirty(true);
  }

  /** Frames every element, or the start of the board when it is empty. */
  fit() {
    const box = unionBounds(this.list);
    if (!box) {
      this.cam = { x: -this.w / 2, y: -this.h / 2, z: 1 };
    } else {
      const pad = 60;
      const z = clamp(Math.min((this.w - pad * 2) / Math.max(box.w, 1), (this.h - pad * 2) / Math.max(box.h, 1)), MIN_ZOOM, 2);
      this.cam = { z, x: box.x + box.w / 2 - this.w / 2 / z, y: box.y + box.h / 2 - this.h / 2 / z };
    }
    this.dirty(true);
  }

  /** The center of the screen in board coordinates. */
  center() {
    return this.toBoard(this.w / 2, this.h / 2);
  }

  selected() {
    return this.list.filter((e) => this.selection.has(e.id));
  }

  render() {
    const theme = this.getTheme();
    paint(this.ctx, this.list, {
      theme,
      cam: this.cam,
      dpr: this.dpr,
      width: this.w,
      height: this.h,
      cache: this.cache,
      measure: this.measure,
      hideText: this.editing,
      onMissing: (src) => {
        if (this.missing.has(src)) return;
        this.missing.add(src);
        images.load(src).then((img) => {
          if (img) {
            this.missing.delete(src);
            this.refresh();
          } else this.onNeed?.(src);
        });
      },
    });
    // Selection, marquee and eraser in screen space.
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const box = unionBounds(this.selected());
    if (box) {
      const [x, y] = this.toScreen(box.x, box.y);
      const w = box.w * this.cam.z;
      const h = box.h * this.cam.z;
      ctx.strokeStyle = theme.select;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
      ctx.setLineDash([]);
      ctx.fillStyle = theme.paper;
      for (const [hx, hy] of this.handles(box)) {
        ctx.beginPath();
        ctx.roundRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE, 3);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.marquee) {
      const m = normBox(this.marquee.x, this.marquee.y, this.marquee.w, this.marquee.h);
      const [x, y] = this.toScreen(m.x, m.y);
      ctx.fillStyle = theme.selectFill;
      ctx.strokeStyle = theme.select;
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, m.w * this.cam.z, m.h * this.cam.z);
      ctx.strokeRect(x, y, m.w * this.cam.z, m.h * this.cam.z);
    }
    if (this.eraser) {
      ctx.strokeStyle = theme.select;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.eraser.x, this.eraser.y, this.eraser.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Corner handles of a selection box, in screen pixels: nw, ne, se, sw. */
  handles(box) {
    const [x, y] = this.toScreen(box.x, box.y);
    const w = box.w * this.cam.z;
    const h = box.h * this.cam.z;
    return [
      [x - 4, y - 4],
      [x + w + 4, y - 4],
      [x + w + 4, y + h + 4],
      [x - 4, y + h + 4],
    ];
  }
}

/**
 * Collects the changes of one gesture (a stroke, a drag, an erase) so the whole gesture is one
 * undo step, and sends every change to the peers as it happens.
 */
export class Gesture {
  constructor(app) {
    this.app = app;
    this.before = new Map();
    this.after = new Map();
  }

  create(id, fields) {
    const op = this.app.board.create(id, fields);
    this.app.send(op);
    this.before.set(id, {});
    this.after.set(id, { ...op.f });
    return op;
  }

  change(id, fields) {
    const board = this.app.board;
    const b = this.before.get(id) || {};
    for (const name of Object.keys(fields)) if (!(name in b)) b[name] = board.register(id, name) ? { ...board.register(id, name) } : undefined;
    this.before.set(id, b);
    const { op } = board.change(id, fields);
    this.app.send(op);
    this.after.set(id, { ...this.after.get(id), ...op.f });
  }

  commit() {
    const entries = [...this.after].map(([id, f]) => ({ op: { k: 's', id, t: 0, f }, before: this.before.get(id) || {} }));
    if (entries.length) this.app.history.record(entries);
    this.app.changedHistory();
  }

  /** Drops what was made: a stroke cancelled by a second finger. */
  cancel() {
    for (const id of this.after.keys()) {
      const { op } = this.app.board.change(id, { del: true });
      this.app.send(op);
    }
  }
}

/** The elements people can pick: locked ones stay put until someone unlocks them. */
const free = (list) => list.filter((e) => !e.lock);

/** Every element in the same group as el (just el when it has none). */
export function groupOf(list, el) {
  return el.grp ? list.filter((e) => e.grp === el.grp && !e.lock) : [el];
}

const LONG_PRESS_MS = 550;

/**
 * Pointer input for every tool. app: { board, history, view, send(op), newId(), tool(),
 * style(), editText(el, isNew), changedHistory(), cursor(x, y), select(ids) }.
 */
export class Input {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.pointers = new Map();
    this.g = null; // current gesture state
    this.penSeen = false;
    this.space = false;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('pointerleave', () => {
      this.app.view.eraser = null;
      this.app.view.dirty();
      this.app.cursor(null);
    });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => this.dblclick(e));
    canvas.addEventListener('contextmenu', (e) => this.contextmenu(e));
    this.panned = 0; // how far the last right button pan moved, in pixels
    this.press = null; // a touch that may become a long press
    this.touchMenuAt = 0;
  }

  /** A right click that did not drag, or the browser's own long press: the context menu. */
  contextmenu(e) {
    e.preventDefault();
    // A touch screen's own long press: same as ours, which also drops what the finger started.
    if (this.press) return this.longPress();
    const touch = e.pointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents;
    if (this.panned > 5 || (touch && performance.now() - this.touchMenuAt < 800)) return;
    if (this.g?.kind === 'pan') {
      this.g = null;
      this.canvas.classList.remove('is-panning');
    }
    this.openMenu(e.clientX, e.clientY);
  }

  openMenu(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    this.app.contextMenu?.(cx - r.left, cy - r.top, cx, cy);
  }

  /** A finger held still: drop what it started and open the menu where it rests. */
  longPress() {
    const p = this.press;
    this.press = null;
    if (!p) return;
    clearTimeout(p.timer);
    const g = this.g;
    if (g?.gesture && (g.kind === 'stroke' || g.kind === 'shape')) g.gesture.cancel();
    else if (g?.gesture) g.gesture.commit();
    if (g?.kind === 'marquee') this.app.view.marquee = null;
    this.g = null;
    this.pointers.clear();
    this.app.view.dirty();
    navigator.vibrate?.(12);
    this.touchMenuAt = performance.now();
    this.openMenu(p.cx, p.cy);
  }

  cancelPress() {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    this.press = null;
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  wheel(e) {
    e.preventDefault();
    const view = this.app.view;
    const [sx, sy] = this.local(e);
    if (e.ctrlKey || e.metaKey) view.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)));
    else view.pan(-(e.shiftKey ? e.deltaY : e.deltaX), e.shiftKey ? 0 : -e.deltaY);
  }

  dblclick(e) {
    const [sx, sy] = this.local(e);
    const [bx, by] = this.app.view.toBoard(sx, sy);
    const el = topAt(free(this.app.view.list), bx, by, 6 / this.app.view.cam.z);
    if (el && (el.type === 'text' || el.type === 'note')) this.app.editText(el, false);
  }

  down(e) {
    const view = this.app.view;
    if (e.pointerType === 'pen') this.penSeen = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic or already released pointer
    }
    const [sx, sy] = this.local(e);
    this.pointers.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });
    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    this.cancelPress();
    if (touches.length === 1 && e.pointerType === 'touch') this.press = { x: sx, y: sy, cx: e.clientX, cy: e.clientY, timer: setTimeout(() => this.longPress(), LONG_PRESS_MS) };
    if (touches.length >= 2) {
      // Second finger: whatever the first one started becomes a pinch.
      if (this.g?.gesture && this.g.kind === 'stroke') this.g.gesture.cancel();
      else if (this.g?.gesture) this.g.gesture.commit();
      const [a, b] = touches;
      this.g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: [(a.x + b.x) / 2, (a.y + b.y) / 2], cam0: { ...view.cam } };
      return;
    }
    if (this.g) return;
    const tool = this.app.tool();
    const pan = e.button === 1 || e.button === 2 || this.space || tool === 'hand' || (e.pointerType === 'touch' && this.penSeen);
    if (pan) {
      this.panned = 0;
      this.g = { kind: 'pan', last: [sx, sy] };
      this.canvas.classList.add('is-panning');
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const [bx, by] = view.toBoard(sx, sy);
    const style = this.app.style();
    const z = view.cam.z;
    if (tool === 'pen' || tool === 'hl') {
      const gesture = new Gesture(this.app);
      const id = this.app.newId();
      const size = (tool === 'hl' ? style.size * 4 + 8 : style.size) / z;
      const color = tool === 'hl' && style.color === 'ink' ? '#d8c08f' : style.color;
      gesture.create(id, { type: tool, color, size: Math.round(size * 100) / 100 });
      const p0 = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.6;
      const first = [bx, by, p0];
      this.app.board.addPoints(id, first);
      this.app.send({ k: 'p', id, i: 0, d: first.map((v) => Math.round(v * 100) / 100) });
      this.g = { kind: 'stroke', id, gesture, last: first, lastScreen: [sx, sy], pressure: p0, pen: e.pointerType === 'pen', amount: tool === 'hl' ? 0.6 : 0.45 };
      this.app.select([]);
    } else if (tool === 'eraser') {
      this.g = { kind: 'erase', gesture: new Gesture(this.app), last: [bx, by], gone: new Set() };
      this.erase(bx, by, bx, by);
    } else if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow') {
      const gesture = new Gesture(this.app);
      const id = this.app.newId();
      gesture.create(id, { type: tool, x: bx, y: by, w: 0, h: 0, color: style.color, size: Math.round((style.size / z) * 100) / 100, fill: tool === 'rect' || tool === 'ellipse' ? style.fill : false });
      this.g = { kind: 'shape', id, tool, gesture, start: [bx, by] };
      this.app.select([]);
    } else if (tool === 'text') {
      const el = topAt(free(view.list), bx, by, 4 / z);
      if (el?.type === 'text' || el?.type === 'note') this.app.editText(el, false);
      else this.app.editText({ type: 'text', x: bx, y: by - (style.fs || 28) * 0.6, fs: Math.round((28 / z) * 10) / 10, color: style.color, text: '' }, true);
    } else if (tool === 'note') {
      const el = topAt(free(view.list), bx, by, 4 / z);
      if (el?.type === 'note') return this.app.editText(el, false);
      const w = 200 / Math.max(z, 0.5);
      this.app.editText({ type: 'note', x: bx - w / 2, y: by - w / 2, w, h: w, color: style.note, fs: NOTE_FS / Math.max(z, 0.5), text: '' }, true);
    } else if (tool === 'select') {
      this.selectDown(sx, sy, bx, by, e.shiftKey);
    }
  }

  selectDown(sx, sy, bx, by, shift) {
    const view = this.app.view;
    const sel = view.selected();
    const box = unionBounds(sel);
    if (box) {
      const hs = view.handles(box);
      const i = hs.findIndex(([hx, hy]) => Math.hypot(hx - sx, hy - sy) <= 16);
      if (i >= 0) {
        // The corner across from the grabbed handle stays put.
        const anchor = [i === 0 || i === 3 ? box.x + box.w : box.x, i < 2 ? box.y + box.h : box.y];
        this.g = { kind: 'resize', gesture: new Gesture(this.app), from: box, anchor, snap: sel.map((el) => ({ ...el })) };
        return;
      }
    }
    const el = topAt(free(view.list), bx, by, 6 / view.cam.z);
    if (el) {
      if (shift) {
        const next = new Set(view.selection);
        const members = groupOf(view.list, el);
        const on = !next.has(el.id);
        for (const m of members) on ? next.add(m.id) : next.delete(m.id);
        this.app.select([...next]);
      } else if (!view.selection.has(el.id)) this.app.select([el.id]);
      this.g = { kind: 'move', gesture: new Gesture(this.app), start: [bx, by], snap: view.selected().map((x) => ({ ...x })), moved: false };
    } else {
      if (!shift) this.app.select([]);
      view.marquee = { x: bx, y: by, w: 0, h: 0 };
      this.g = { kind: 'marquee', base: new Set(shift ? view.selection : []) };
    }
  }

  move(e) {
    const view = this.app.view;
    const [sx, sy] = this.local(e);
    const [bx, by] = view.toBoard(sx, sy);
    this.app.cursor(bx, by);
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) {
      ptr.x = sx;
      ptr.y = sy;
    }
    if (this.press && Math.hypot(sx - this.press.x, sy - this.press.y) > 10) this.cancelPress();
    if (this.app.tool() === 'eraser') {
      view.eraser = { x: sx, y: sy, r: 12 };
      if (!this.g) view.dirty();
    }
    const g = this.g;
    if (!g) return;
    if (g.kind === 'pinch') {
      const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
      if (touches.length < 2) return;
      const [a, b] = touches;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const z = clamp(g.cam0.z * (d / g.d0), MIN_ZOOM, MAX_ZOOM);
      const bx0 = g.mid0[0] / g.cam0.z + g.cam0.x;
      const by0 = g.mid0[1] / g.cam0.z + g.cam0.y;
      view.cam = { z, x: bx0 - mid[0] / z, y: by0 - mid[1] / z };
      view.dirty(true);
    } else if (g.kind === 'pan') {
      this.panned += Math.hypot(sx - g.last[0], sy - g.last[1]);
      view.pan(sx - g.last[0], sy - g.last[1]);
      g.last = [sx, sy];
    } else if (g.kind === 'stroke') {
      const events = e.getCoalescedEvents?.() || [e];
      const flat = [];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = this.local(ev);
        const dist = Math.hypot(x - g.lastScreen[0], y - g.lastScreen[1]);
        if (dist < 0.8) continue;
        g.lastScreen = [x, y];
        g.pressure = g.pen && ev.pressure > 0 ? ev.pressure : speedToPressure(g.pressure, dist);
        const [px, py] = view.toBoard(x, y);
        const pt = streamline(g.last, [px, py, g.pressure], g.amount);
        g.last = pt;
        flat.push(pt[0], pt[1], pt[2]);
      }
      if (flat.length) this.app.send(this.app.board.addPoints(g.id, flat));
    } else if (g.kind === 'erase') {
      this.erase(g.last[0], g.last[1], bx, by);
      g.last = [bx, by];
    } else if (g.kind === 'shape') {
      let w = bx - g.start[0];
      let h = by - g.start[1];
      if (e.shiftKey) {
        if (g.tool === 'line' || g.tool === 'arrow') {
          const ang = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(w, h);
          w = Math.cos(ang) * len;
          h = Math.sin(ang) * len;
        } else {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
      }
      g.gesture.change(g.id, { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 });
    } else if (g.kind === 'move') {
      const dx = bx - g.start[0];
      const dy = by - g.start[1];
      if (!g.moved && Math.hypot(dx, dy) * view.cam.z < 3) return;
      g.moved = true;
      for (const el of g.snap) g.gesture.change(el.id, moveFields(el, dx, dy));
    } else if (g.kind === 'resize') {
      let w = bx - g.anchor[0];
      let h = by - g.anchor[1];
      if (e.shiftKey || g.snap.some((el) => el.type === 'image' || el.type === 'text')) {
        const k = Math.max(Math.abs(w) / g.from.w, Math.abs(h) / g.from.h);
        w = Math.sign(w || 1) * g.from.w * k;
        h = Math.sign(h || 1) * g.from.h * k;
      }
      if (Math.abs(w) < 4 || Math.abs(h) < 4) return;
      const to = normBox(g.anchor[0], g.anchor[1], w, h);
      for (const el of g.snap) g.gesture.change(el.id, resizeFields(el, g.from, to));
    } else if (g.kind === 'marquee') {
      view.marquee.w = bx - view.marquee.x;
      view.marquee.h = by - view.marquee.y;
      const ids = new Set(g.base);
      for (const el of view.list) if (!el.lock && overlaps(el, view.marquee)) ids.add(el.id);
      this.app.select([...ids]);
      view.dirty();
    }
  }

  erase(ax, ay, bx, by) {
    const g = this.g;
    const r = 12 / this.app.view.cam.z;
    for (const el of this.app.view.list) {
      if (g.gone.has(el.id) || el.lock) continue;
      if (eraserTouches(el, ax, ay, bx, by, r)) {
        g.gone.add(el.id);
        g.gesture.change(el.id, { del: true });
      }
    }
  }

  up(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    this.cancelPress();
    const g = this.g;
    this.canvas.classList.remove('is-panning');
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) this.g = null;
      return;
    }
    this.g = null;
    const view = this.app.view;
    if (g.kind === 'stroke') {
      if (cancelled) g.gesture.cancel();
      else g.gesture.commit();
    } else if (g.kind === 'shape') {
      const el = this.app.board.get(g.id);
      if (!el || Math.hypot(el.w, el.h) * view.cam.z < 4) g.gesture.cancel();
      else {
        g.gesture.commit();
        this.app.select([g.id]);
        this.app.afterShape?.();
      }
    } else if (g.kind === 'erase' || g.kind === 'move' || g.kind === 'resize') {
      g.gesture.commit();
    } else if (g.kind === 'marquee') {
      view.marquee = null;
      view.dirty();
    }
  }
}

/** Width and height of a text element with the board font. */
export function textBox(text, fs, measure) {
  return measureText(text, fs, measure);
}

export { LINE, NOTE_PAD, STROKE_TYPES, hit };

// Copied from src/ by scripts/sync-core.mjs. Edit the file in src/ instead.
// Geometry of board elements: where they are, what a point or a rectangle touches, and the
// field changes that move or resize them. Pure functions over the plain elements of crdt.js.

import { STROKE_TYPES } from './crdt.js';
import { radiusAt } from './smooth.js';

export const IDENTITY = [1, 1, 0, 0];

/** Stroke points in board coordinates, after the element's scale and offset. */
export function strokePoints(el) {
  const [sx, sy, tx, ty] = el.m || IDENTITY;
  return (el.points || []).map(([x, y, p]) => [x * sx + tx, y * sy + ty, p]);
}

/** Stroke size after resizing: grows and shrinks with the average scale. */
export function strokeSize(el) {
  const [sx, sy] = el.m || IDENTITY;
  return (el.size || 4) * ((Math.abs(sx) + Math.abs(sy)) / 2);
}

/** A box with positive width and height. */
export function normBox(x, y, w, h) {
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
}

/** Bounding box of an element in board coordinates, including the stroke width. */
export function bounds(el) {
  if (STROKE_TYPES.has(el.type)) {
    const pts = strokePoints(el);
    if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const r = strokeSize(el) / 2 + 1;
    return { x: x0 - r, y: y0 - r, w: x1 - x0 + r * 2, h: y1 - y0 + r * 2 };
  }
  const b = normBox(el.x || 0, el.y || 0, el.w || 0, el.h || 0);
  if (el.type === 'line' || el.type === 'arrow' || el.type === 'rect' || el.type === 'ellipse') {
    const r = (el.size || 2) / 2 + (el.type === 'arrow' ? (el.size || 2) * 3 : 0);
    return { x: b.x - r, y: b.y - r, w: b.w + r * 2, h: b.h + r * 2 };
  }
  return b;
}

/** The box around several elements, or null. */
export function unionBounds(list) {
  let box = null;
  for (const el of list) {
    const b = bounds(el);
    if (!box) box = { ...b };
    else {
      const x1 = Math.max(box.x + box.w, b.x + b.w);
      const y1 = Math.max(box.y + box.h, b.y + b.h);
      box.x = Math.min(box.x, b.x);
      box.y = Math.min(box.y, b.y);
      box.w = x1 - box.x;
      box.h = y1 - box.y;
    }
  }
  return box;
}

/** Distance from point p to the segment a to b. */
export function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const inBox = (b, x, y, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/** True when the board point (x, y) touches the element, with a tolerance in board units. */
export function hit(el, x, y, tol = 4) {
  if (!inBox(bounds(el), x, y, tol)) return false;
  switch (el.type) {
    case 'pen':
    case 'hl': {
      const pts = strokePoints(el);
      const size = strokeSize(el);
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= radiusAt(size, pts[0][2]) + tol;
      for (let i = 1; i < pts.length; i++) {
        const r = el.type === 'hl' ? size / 2 : radiusAt(size, Math.max(pts[i][2], pts[i - 1][2]));
        if (segmentDistance(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= r + tol) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return segmentDistance(x, y, el.x, el.y, el.x + el.w, el.y + el.h) <= (el.size || 2) / 2 + tol;
    case 'rect': {
      const b = normBox(el.x, el.y, el.w, el.h);
      if (el.fill) return inBox(b, x, y, tol);
      const edge = (el.size || 2) / 2 + tol;
      return inBox(b, x, y, edge) && !inBox({ x: b.x + edge, y: b.y + edge, w: b.w - edge * 2, h: b.h - edge * 2 }, x, y);
    }
    case 'ellipse': {
      const b = normBox(el.x, el.y, el.w, el.h);
      const rx = b.w / 2;
      const ry = b.h / 2;
      if (rx < 1 || ry < 1) return inBox(b, x, y, tol);
      const dx = x - (b.x + rx);
      const dy = y - (b.y + ry);
      const d = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
      if (el.fill) return d <= 1 + tol / Math.min(rx, ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= (el.size || 2) / 2 + tol;
    }
    default:
      return inBox(bounds(el), x, y, tol);
  }
}

/** True when the element's box overlaps the rectangle (for the selection marquee). */
export function overlaps(el, rect) {
  const a = bounds(el);
  const r = normBox(rect.x, rect.y, rect.w, rect.h);
  return a.x <= r.x + r.w && a.x + a.w >= r.x && a.y <= r.y + r.h && a.y + a.h >= r.y;
}

/** True when the eraser, a segment from a to b with a radius, touches the element. */
export function eraserTouches(el, ax, ay, bx, by, radius) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, radius)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (hit(el, ax + (bx - ax) * t, ay + (by - ay) * t, radius)) return true;
  }
  return false;
}

const r2 = (n) => Math.round(n * 100) / 100;

/** Fields that move an element by (dx, dy). */
export function moveFields(el, dx, dy) {
  if (STROKE_TYPES.has(el.type)) {
    const [sx, sy, tx, ty] = el.m || IDENTITY;
    return { m: [sx, sy, r2(tx + dx), r2(ty + dy)] };
  }
  return { x: r2((el.x || 0) + dx), y: r2((el.y || 0) + dy) };
}

/**
 * Fields that resize an element when the selection box goes from box `from` to box `to`.
 * Positions map linearly between the two boxes; text grows its font size with the height.
 */
export function resizeFields(el, from, to) {
  const kx = from.w ? to.w / from.w : 1;
  const ky = from.h ? to.h / from.h : 1;
  const mapX = (x) => to.x + (x - from.x) * kx;
  const mapY = (y) => to.y + (y - from.y) * ky;
  if (STROKE_TYPES.has(el.type)) {
    const [sx, sy, tx, ty] = el.m || IDENTITY;
    return { m: [Math.max(1e-3, sx * kx), Math.max(1e-3, sy * ky), r2(mapX(tx)), r2(mapY(ty))] };
  }
  if (el.type === 'line' || el.type === 'arrow') {
    const x = mapX(el.x);
    const y = mapY(el.y);
    return { x: r2(x), y: r2(y), w: r2(mapX(el.x + el.w) - x), h: r2(mapY(el.y + el.h) - y) };
  }
  const b = normBox(el.x, el.y, el.w, el.h);
  const out = { x: r2(mapX(b.x)), y: r2(mapY(b.y)), w: r2(Math.max(1, b.w * kx)), h: r2(Math.max(1, b.h * ky)) };
  if (el.type === 'text') out.fs = Math.max(4, Math.min(800, r2((el.fs || 24) * ky)));
  return out;
}

/** The two short lines of an arrow head at the end (x2, y2). */
export function arrowHead(x1, y1, x2, y2, size = 2) {
  const len = Math.max(10, size * 4.5);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    [x2 - Math.cos(ang - spread) * len, y2 - Math.sin(ang - spread) * len],
    [x2, y2],
    [x2 - Math.cos(ang + spread) * len, y2 - Math.sin(ang + spread) * len],
  ];
}

/** The topmost visible element under a point, or null. list is bottom first. */
export function topAt(list, x, y, tol) {
  for (let i = list.length - 1; i >= 0; i--) if (hit(list[i], x, y, tol)) return list[i];
  return null;
}

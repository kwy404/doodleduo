// Copied from src/ by scripts/sync-core.mjs. Edit the file in src/ instead.
// Where a menu goes so that it stays inside the viewport. Pure functions, used by the context
// menu in the app and tested on their own.

/**
 * A menu of size (w, h) opened at the point (x, y). It opens to the right and below the point,
 * flips to the left or above when it would leave the viewport, and is finally clamped to a
 * margin. A menu taller or wider than the viewport is pinned to the margin (it scrolls inside).
 * Returns { x, y, maxH } in viewport pixels.
 */
export function placeMenu({ x, y, w, h, vw, vh, margin = 8 }) {
  let left = x;
  let top = y;
  if (left + w > vw - margin) left = x - w;
  if (top + h > vh - margin) top = y - h;
  left = clamp(left, margin, Math.max(margin, vw - margin - w));
  top = clamp(top, margin, Math.max(margin, vh - margin - h));
  return { x: Math.round(left), y: Math.round(top), maxH: Math.max(0, vh - margin * 2) };
}

/**
 * A submenu of size (w, h) for the item whose box is (ix, iy, iw, ih). It opens beside the item,
 * on the right, or on the left when the right side has no room, and lines up with the item's top
 * when it can. Returns { x, y, side, maxH }.
 */
export function placeSubmenu({ ix, iy, iw, ih, w, h, vw, vh, margin = 8, overlap = 4 }) {
  const right = ix + iw - overlap;
  const left = ix - w + overlap;
  let side = 'right';
  let x = right;
  if (right + w > vw - margin) {
    if (left >= margin) {
      side = 'left';
      x = left;
    } else {
      // No room on either side (a phone held upright): cover the parent, inside the viewport.
      side = 'over';
      x = clamp(vw - margin - w, margin, vw);
    }
  }
  let y = iy;
  if (y + h > vh - margin) y = iy + ih - h;
  y = clamp(y, margin, Math.max(margin, vh - margin - h));
  return { x: Math.round(x), y: Math.round(y), side, maxH: Math.max(0, vh - margin * 2) };
}

/** The next enabled index from i in direction dir (1 or -1), wrapping. -1 when none is enabled. */
export function nextIndex(items, i, dir) {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const j = (((i + dir * k) % n) + n) % n;
    if (!items[j].disabled && !items[j].separator) return j;
  }
  return -1;
}

/** The next enabled item after i whose label starts with the typed letters, or -1. */
export function typeahead(items, i, text) {
  const q = text.toLowerCase();
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const j = (i + k) % n;
    const it = items[j];
    if (!it.disabled && !it.separator && String(it.label || '').toLowerCase().startsWith(q)) return j;
  }
  return -1;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

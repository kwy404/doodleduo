// Copied from src/ by scripts/sync-core.mjs. Edit the file in src/ instead.
// Stroke smoothing. Three small steps turn shaky pointer samples into an even, pressure aware
// line:
// 1. streamline: each new sample is pulled only part of the way toward the pointer, which
//    removes hand jitter while drawing (the stored points are already smooth);
// 2. pressure: pens report it; a mouse or a finger reports a flat 0.5, so the width is taken
//    from the speed instead (fast is thin, slow is full);
// 3. outline: the centerline is offset left and right by a radius that follows the pressure,
//    capped with half circles, and drawn as quadratic curves through the edge midpoints.
// The same outline feeds the canvas (as a Path2D) and the SVG export, so both look the same.

const TAU = Math.PI * 2;

/** Moves from the last kept point toward the new sample by (1 - amount). amount 0 keeps the raw sample. */
export function streamline(last, sample, amount = 0.5) {
  if (!last) return [sample[0], sample[1], sample[2] ?? 0.5];
  const k = 1 - Math.min(0.95, Math.max(0, amount));
  return [last[0] + (sample[0] - last[0]) * k, last[1] + (sample[1] - last[1]) * k, sample[2] ?? 0.5];
}

/** True when a device gives no real pressure (mouse, most fingers): every sample is 0, 0.5 or 1. */
export function flatPressure(points) {
  if (points.length < 2) return true;
  const first = points[0][2];
  return points.every((p) => p[2] === first) && (first === 0.5 || first === 0 || first === 1);
}

/** One step of pressure from speed: distance is the move since the last sample, in screen pixels. */
export function speedToPressure(previous, distance, { slow = 1, fast = 18 } = {}) {
  const speed = Math.min(1, Math.max(0, (distance - slow) / (fast - slow)));
  const target = 0.85 - speed * 0.6;
  return previous + (target - previous) * 0.35;
}

/** Pressure from speed for a whole list of samples without real pressure. Returns new points. */
export function speedPressure(points, options) {
  const out = [];
  let p = 0.6;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (i > 0) p = speedToPressure(p, Math.hypot(x - points[i - 1][0], y - points[i - 1][1]), options);
    out.push([x, y, p]);
  }
  if (out.length > 1) out[0][2] = out[1][2];
  return out;
}

/** Drops samples closer than minDistance to the previous kept one (the last sample always stays). */
export function thin(points, minDistance = 0.75) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    if (Math.hypot(points[i][0] - a[0], points[i][1] - a[1]) >= minDistance) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Stroke radius at a pressure. thinning 0 gives a constant width (the highlighter). */
export function radiusAt(size, pressure, thinning = 0.6) {
  const p = Math.min(1, Math.max(0, pressure));
  return Math.max(0.25, (size / 2) * (1 - thinning + thinning * (0.25 + 0.75 * p) * 1.25));
}

function circle(cx, cy, r, steps = 16) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Three point moving average of the centerline, keeping the ends fixed. */
export function relax(points, passes = 1) {
  let cur = points;
  for (let n = 0; n < passes; n++) {
    if (cur.length < 3) return cur;
    const next = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1];
      const b = cur[i];
      const c = cur[i + 1];
      next.push([(a[0] + b[0] * 2 + c[0]) / 4, (a[1] + b[1] * 2 + c[1]) / 4, (a[2] + b[2] * 2 + c[2]) / 4]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/**
 * The outline polygon of a stroke: points [[x, y, pressure], ...] to [[x, y], ...].
 * options: size (diameter at full pressure), thinning (how much pressure matters), smoothing
 * (passes of the moving average), capSteps (points on each round cap).
 */
export function strokeOutline(points, { size = 4, thinning = 0.6, smoothing = 1, capSteps = 8 } = {}) {
  const clean = [];
  for (const p of points || []) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const last = clean[clean.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    clean.push([p[0], p[1], Number.isFinite(p[2]) ? p[2] : 0.5]);
  }
  if (!clean.length) return [];
  if (clean.length === 1) return circle(clean[0][0], clean[0][1], radiusAt(size, clean[0][2], thinning));
  const pts = relax(clean, smoothing);
  const left = [];
  const right = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = radiusAt(size, pts[i][2], thinning);
    left.push([pts[i][0] - dy * r, pts[i][1] + dx * r]);
    right.push([pts[i][0] + dy * r, pts[i][1] - dx * r]);
  }
  const cap = (center, from, steps) => {
    // Half circle from one edge point around the end to the other edge point.
    const r = Math.hypot(from[0] - center[0], from[1] - center[1]);
    const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
    const out = [];
    for (let s = 1; s < steps; s++) {
      const ang = start - (s / steps) * Math.PI;
      out.push([center[0] + Math.cos(ang) * r, center[1] + Math.sin(ang) * r]);
    }
    return out;
  };
  const end = pts[n - 1];
  const start = pts[0];
  const back = right.slice().reverse();
  return [...left, ...cap(end, left[n - 1], capSteps), ...back, ...cap(start, right[0], capSteps)];
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

/** A closed SVG path through the polygon with quadratic curves via edge midpoints. */
export function outlinePath(poly) {
  if (!poly.length) return '';
  if (poly.length < 3) return `M${fmt(poly[0][0])} ${fmt(poly[0][1])}Z`;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = poly.length;
  const m0 = mid(poly[n - 1], poly[0]);
  let d = `M${fmt(m0[0])} ${fmt(m0[1])}`;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const m = mid(p, poly[(i + 1) % n]);
    d += `Q${fmt(p[0])} ${fmt(p[1])} ${fmt(m[0])} ${fmt(m[1])}`;
  }
  return `${d}Z`;
}

/** Stroke styles by tool: the pen thins with pressure, the highlighter keeps one width. */
export const STROKE_STYLE = {
  pen: { thinning: 0.6, smoothing: 1, alpha: 1 },
  hl: { thinning: 0, smoothing: 2, alpha: 0.35 },
};

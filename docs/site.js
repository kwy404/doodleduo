// Interactive parts of the doodleduo site, built with Voodoo.js. Voodoo is loaded with
// data-manual: this module publishes the slate store and its actions on V.config.globals, then
// calls V.start(). The page declares the rest in HTML (v-data, v-for, @click, v-theme-toggle).
//   - the first screen is a chalkboard: draw on it with the same smoothing as the app, while
//     Mabel and Otto walk in and doodle next to your lines;
//   - the story below is a notebook: pages stick and turn as the next one slides over;
//   - on page 1 the top sticky note tears off.
// With reduced motion everything is shown at once and the ducks stay still.

import { outlinePath, speedToPressure, streamline, strokeOutline } from './app/core/smooth.js';

const V = window.V;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- The slate ----------

const SLATE = V.reactive({ colors: ['#ece9e1', '#a9bfd3', '#c9a3a6', '#a9bf9f', '#d8c08f'], color: '#ece9e1', count: 0 });
const canvas = $('#slate-canvas');
const ctx = canvas.getContext('2d');
const strokes = []; // { color, size, points, who }
let live = null;
let lastSpot = null; // where the visitor drew last, for the ducks to doodle next to it

const dark = () => document.documentElement.getAttribute('data-theme') !== 'light';
const ink = (c) => (c === '#ece9e1' && !dark() ? '#2b2f35' : c);

function lerp(a, b, n) {
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n]);
}

const shapes = {
  star: (cx, cy, r) => {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 4) / 5;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts.flatMap((p, i) => (i ? lerp(pts[i - 1], p, 10) : [p]));
  },
  spiral: (cx, cy, r) => Array.from({ length: 80 }, (_, i) => [cx + Math.cos(i / 5) * (i / 80) * r, cy + Math.sin(i / 5) * (i / 80) * r]),
  heart: (cx, cy, r) =>
    Array.from({ length: 64 }, (_, i) => {
      const t = (i / 63) * Math.PI * 2;
      return [cx + (r / 17) * 16 * Math.sin(t) ** 3, cy - (r / 17) * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
    }),
  cloud: (cx, cy, r) =>
    Array.from({ length: 72 }, (_, i) => {
      const a = (i / 71) * Math.PI * 2;
      const b = 1 + 0.16 * Math.sin(a * 5);
      return [cx + Math.cos(a) * r * 1.5 * b, cy + Math.sin(a) * r * 0.8 * b];
    }),
};

const bots = [
  { el: $('#bot-mabel'), color: '#d8c08f', kinds: ['star', 'spiral'], i: 0, stroke: null, timer: 0 },
  { el: $('#bot-otto'), color: '#a9bfd3', kinds: ['heart', 'cloud'], i: 0, stroke: null, timer: 0 },
];

function size() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function render() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  const all = [...strokes, ...(live ? [live] : []), ...bots.filter((b) => b.stroke).map((b) => b.stroke)];
  for (const s of all) {
    if (!s.points.length) continue;
    const path = new Path2D(outlinePath(strokeOutline(s.points, { size: s.size, thinning: 0.6 })));
    ctx.save();
    ctx.shadowColor = ink(s.color);
    ctx.shadowBlur = dark() ? 8 : 0;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = ink(s.color);
    ctx.fill(path);
    ctx.restore();
  }
}

const local = (e) => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // a synthetic pointer
  }
  const [x, y] = local(e);
  const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.6;
  live = { color: SLATE.color, size: 6, points: [[x, y, p]], last: [x, y, p], screen: [x, y], pen: e.pointerType === 'pen', pressure: p };
  render();
});
canvas.addEventListener('pointermove', (e) => {
  if (!live) return;
  for (const ev of e.getCoalescedEvents?.() || [e]) {
    const [x, y] = local(ev);
    const dist = Math.hypot(x - live.screen[0], y - live.screen[1]);
    if (dist < 0.8) continue;
    live.screen = [x, y];
    live.pressure = live.pen && ev.pressure > 0 ? ev.pressure : speedToPressure(live.pressure, dist);
    live.last = streamline(live.last, [x, y, live.pressure], 0.45);
    live.points.push(live.last);
  }
  render();
});
const end = () => {
  if (!live) return;
  strokes.push(live);
  lastSpot = live.last;
  live = null;
  SLATE.count = strokes.filter((s) => s.who == null).length;
  render();
  wake();
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);

function slateClear() {
  strokes.length = 0;
  SLATE.count = 0;
  render();
}

// ---------- Mabel and Otto doodle next to your lines ----------

let visible = true;
let started = false;

/** A spot for a duck doodle: next to the last line, below the words and above the tools. */
function spotFor(n) {
  const r = canvas.getBoundingClientRect();
  const top = Math.max(120, $('.slate-lead').getBoundingClientRect().bottom - r.top + 60);
  const bottom = Math.max(top + 10, $('.slate-tools').getBoundingClientRect().top - r.top - 50);
  const clampY = (y) => Math.min(bottom, Math.max(top, y));
  const clampX = (x) => Math.min(r.width - 90, Math.max(90, x));
  if (lastSpot) {
    const side = n === 0 ? -1 : 1;
    return [clampX(lastSpot[0] + side * (90 + Math.random() * 60)), clampY(lastSpot[1] + (Math.random() - 0.5) * 80)];
  }
  return [clampX(r.width * (n === 0 ? 0.22 : 0.42)), clampY((top + bottom) / 2)];
}

function doodle(bot, n) {
  clearTimeout(bot.timer);
  if (reduced || !visible || document.hidden) return;
  const [cx, cy] = spotFor(n);
  const kind = bot.kinds[bot.i++ % bot.kinds.length];
  const path = shapes[kind](cx, cy, 26 + Math.random() * 10);
  bot.stroke = { color: bot.color, size: 4, points: [], who: n };
  bot.el.classList.add('is-on');
  let i = 0;
  const step = () => {
    if (!visible || document.hidden || !bot.stroke) return;
    const p = path[i++];
    if (!p) {
      strokes.push(bot.stroke);
      bot.stroke = null;
      bot.el.classList.remove('is-on');
      // Old duck doodles go away so the slate stays the visitor's.
      const theirs = strokes.filter((s) => s.who === n);
      if (theirs.length > 2) strokes.splice(strokes.indexOf(theirs[0]), 1);
      render();
      bot.timer = setTimeout(() => doodle(bot, n), 3200 + Math.random() * 2400);
      return;
    }
    bot.stroke.points.push([p[0], p[1], 0.55 + 0.25 * Math.sin(i / 7)]);
    bot.el.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
    render();
    bot.timer = setTimeout(step, 26);
  };
  step();
}

/** The ducks start once they have walked in, and pick up again after you draw. */
function wake() {
  if (reduced || !started) return;
  bots.forEach((b, n) => {
    if (!b.stroke) {
      clearTimeout(b.timer);
      b.timer = setTimeout(() => doodle(b, n), 500 + n * 900);
    }
  });
}
if (!reduced) {
  setTimeout(() => {
    started = true;
    wake();
  }, 4200);
}
new IntersectionObserver(
  (entries) => {
    const was = visible;
    visible = entries.some((e) => e.isIntersecting);
    if (visible && !was) {
      for (const b of bots) b.stroke = null;
      wake();
    }
  },
  { threshold: 0.2 },
).observe(canvas);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    for (const b of bots) b.stroke = null;
    wake();
  }
});
new ResizeObserver(size).observe(canvas);
new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------- Notebook pages that turn ----------

const pages = $$('.page');
/** A page taller than the screen sticks only once its bottom is in view, so nothing is hidden. */
function stickTops() {
  const base = innerWidth <= 480 ? 70 : 76;
  for (const page of pages) page.style.top = `${Math.min(base, innerHeight - page.offsetHeight - 12)}px`;
}
function turn() {
  const vh = innerHeight;
  pages.forEach((page, i) => {
    const next = pages[i + 1];
    if (!next || reduced) return;
    const top = next.getBoundingClientRect().top;
    const stick = parseFloat(getComputedStyle(page).top) || 76;
    const k = Math.min(1, Math.max(0, 1 - (top - stick) / (vh * 0.9)));
    page.style.transform = k ? `perspective(1400px) rotateX(${(k * 9).toFixed(2)}deg) scale(${(1 - k * 0.06).toFixed(4)})` : '';
    page.style.filter = k ? `brightness(${(1 - k * 0.45).toFixed(3)})` : '';
  });
}
let frame = 0;
addEventListener(
  'scroll',
  () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      turn();
    });
  },
  { passive: true },
);
addEventListener('resize', () => {
  stickTops();
  turn();
});
stickTops();
addEventListener('load', stickTops);
for (const img of $$('.page img')) img.addEventListener('load', stickTops);
turn();

// Chalk lines on the pages draw themselves when they come into view.
for (const path of $$('.draw-on')) path.style.setProperty('--len', Math.ceil(path.getTotalLength?.() || 2000));
if ('IntersectionObserver' in window && !reduced) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        en.target.classList.add('is-drawn');
        io.unobserve(en.target);
      }
    },
    { threshold: 0.3 },
  );
  for (const el of $$('.talk-slate')) io.observe(el);
} else for (const el of $$('.talk-slate')) el.classList.add('is-drawn');

// ---------- The tear-off note ----------

const pad = $('#tearpad');
const tear = () => pad.classList.add('is-torn');
$('#tearnote').addEventListener('click', tear);
if ('IntersectionObserver' in window && !reduced) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setTimeout(tear, 1600);
        io.disconnect();
      }
    },
    { threshold: 0.8 },
  );
  io.observe(pad);
}

Object.assign(V.config.globals, { SLATE, slateClear });
V.start();

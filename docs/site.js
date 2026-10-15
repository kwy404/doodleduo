// Interactive parts of the doodleduo site, built with Voodoo.js. Voodoo is loaded with
// data-manual: this module publishes the demo store and its actions on V.config.globals, then
// calls V.start(). The page declares the rest in HTML (v-data, v-for, @click, v-theme-toggle).
//   - chalk lines in the hero draw themselves, and a long chalk line follows your scroll;
//   - sections rise in as they enter the screen;
//   - the demo slate: draw with the same smoothing as the app while Otto doodles next to you.
// With reduced motion everything is shown at once and Otto stays still.

import { outlinePath, speedToPressure, streamline, strokeOutline } from './app/core/smooth.js';

const V = window.V;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) document.documentElement.classList.add('no-motion');

// ---------- Chalk that draws itself ----------

for (const path of $$('.draw-on')) {
  const len = Math.ceil(path.getTotalLength?.() || 2000);
  path.style.setProperty('--len', len);
}
requestAnimationFrame(() => requestAnimationFrame(() => $('.hero')?.classList.add('is-drawn')));

// ---------- Sections rise in ----------

const reveals = $$('.reveal');
if (!reduced && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of reveals) {
    if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in');
    else io.observe(el);
  }
} else for (const el of reveals) el.classList.add('is-in');

// ---------- A chalk line down the page, drawn by scrolling ----------

const trail = $('#trail');
const trailPath = $('#trail-path');
function layoutTrail() {
  const h = document.documentElement.scrollHeight;
  const w = document.documentElement.clientWidth;
  trail.setAttribute('viewBox', `0 0 ${w} ${h}`);
  trail.style.height = `${h}px`;
  const top = ($('#demo')?.offsetTop || 900) - 80;
  let d = `M${w * 0.9} ${top}`;
  const step = 900;
  for (let y = top, i = 0; y < h - 400; y += step, i++) {
    const x1 = i % 2 ? w * 0.94 : w * 0.06;
    const x2 = i % 2 ? w * 0.06 : w * 0.94;
    d += ` C${x1} ${y + step * 0.3} ${x2} ${y + step * 0.6} ${i % 2 ? w * 0.08 : w * 0.92} ${y + step}`;
  }
  trailPath.setAttribute('d', d);
  const len = trailPath.getTotalLength();
  trailPath.style.strokeDasharray = `${len}`;
  trail.dataset.len = len;
  drawTrail();
}
function drawTrail() {
  const len = Number(trail.dataset.len || 0);
  if (reduced) {
    trailPath.style.strokeDashoffset = '0';
    return;
  }
  const max = document.documentElement.scrollHeight - innerHeight;
  const k = max > 0 ? Math.min(1, (scrollY + innerHeight * 0.5) / (max + innerHeight * 0.5)) : 1;
  trailPath.style.strokeDashoffset = `${len * (1 - k)}`;
}
let trailFrame = 0;
addEventListener('scroll', () => {
  if (trailFrame) return;
  trailFrame = requestAnimationFrame(() => {
    trailFrame = 0;
    drawTrail();
  });
}, { passive: true });
addEventListener('resize', () => layoutTrail());
addEventListener('load', () => layoutTrail());
layoutTrail();

// ---------- The demo slate ----------

const DEMO = V.reactive({ colors: ['#ece9e1', '#a9bfd3', '#c9a3a6', '#a9bf9f', '#d8c08f'], color: '#ece9e1', count: 0 });
const canvas = $('#demo-canvas');
const ctx = canvas.getContext('2d');
const otto = $('#demo-otto');
const strokes = []; // { color, size, alpha, points }
let live = null;

const dark = () => document.documentElement.getAttribute('data-theme') !== 'light';
const ink = (c) => (c === '#ece9e1' && !dark() ? '#2b2f35' : c);

function size() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of [...strokes, ...(live ? [live] : []), ...(ottoStroke ? [ottoStroke] : [])]) {
    if (s.points.length < 1) continue;
    ctx.fillStyle = ink(s.color);
    ctx.globalAlpha = s.alpha || 1;
    ctx.fill(new Path2D(outlinePath(strokeOutline(s.points, { size: s.size, thinning: 0.6 }))));
  }
  ctx.globalAlpha = 1;
}

function local(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = local(e);
  const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.6;
  live = { color: DEMO.color, size: 5, points: [[x, y, p]], last: [x, y, p], screen: [x, y], pen: e.pointerType === 'pen', pressure: p };
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
  live = null;
  DEMO.count = strokes.length;
  render();
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);

function demoClear() {
  strokes.length = 0;
  DEMO.count = 0;
  render();
}

// Otto doodles a little cloud and a sun, point by point, while the demo is on screen.
let ottoStroke = null;
let ottoTimer = 0;
let visible = false;
function ottoPath(w, h) {
  const out = [];
  const cx = w * 0.72;
  const cy = h * 0.42;
  const r = Math.min(w, h) * 0.12;
  for (let i = 0; i <= 70; i++) {
    const a = (i / 70) * Math.PI * 2;
    const bump = 1 + 0.18 * Math.sin(a * 5);
    out.push([cx + Math.cos(a) * r * 1.5 * bump, cy + Math.sin(a) * r * 0.8 * bump, 0.5 + 0.3 * Math.sin(i / 6)]);
  }
  return out;
}
function ottoDraw() {
  clearTimeout(ottoTimer);
  if (!visible || reduced || document.hidden) return;
  const r = canvas.getBoundingClientRect();
  const path = ottoPath(r.width, r.height);
  ottoStroke = { color: '#a9bfd3', size: 4.5, points: [] };
  let i = 0;
  otto.style.opacity = '1';
  const tick = () => {
    if (!visible || document.hidden) return;
    const p = path[i++];
    if (!p) {
      strokes.push(ottoStroke);
      ottoStroke = null;
      DEMO.count = strokes.length;
      otto.style.opacity = '.4';
      ottoTimer = setTimeout(() => {
        const at = strokes.findIndex((s) => s.color === '#a9bfd3' && s.size === 4.5);
        if (at >= 0) strokes.splice(at, 1);
        DEMO.count = strokes.length;
        render();
        ottoDraw();
      }, 5000);
      return;
    }
    ottoStroke.points.push(p);
    otto.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
    render();
    ottoTimer = setTimeout(tick, 28);
  };
  tick();
}
if (reduced) {
  otto.style.transform = 'translate(70%, 40%)';
  otto.style.opacity = '.6';
}
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    const was = visible;
    visible = entries.some((e) => e.isIntersecting);
    if (visible && !was) {
      ottoStroke = null;
      ottoDraw();
    }
  }, { threshold: 0.3 }).observe(canvas);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && visible) {
    ottoStroke = null;
    ottoDraw();
  }
});
new ResizeObserver(size).observe(canvas);
new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

Object.assign(V.config.globals, { DEMO, demoClear });
V.start();

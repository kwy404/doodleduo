// Original art for doodleduo: Mabel and Otto, two little ducks holding crayons, a line icon set
// and four chalk on slate scenes. Everything is drawn here as plain SVG strings in a dark slate
// palette and a calm light one, and written as standalone files for the README (assets/), the
// site (docs/assets/) and the app (docs/app/). Scenes carry their own CSS animation, which also
// plays inside an img tag, and stand still for people who prefer reduced motion.
//
// Usage: node scripts/site/art.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { duck as fullDuck, sharedDefs } from './duck.mjs';
import { banner, characterSheet, hero, mascot } from './scenes.mjs';

export const PAL = {
  dark: {
    bg: '#0c0e11', slate: '#14181c', slate2: '#1a1f25', frame: '#262c33', hair: 'rgba(233,230,221,.10)',
    chalk: '#e9e6dd', soft: 'rgba(233,230,221,.55)', faint: 'rgba(233,230,221,.22)', accent: '#8fa8c2',
    line: '#0a0c0e', text: '#e9e6dd', muted: '#8d939b',
  },
  light: {
    bg: '#f3f2ee', slate: '#e8e7e1', slate2: '#dedcd4', frame: '#c8c6bd', hair: 'rgba(36,39,43,.12)',
    chalk: '#2b2f35', soft: 'rgba(43,47,53,.6)', faint: 'rgba(43,47,53,.22)', accent: '#5f7b97',
    line: '#2a2e33', text: '#1f2226', muted: '#62676e',
  },
};

/** Muted pastels, used only for the cursors of collaborators. */
export const CURSORS = ['#9fb4c9', '#c9a3a6', '#a9bf9f', '#d8c08f', '#b5a8cc'];

const n = (v) => String(Math.round(v * 100) / 100);

// Scenes keep their old 120 box layout: this places the full duck (220 by 250) to match.
const duck = (who, { x = 0, y = 0, s = 1, flip = false } = {}) => fullDuck(who, { x: x - 6 * s, y: y - 22 * s, s: s * 0.6, flip, pose: 'hold', defs: 'a' });

const svg = (w, h, body, { title, style = '' } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"${title ? ` aria-label="${title}"` : ''}>${title ? `<title>${title}</title>` : ''}${style ? `<style>${style}</style>` : ''}${body}</svg>\n`;

const MOTION_OFF = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';

// The chalk texture: a little roughness on the edges of strokes, like chalk on slate.
const chalkFilter = (id = 'chalk') =>
  `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/></filter>`;

// ---------- Head and favicon ----------

/** Mabel from the front, close up: the head fills the square. */
export function head(mode, { tile = false } = {}) {
  const back = tile ? `<rect width="128" height="128" rx="28" fill="${PAL.dark.slate}"/>` : '';
  return svg(128, 128, `<defs>${sharedDefs('a')}</defs>${back}${fullDuck('mabel', { x: -46, y: -12, s: 1, view: 'front', expr: 'bold', shadow: false, defs: 'a' })}`, { title: 'doodleduo' });
}

// ---------- Icons ----------

export const ICONS = {
  pen: '<path d="M4 20l1.2-4.4L15.6 5.2a2.1 2.1 0 0 1 3 0l.2.2a2.1 2.1 0 0 1 0 3L8.4 18.8z"/><path d="M13.6 7.2l3.2 3.2"/>',
  highlighter: '<path d="M8.5 14.5l7.3-9.3a2 2 0 0 1 3 .1l.9 1a2 2 0 0 1-.1 2.8l-8.6 7.9z"/><path d="M8.5 14.5L6 17l1 1h3l1-1"/><path d="M4 21h9" opacity=".6"/>',
  eraser: '<path d="M8.6 19.5L4.8 15.7a1.8 1.8 0 0 1 0-2.6l8.3-8.3a1.8 1.8 0 0 1 2.6 0l3.5 3.5a1.8 1.8 0 0 1 0 2.6L11 19.5z"/><path d="M9 9l6 6"/><path d="M11 19.5h9"/>',
  select: '<path d="M5.5 4l12.5 6.8-5.6 1.5-2.6 5.4z"/><path d="M12.4 12.3l4.6 4.6"/>',
  hand: '<path d="M8 12.5V6.8a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V5.3a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.8V7.3a1.5 1.5 0 0 1 3 0V14c0 3.9-2.5 6.8-6 6.8-2.5 0-4-1.2-5.4-3.3L4.2 15a1.5 1.5 0 0 1 2.4-1.7L8 15"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="2.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  arrow: '<path d="M5 19L18.5 5.5"/><path d="M10 5h9v9"/>',
  line: '<path d="M5 19L19 5"/>',
  text: '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  note: '<path d="M5 4h14v10.5L13.5 20H5z"/><path d="M13.5 20v-5.5H19"/><path d="M8 9h7M8 12.5h4" opacity=".6"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 16l-4.8-4.8L7 19"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  invite: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M18.5 8v6M15.5 11h6"/>',
  words: '<rect x="3" y="5" width="7.5" height="5.5" rx="1.6"/><rect x="13.5" y="5" width="7.5" height="5.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="5.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="5.5" rx="1.6"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2v2h-2zM14 19.5h2M19.5 14v2"/>',
  people: '<circle cx="8.5" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3 19c0-3 2.5-5.5 5.5-5.5S14 16 14 19"/><path d="M14.5 14.2c.6-.2 1.3-.3 2-.3 2.6 0 4.5 2 4.5 4.6"/>',
  cursor: '<path d="M4.5 3.5l9.5 5.2-4.3 1.2-2.1 4.4z"/><rect x="11" y="14" width="9.5" height="6" rx="2"/>',
  boards: '<path d="M7 3.5h10.5L20 6v11.5H7z"/><path d="M4 7v13.5h12"/>',
  export: '<path d="M12 15V3.5"/><path d="M7.5 8L12 3.5 16.5 8"/><path d="M5 14v5.5h14V14"/>',
  download: '<path d="M12 3.5V15"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 15V3.5"/><path d="M7.5 8L12 3.5 16.5 8"/><path d="M5 20h14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M12 14.5v2.5"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19.5" r="2"/><path d="M6 7v2a6 6 0 0 0 6 6M18 7v2a6 6 0 0 1-6 6v2.5"/>',
  'zoom-in': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6M10.5 7.5v6M7.5 10.5h6"/>',
  'zoom-out': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6M7.5 10.5h6"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  settings: '<path d="M4 7h9M17 7h3M15 4.8v4.4M4 17h3M11 17h9M9 14.8v4.4"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V5.8a1.8 1.8 0 0 0-1.8-1.8H5.8A1.8 1.8 0 0 0 4 5.8v7.9a1.8 1.8 0 0 0 1.8 1.8h2.7"/>',
  front: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9" opacity=".55"/>',
  fill: '<rect x="4" y="6" width="16" height="12" rx="2.5"/><path d="M8 18l8-12M4.5 14l6-8M13.5 18l6-9" opacity=".55"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A7.8 7.8 0 0 1 9.5 4.5a7.8 7.8 0 1 0 10 10z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3l7.5 3v5.6c0 4.4-3.2 7.9-7.5 9.4-4.3-1.5-7.5-5-7.5-9.4V6z"/><path d="M8.6 12l2.4 2.4 4.4-4.6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  install: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M12 8v6M9.5 11.5L12 14l2.5-2.5"/>',
  offline: '<path d="M4 4l16 16"/><path d="M7.5 9.2A5 5 0 0 0 7 19h10"/><path d="M11 6.2A5 5 0 0 1 17.9 10 4 4 0 0 1 20 17"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  pinch: '<path d="M7 17l-3 3M17 7l3-3"/><path d="M4 15v5h5M20 9V4h-5"/><circle cx="12" cy="12" r="2.2"/>',
  duck: '<circle cx="11" cy="9" r="5"/><path d="M16 8.5c2-.6 4 0 4 1.3s-2 1.8-4 1.2"/><path d="M5 15.5c0-1.7 1.4-2.5 3-2.5h6c3 0 5 1.6 5 4 0 2.5-2.6 3.5-6.5 3.5S5 19.5 5 15.5z"/><circle cx="12.4" cy="8" r=".6"/>',
  file: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/>',
  heart: '<path d="M12 19.5s-7.5-4.4-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z"/>',
  laugh: '<circle cx="12" cy="12" r="8.5"/><path d="M8 13.5c1 2 2.4 3 4 3s3-1 4-3z"/><path d="M8.5 9.5l1.5-1M15.5 9.5l-1.5-1"/>',
  thumbs: '<path d="M7.5 10.5v9H4.5v-9z"/><path d="M7.5 10.5l3.5-6.5c1.4 0 2.2 1 2 2.4l-.6 3.1h5.1c1.2 0 2 1 1.8 2.2l-1.1 5.6c-.2 1.2-1.2 2.2-2.4 2.2H7.5"/>',
  wow: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="15" r="2"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 16v4M16.5 18h4"/>',
  chat: '<path d="M4.5 5.5h15v10h-9l-4.5 4v-4h-1.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5" opacity=".6"/>',
  reply: '<path d="M10 8L5 12.5 10 17"/><path d="M5 12.5h8.5a5.5 5.5 0 0 1 5.5 5.5v.5"/>',
  send: '<path d="M4.5 12L20 4.5 16 20l-4-6.5z"/><path d="M12 13.5L20 4.5"/>',
  call: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5c1 2.2 2.8 4 5 5l1.5-2 4.5 1.5v3c0 1.1-.9 2-2 2C11.1 19 5 12.9 5 5.5c0-1.1.9-2 1.5-2z"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/>',
  'mic-off': '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/><path d="M4 4l16 16"/>',
  camera: '<rect x="3.5" y="6.5" width="12" height="11" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3z"/>',
  'camera-off': '<rect x="3.5" y="6.5" width="12" height="11" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3z"/><path d="M3 3.5l17 17"/>',
  screen: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/><path d="M12 13V7.5M9.5 10L12 7.5 14.5 10"/>',
  hangup: '<path d="M3.5 13.5c4.6-4 12.4-4 17 0l-2 2.5-3.5-1.2V12c-2-.6-4-.6-6 0v2.8L5.5 16z"/>',
  bubbles: '<circle cx="9" cy="10" r="5.5"/><circle cx="17" cy="16" r="3.5"/><path d="M7 9.5h.01M11 9.5h.01" />',
  maximize: '<path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/>',
  minimize: '<path d="M4 9h5V4M20 9h-5V4M15 20v-5h5M9 20v-5H4"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/>',
};

export function iconSvg(name, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>\n`;
}

/** One sprite of symbols for the app and the site: <svg><use href="icons.svg#i-pen"/></svg>. */
export function iconSprite() {
  const symbols = Object.entries(ICONS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg">\n${symbols}\n</svg>\n`;
}

// ---------- Scenes ----------

const cursor = (color, name, mode) => {
  const p = PAL[mode];
  const w = 14 + name.length * 7.4;
  return `<path d="M0 0 L0 17 L4.6 12.8 L8 20 L10.6 18.8 L7.4 11.8 L13.5 11.6 Z" fill="${color}" stroke="${p.bg}" stroke-width="1.4" stroke-linejoin="round"/><rect x="12" y="16" width="${n(w)}" height="20" rx="10" fill="${color}"/><text x="${n(12 + w / 2)}" y="30" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11.5" font-weight="600" fill="#15181c">${name}</text>`;
};

const slateBoard = (x, y, w, h, mode) => {
  const p = PAL[mode];
  const dots = [];
  for (let i = x + 24; i < x + w - 10; i += 24) for (let j = y + 24; j < y + h - 10; j += 24) dots.push(`M${i} ${j}h.01`);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${p.slate}" stroke="${p.hair}"/><path d="${dots.join('')}" stroke="${p.faint}" stroke-width="2" stroke-linecap="round" opacity=".55"/>`;
};

/** A chalk line that draws itself: len is its path length (rounded up), delay in seconds. */
const chalkLine = (d, color, { w = 3, len = 600, delay = 0, dur = 1.6, cls = 'draw' } = {}) =>
  `<path class="${cls}" d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" filter="url(#chalk)" style="--l:${len};animation-delay:${delay}s;animation-duration:${dur}s" stroke-dasharray="${len}"/>`;

const DRAW_CSS = '.draw{stroke-dashoffset:0;animation:draw 1.6s cubic-bezier(.5,0,.2,1) both}@keyframes draw{from{stroke-dashoffset:var(--l)}to{stroke-dashoffset:0}}';
const LOOP_CSS = '.loop{animation:loopdraw 9s ease-in-out infinite both}@keyframes loopdraw{0%{stroke-dashoffset:var(--l)}22%,80%{stroke-dashoffset:0}92%,100%{stroke-dashoffset:var(--l);opacity:0}}';

export function sceneTogether(mode) {
  const p = PAL[mode];
  const body = `<defs>${chalkFilter()}${sharedDefs('a')}</defs><rect width="640" height="400" fill="${p.bg}"/>
${slateBoard(40, 30, 560, 290, mode)}
${chalkLine('M120 250 L120 170 L190 120 L260 170 L260 250 Z', p.chalk, { len: 520, cls: 'loop' })}
${chalkLine('M170 250 V205 H210 V250', p.chalk, { len: 140, cls: 'loop', w: 2.6 })}
${chalkLine('M400 110 m-34 0 a34 34 0 1 0 68 0 a34 34 0 1 0 -68 0', CURSORS[3], { len: 220, cls: 'loop' })}
${chalkLine('M400 58 V40 M436 74 L450 62 M452 110 H470 M364 74 L350 62 M348 110 H330', CURSORS[3], { len: 120, cls: 'loop', w: 2.4 })}
${chalkLine('M300 262 C340 236 380 280 420 254 S500 236 540 258', CURSORS[0], { len: 280, cls: 'loop', w: 4 })}
<g class="c1">${cursor(CURSORS[0], 'Otto', mode)}</g>
<g class="c2">${cursor(CURSORS[3], 'Mabel', mode)}</g>
${duck('mabel', { x: 52, y: 276, s: 0.95 })}
${duck('otto', { x: 476, y: 276, s: 0.95, flip: true })}`;
  const style = `${LOOP_CSS}.c1{animation:c1 9s ease-in-out infinite;transform:translate(540px,258px)}.c2{animation:c2 9s ease-in-out infinite;transform:translate(434px,110px)}@keyframes c1{0%{transform:translate(300px,262px)}22%{transform:translate(540px,258px)}80%{transform:translate(540px,258px)}100%{transform:translate(300px,262px)}}@keyframes c2{0%{transform:translate(366px,110px)}22%{transform:translate(434px,110px)}50%{transform:translate(450px,62px)}80%{transform:translate(434px,110px)}100%{transform:translate(366px,110px)}}${MOTION_OFF}`;
  return svg(640, 400, body, { title: 'Mabel and Otto draw on the same slate at once, each with a live cursor', style });
}

export function sceneWords(mode) {
  const p = PAL[mode];
  const words = ['maple', 'river', 'quiet', 'orbit', 'lemon', 'tiger'];
  const tiles = words
    .map((w, i) => {
      const x = 92 + (i % 2) * 112;
      const y = 92 + Math.floor(i / 2) * 50;
      return `<g class="t" style="animation-delay:${0.25 * i}s"><rect x="${x}" y="${y}" width="100" height="38" rx="10" fill="${p.slate2}" stroke="${p.hair}"/><text x="${x + 14}" y="${y + 25}" font-family="Inter, system-ui, sans-serif" font-size="11" fill="${p.muted}">${i + 1}</text><text x="${x + 58}" y="${y + 25}" text-anchor="middle" font-family="'Kalam','Segoe Print',cursive" font-size="17" fill="${p.chalk}">${w}</text></g>`;
    })
    .join('');
  // A drawing of a QR code (not a real one): finder squares and a few modules.
  const mods = [];
  const seed = [3, 7, 1, 9, 4, 8, 2, 6, 5, 0, 7, 3, 9, 1];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if ((seed[(r * 3 + c) % seed.length] + r + c) % 3 === 0) mods.push(`M${448 + c * 12} ${110 + r * 12}h9v9h-9z`);
  const finder = (x, y) => `<rect x="${x}" y="${y}" width="30" height="30" rx="4" fill="none" stroke="${p.chalk}" stroke-width="5"/><rect x="${x + 10}" y="${y + 10}" width="10" height="10" rx="2" fill="${p.chalk}"/>`;
  const body = `<defs>${chalkFilter()}${sharedDefs('a')}</defs><rect width="640" height="400" fill="${p.bg}"/>
${slateBoard(60, 56, 270, 210, mode)}${tiles}
<text x="195" y="78" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="12" letter-spacing="2" fill="${p.muted}">SIX WORDS</text>
<text x="320" y="182" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" fill="${p.muted}">or</text>
${slateBoard(410, 56, 170, 210, mode)}
<g filter="url(#chalk)">${finder(430, 86)}${finder(530, 86)}${finder(430, 202)}<path d="${mods.join('')}" fill="${p.soft}"/></g>
${chalkLine('M190 300 C260 340 380 340 450 300', p.accent, { len: 300, cls: 'loop', w: 2.4 })}
<g class="ok"><circle cx="320" cy="333" r="17" fill="${p.slate2}" stroke="${p.accent}" stroke-width="2"/><path d="M312 333l6 6 10-11" fill="none" stroke="${p.accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>
${duck('mabel', { x: 40, y: 270, s: 1 })}
${duck('otto', { x: 480, y: 270, s: 1, flip: true })}`;
  const style = `${LOOP_CSS}.t{animation:pop 9s ease-out infinite both}@keyframes pop{0%{opacity:0;transform:translateY(6px)}8%,88%{opacity:1;transform:none}100%{opacity:0}}.ok{transform-origin:320px 333px;animation:ok 9s ease-out infinite both}@keyframes ok{0%,30%{opacity:0;transform:scale(.6)}38%,86%{opacity:1;transform:none}100%{opacity:0}}${MOTION_OFF}`;
  return svg(640, 400, body, { title: 'Six words or a QR code connect two people, and six more words confirm it', style });
}

export function sceneLateJoiner(mode) {
  const p = PAL[mode];
  const page = (x, y, cls, delay) =>
    `<g class="${cls}" style="animation-delay:${delay}s"><rect x="${x}" y="${y}" width="88" height="64" rx="10" fill="${p.slate2}" stroke="${p.hair}"/><path d="M${x + 14} ${y + 44} C${x + 30} ${y + 18} ${x + 48} ${y + 52} ${x + 72} ${y + 24}" fill="none" stroke="${p.chalk}" stroke-width="2.4" stroke-linecap="round" filter="url(#chalk)"/><circle cx="${x + 70}" cy="${y + 46}" r="7" fill="none" stroke="${CURSORS[1]}" stroke-width="2.2"/></g>`;
  const body = `<defs>${chalkFilter()}${sharedDefs('a')}</defs><rect width="640" height="400" fill="${p.bg}"/>
${slateBoard(36, 60, 250, 200, mode)}
${chalkLine('M80 200 C110 120 150 230 190 140 S250 170 260 110', p.chalk, { len: 320 })}
${chalkLine('M86 110 h70 v40 h-70 z', CURSORS[2], { len: 230, w: 2.6, delay: 0.4 })}
${page(330, 100, 'fly', 0)}${page(330, 100, 'fly', 1)}${page(330, 100, 'fly', 2)}
${slateBoard(452, 60, 160, 200, mode)}
<g class="fill">${chalkLine('M480 200 C500 150 520 220 545 160 S590 170 596 130', p.chalk, { len: 200, w: 2.4, cls: 'none' })}<rect x="482" y="100" width="44" height="26" rx="4" fill="none" stroke="${CURSORS[2]}" stroke-width="2"/></g>
${duck('mabel', { x: 60, y: 272, s: 0.95 })}${duck('otto', { x: 160, y: 272, s: 0.95 })}
${duck('mabel', { x: 480, y: 272, s: 0.95, flip: true })}
<text x="532" y="44" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="12" fill="${p.muted}">joins late, gets the whole board</text>`;
  const style = `${DRAW_CSS}.fly{animation:fly 4.5s ease-in-out infinite both;opacity:0}@keyframes fly{0%{opacity:0;transform:translate(-40px,20px)}20%{opacity:1}80%{opacity:1;transform:translate(120px,0)}100%{opacity:0;transform:translate(140px,0)}}.fill{animation:fill 4.5s ease-out infinite both}@keyframes fill{0%,40%{opacity:.15}70%,100%{opacity:1}}${MOTION_OFF}.fly{opacity:1;transform:translate(40px,0)}`;
  return svg(640, 400, body, { title: 'Someone who joins late receives the whole board from the people already drawing', style });
}

export function sceneLocal(mode) {
  const p = PAL[mode];
  const chip = (x, label, delay) =>
    `<g class="chip" style="animation-delay:${delay}s"><rect x="${x}" y="300" width="96" height="40" rx="20" fill="${p.slate2}" stroke="${p.hair}"/><text x="${x + 48}" y="325" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="1" fill="${p.chalk}">${label}</text></g>`;
  const body = `<defs>${chalkFilter()}${sharedDefs('a')}</defs><rect width="640" height="400" fill="${p.bg}"/>
<rect x="190" y="40" width="260" height="230" rx="20" fill="${p.slate}" stroke="${p.hair}"/>
<path d="M214 40 V270" stroke="${p.frame}" stroke-width="2"/>
${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="202" cy="${66 + i * 36}" r="4" fill="${p.bg}" stroke="${p.hair}"/>`).join('')}
${chalkLine('M246 110 C276 80 306 140 336 104 S396 96 420 120', p.chalk, { len: 260 })}
${chalkLine('M250 190 h80', p.soft, { len: 90, w: 2.4, delay: 0.5 })}
${chalkLine('M250 214 h120', p.soft, { len: 130, w: 2.4, delay: 0.7 })}
<g class="lock"><rect x="372" y="176" width="44" height="40" rx="9" fill="${p.slate2}" stroke="${p.accent}" stroke-width="2"/><path d="M382 176v-8a12 12 0 0 1 24 0v8" fill="none" stroke="${p.accent}" stroke-width="2.4"/><circle cx="394" cy="196" r="4" fill="${p.accent}"/></g>
${chip(148, 'PNG', 0.2)}${chip(272, 'SVG', 0.4)}${chip(396, 'FILE', 0.6)}
${duck('otto', { x: 470, y: 150, s: 1.05, flip: true })}`;
  const style = `${DRAW_CSS}.chip{animation:chip 1s ease-out both}@keyframes chip{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.lock{transform-origin:394px 196px;animation:lock 3s ease-in-out infinite}@keyframes lock{0%,100%{transform:none}50%{transform:translateY(-3px)}}${MOTION_OFF}`;
  return svg(640, 400, body, { title: 'Boards stay in this browser and export as PNG, SVG or a board file', style });
}

/** The PWA icon: Mabel's head on slate. maskable keeps it inside the safe circle. */
export function appIcon({ maskable = false } = {}) {
  const s = maskable ? 0.72 : 0.92;
  const off = (128 - 128 * s) / 2;
  const inner = head('dark').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\n$/, '').replace(/<title>[^<]*<\/title>/, '');
  return svg(128, 128, `<rect width="128" height="128" rx="${maskable ? 0 : 28}" fill="${PAL.dark.slate}"/><g transform="translate(${n(off)} ${n(off)}) scale(${n(s)})">${inner}</g>`);
}

// ---------- Write files ----------

function write(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function build(root = '.') {
  const scenes = { together: sceneTogether, words: sceneWords, 'late-joiner': sceneLateJoiner, local: sceneLocal };
  const out = [];
  for (const dir of ['assets', 'docs/assets']) {
    for (const mode of ['light', 'dark']) {
      const sfx = mode === 'dark' ? '-dark' : '';
      out.push([`${dir}/mascot${sfx}.svg`, mascot(mode)], [`${dir}/head${sfx}.svg`, head(mode)]);
      for (const [name, fn] of Object.entries(scenes)) out.push([`${dir}/art/${name}${sfx}.svg`, fn(mode)]);
    }
  }
  for (const mode of ['light', 'dark']) {
    const sfx = mode === 'dark' ? '-dark' : '';
    out.push([`assets/banner${sfx}.svg`, banner(mode)]);
    out.push([`docs/assets/banner${sfx}.svg`, banner(mode)]);
    for (const name of Object.keys(ICONS)) out.push([`assets/icons/${mode}/${name}.svg`, iconSvg(name, mode === 'dark' ? PAL.dark.chalk : PAL.light.chalk)]);
  }
  out.push(['docs/favicon.svg', head('dark', { tile: true })], ['docs/app/icons/icon.svg', appIcon()], ['docs/app/icons/maskable.svg', appIcon({ maskable: true })]);
  out.push(['docs/assets/icons.svg', iconSprite()], ['docs/app/icons.svg', iconSprite()]);
  out.push(['assets/brand/character-sheet.svg', characterSheet()], ['docs/assets/hero.svg', hero('dark')], ['docs/assets/hero-light.svg', hero('light')]);
  for (const [file, text] of out) write(join(root, file), text);
  return out.length;
}

if (process.argv[1] && process.argv[1].endsWith('art.mjs')) console.log(`art: ${build()} files written`);

// The big pieces: the mascot portrait, the cinematic banner, the landing hero and the
// character sheet. Each is one standalone SVG in the night slate palette (a calm light version
// exists for the mascot and the banner). Animations are CSS inside the file and stop for people
// who prefer reduced motion.

import { CAST, CURSOR_COLORS, SLATE, cursorTag, duck, tipAt, propChalk, propCrayon, propEraser, propNote, sharedDefs } from './duck.mjs';

const n = (v) => String(Math.round(v * 100) / 100);
const MOTION_OFF = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';
const DRAW = '.dl{animation:dl 9s cubic-bezier(.55,0,.25,1) infinite both}@keyframes dl{0%{stroke-dashoffset:var(--l)}28%,82%{stroke-dashoffset:0}94%,100%{stroke-dashoffset:var(--l)}}';
const FONT = "Inter, 'Segoe UI', system-ui, sans-serif";

const LIGHT = { bg: '#f1f0eb', board: '#e6e5df', board2: '#dcdbd3', chalk: '#2b2f35', glow: '#5f7b97', muted: '#5f646b', hair: 'rgba(36,39,43,.12)', title: '#15181c' };
const DARK = { bg: SLATE.bg, board: SLATE.board, board2: SLATE.board2, chalk: SLATE.chalk, glow: SLATE.chalkBlue, muted: SLATE.muted, hair: SLATE.hair, title: '#f3f1ea' };

const svg = (w, h, body, { title, style = '' } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${style ? `<style>${style}</style>` : ''}${body}</svg>\n`;

/** A chalk line: textured stroke, optional glow, optional self drawing loop. */
function chalk(d, color, { w = 3.2, glow = false, len = 0, delay = 0, p = 'x', opacity = 1 } = {}) {
  const anim = len ? ` class="dl" stroke-dasharray="${len}" style="--l:${len};animation-delay:${delay}s"` : '';
  const line = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" filter="url(#${p}-chalk)"${anim}/>`;
  if (!glow) return line;
  return `<g filter="url(#${p}-glow)">${line}</g>`;
}

/** The slate itself: gradient, erased haze, ghosts of old drawings, vignette and grain. */
function board(w, h, pal, { p = 'x', rx = 0, quiet = false } = {}) {
  const dark = pal === DARK;
  const haze = [
    [w * 0.22, h * 0.35, w * 0.22, h * 0.26, 0.05],
    [w * 0.62, h * 0.2, w * 0.3, h * 0.18, 0.04],
    [w * 0.45, h * 0.7, w * 0.35, h * 0.2, 0.035],
  ]
    .map(([cx, cy, rx2, ry, o]) => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx2)}" ry="${n(ry)}" fill="${pal.chalk}" opacity="${o}" filter="url(#${p}-soft)"/>`)
    .join('');
  const ghosts = `<g opacity="${dark ? 0.07 : 0.09}" filter="url(#${p}-blur1)"><path d="M${n(w * 0.08)} ${n(h * 0.62)} C${n(w * 0.2)} ${n(h * 0.4)} ${n(w * 0.32)} ${n(h * 0.82)} ${n(w * 0.46)} ${n(h * 0.56)}" fill="none" stroke="${pal.chalk}" stroke-width="22" stroke-linecap="round"/><path d="M${n(w * 0.55)} ${n(h * 0.14)} q${n(w * 0.08)} ${n(h * 0.1)} ${n(w * 0.2)} 0" fill="none" stroke="${pal.chalk}" stroke-width="16" stroke-linecap="round"/></g>`;
  if (quiet) return `<defs><linearGradient id="${p}-bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.board2}"/><stop offset="1" stop-color="${pal.board}"/></linearGradient></defs><rect width="${w}" height="${h}" rx="${rx}" fill="url(#${p}-bd)"/>${haze}`;
  return `<defs><linearGradient id="${p}-bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.board2}"/><stop offset="1" stop-color="${pal.board}"/></linearGradient><radialGradient id="${p}-vg" cx=".5" cy=".42" r=".75"><stop offset=".55" stop-color="${pal.bg}" stop-opacity="0"/><stop offset="1" stop-color="${pal.bg}" stop-opacity="${dark ? 0.85 : 0.55}"/></radialGradient><radialGradient id="${p}-top" cx=".5" cy="0" r=".7"><stop offset="0" stop-color="${dark ? SLATE.rim : '#ffffff'}" stop-opacity="${dark ? 0.12 : 0.5}"/><stop offset="1" stop-color="${dark ? SLATE.rim : '#ffffff'}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" rx="${rx}" fill="url(#${p}-bd)"/>${haze}${ghosts}<rect width="${w}" height="${h}" rx="${rx}" fill="url(#${p}-top)"/>`;
}

const finish = (w, h, pal, p, rx = 0, quiet = false) =>
  `${quiet ? '' : `<rect width="${w}" height="${h}" rx="${rx}" fill="url(#${p}-vg)"/>`}<rect width="${w}" height="${h}" rx="${rx}" filter="url(#${p}-grain)" opacity="${pal === DARK ? 0.07 : 0.05}"/>`;

/** The chalk ledge along the bottom of the board, with a few pieces of chalk and an eraser. */
function ledge(x, y, w, pal) {
  const dark = pal === DARK;
  return `<rect x="${x}" y="${y}" width="${w}" height="16" rx="4" fill="${dark ? '#1d242b' : '#c9c7be'}"/><rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="${dark ? '#2c353e' : '#dad8d0'}"/><rect x="${x}" y="${y + 16}" width="${w}" height="10" fill="#000" opacity=".25"/>`;
}

// ---------- Mascot ----------

export function mascot(mode = 'dark') {
  const pal = mode === 'dark' ? DARK : LIGHT;
  const p = 'm';
  const mab = { x: 150, y: 196, s: 1.05, flip: true };
  const [tx, ty] = tipAt(mab);
  const line = `M${n(tx)} ${n(ty)} C90 280 60 200 120 150 S260 60 360 120 S520 150 560 96`;
  const body = `<defs>${sharedDefs(p)}</defs>${board(720, 520, pal, { p, rx: 28 })}
<ellipse cx="300" cy="330" rx="260" ry="150" fill="${SLATE.rim}" opacity="${mode === 'dark' ? 0.06 : 0.0}" filter="url(#${p}-soft)"/>
${chalk(line, pal.glow, { w: 4.2, glow: true, p, len: 760 })}
${chalk('M610 70 l9 -20 l9 20 l-23 -13 h28 z', pal.chalk, { w: 2.4, p, opacity: 0.8 })}
${chalk('M640 170 m-24 0 a24 24 0 1 0 48 0 a24 24 0 1 0 -48 0', CURSOR_COLORS[3], { w: 2.6, glow: true, p, opacity: 0.8 })}
${chalk('M560 250 c10 -14 26 -14 30 0 c4 -14 20 -14 30 0 c0 18 -30 32 -30 32 s-30 -14 -30 -32', CAST.otto.blush, { w: 2.6, p, opacity: 0.75 })}
${ledge(0, 446, 720, pal)}
${duck('mabel', { ...mab, defs: p })}
${duck('otto', { x: 400, y: 214, s: 0.98, flip: true, defs: p })}
<g class="cur">${cursorTag(CURSOR_COLORS[3], 'Mabel')}</g>
${finish(720, 520, pal, p, 28)}`;
  const style = `${DRAW}.cur{transform:translate(560px,96px);animation:cur 9s cubic-bezier(.55,0,.25,1) infinite}@keyframes cur{0%{transform:translate(120px,150px)}28%,82%{transform:translate(560px,96px)}100%{transform:translate(120px,150px)}}${MOTION_OFF}`;
  return svg(720, 520, body, { title: 'Mabel and Otto, two ducks drawing on a night slate: Mabel bold with her chalk, Otto calm with his crayon', style });
}

// ---------- Banner ----------

export function banner(mode = 'dark') {
  const pal = mode === 'dark' ? DARK : LIGHT;
  const p = 'b';
  const W = 1280;
  const H = 420;
  const tip = tipAt({ x: 790, y: 90, s: 1.12, flip: true });
  const swoop = `M${n(tip[0])} ${n(tip[1])} C720 260 680 320 580 310 S420 280 330 318 S170 340 96 316`;
  const body = `<defs>${sharedDefs(p)}<clipPath id="b-clip"><rect width="${W}" height="${H}" rx="22"/></clipPath></defs><g clip-path="url(#b-clip)">${board(W, H, pal, { p })}
${chalk('M980 70 l10 -22 l10 22 l-25 -14 h30 z', pal.chalk, { w: 2.4, p, opacity: 0.85 })}
${chalk('M1130 120 m-30 0 a30 30 0 1 0 60 0 a30 30 0 1 0 -60 0 M1130 70 v-14 M1168 86 l10 -10 M1180 120 h14 M1092 86 l-10 -10 M1080 120 h-14', CURSOR_COLORS[3], { w: 2.6, glow: true, p, len: 420, delay: 1.2 })}
${chalk('M1180 250 c12 -16 30 -16 34 0 c4 -16 22 -16 34 0 c0 20 -34 36 -34 36 s-34 -16 -34 -36', CURSOR_COLORS[1], { w: 2.6, glow: true, p, len: 260, delay: 2 })}
${chalk('M700 70 c30 -20 60 20 90 0 s60 -20 90 0', pal.chalk, { w: 2.4, p, opacity: 0.55 })}
${chalk(swoop, pal.glow, { w: 4.4, glow: true, p, len: 1000 })}
${chalk('M120 360 C220 340 300 372 400 352', pal.chalk, { w: 2, p, opacity: 0.35 })}
${ledge(640, 362, 640, pal)}
${propEraser(1180, 344, 1)}
${duck('mabel', { x: 790, y: 90, s: 1.12, flip: true, defs: p })}
${duck('otto', { x: 1000, y: 112, s: 1.03, flip: true, defs: p })}
<text x="96" y="106" font-family="${FONT}" font-size="13" font-weight="600" letter-spacing="3.2" fill="${pal.glow}">PEER TO PEER WHITEBOARD</text>
<text x="92" y="186" font-family="${FONT}" font-size="76" font-weight="700" letter-spacing="-3" fill="${pal.title}">doodleduo</text>
<text x="96" y="230" font-family="${FONT}" font-size="21" fill="${pal.muted}">An infinite slate you draw on with friends, at the same time.</text>
<text x="96" y="260" font-family="${FONT}" font-size="21" fill="${pal.muted}">Six words to connect. No account. No server in between.</text>
<g class="c1">${cursorTag(CURSOR_COLORS[0], 'Bia')}</g>
<g class="c2">${cursorTag(CURSOR_COLORS[2], 'Caio')}</g>
${finish(W, H, pal, p)}</g>`;
  const style = `${DRAW}.c1{transform:translate(1130px,74px);animation:c1 9s ease-in-out infinite}@keyframes c1{0%{transform:translate(1150px,40px)}14%{transform:translate(1130px,74px)}50%{transform:translate(1160px,150px)}82%{transform:translate(1180px,98px)}100%{transform:translate(1150px,40px)}}.c2{transform:translate(1214px,280px);animation:c2 9s ease-in-out infinite;animation-delay:-3s}@keyframes c2{0%,100%{transform:translate(1180px,256px)}40%{transform:translate(1214px,286px)}70%{transform:translate(1246px,250px)}}${MOTION_OFF}`;
  return svg(W, H, body, { title: 'doodleduo: Mabel and Otto draw glowing chalk lines on a vast night slate while friends join with live cursors', style });
}

// ---------- Landing hero ----------

export function hero(mode = 'dark') {
  const p = 'h';
  const W = 900;
  const H = 640;
  const body = `<defs>${sharedDefs(p)}</defs>
<ellipse cx="450" cy="560" rx="380" ry="40" fill="${mode === 'dark' ? '#000' : '#5f646b'}" opacity="${mode === 'dark' ? 0.55 : 0.16}" filter="url(#${p}-soft)"/>
${duck('mabel', { x: 170, y: 290, s: 1.35, flip: true, defs: p })}
${duck('otto', { x: 470, y: 316, s: 1.24, flip: true, defs: p })}`;
  return svg(W, H, body, { title: 'Mabel and Otto at the slate' });
}

// ---------- Character sheet ----------

export function characterSheet() {
  const pal = DARK;
  const p = 's';
  const W = 1600;
  const H = 1160;
  const label = (x, y, text, size = 13, color = pal.muted, weight = 600, spacing = 2.4) => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" fill="${color}">${text}</text>`;
  const panel = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#ffffff" fill-opacity=".02" stroke="${pal.hair}"/>`;
  const exprs = ['bold', 'calm', 'happy', 'surprised', 'focused', 'sleepy'];
  const heads = exprs
    .map((e, i) => {
      const who = i % 2 ? 'otto' : 'mabel';
      const x = 70 + i * 248;
      return `<g><clipPath id="s-hc${i}"><rect x="${x}" y="790" width="220" height="190" rx="16"/></clipPath><rect x="${x}" y="790" width="220" height="190" rx="16" fill="#ffffff" fill-opacity=".025" stroke="${pal.hair}"/><g clip-path="url(#s-hc${i})">${duck(who, { x: x - 45, y: 788, s: 1.25, expr: e, pose: 'rest', prop: null, defs: p, shadow: false })}</g>${label(x + 4, 1004, e.toUpperCase(), 12, pal.muted, 600, 2.4)}</g>`;
    })
    .join('');
  const swatch = (x, y, color, name) => `<rect x="${x}" y="${y}" width="44" height="44" rx="10" fill="${color}" stroke="${pal.hair}"/>${label(x + 56, y + 20, name, 13, pal.title, 500, 0)}${label(x + 56, y + 38, color, 12, pal.muted, 500, 0.5)}`;
  const body = `<defs>${sharedDefs(p)}</defs>${board(W, H, pal, { p, quiet: true })}
${label(70, 90, 'DOODLEDUO', 14, pal.glow, 600, 4)}
<text x="68" y="146" font-family="${FONT}" font-size="48" font-weight="700" letter-spacing="-1.5" fill="${pal.title}">Mabel and Otto: character sheet</text>
${label(70, 182, 'Mabel is the bold one: chalk up, grin wide, already drawing. Otto is the calm one: crayon close, eyes soft, happy to watch first.', 17, pal.muted, 400, 0)}
${panel(50, 220, 740, 520)}${panel(810, 220, 740, 520)}
${label(76, 258, 'MABEL  /  FRONT AND THREE QUARTER', 13)}${label(836, 258, 'OTTO  /  FRONT AND THREE QUARTER', 13)}
${duck('mabel', { x: 80, y: 360, s: 1.4, view: 'front', expr: 'bold', defs: p })}
${duck('mabel', { x: 410, y: 360, s: 1.4, flip: true, defs: p })}
${duck('otto', { x: 840, y: 360, s: 1.4, view: 'front', expr: 'calm', defs: p })}
${duck('otto', { x: 1170, y: 360, s: 1.4, flip: true, defs: p })}
${label(70, 774, 'EXPRESSIONS', 13)}${heads}
${label(70, 1050, 'PROPS', 13)}
${propChalk(90, 1100, 1.6)}${propCrayon(260, 1104, 1.6)}${propCrayon(450, 1104, 1.6, '#9fb4c9', '#6f879f')}${propEraser(640, 1080, 1.4)}${propNote(790, 1046, 0.62, '#e6d9a8', -5)}
${label(1000, 1050, 'PALETTE', 13)}
${swatch(1000, 1068, CAST.mabel.base, 'Mabel butter')}${swatch(1190, 1068, CAST.otto.base, 'Otto slate')}${swatch(1380, 1068, SLATE.chalkBlue, 'Chalk blue')}
${finish(W, H, pal, p, 0, true)}`;
  return svg(W, H, body, { title: 'Character sheet of Mabel and Otto: front and three quarter views, expressions, props and palette' });
}

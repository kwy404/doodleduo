// Mabel and Otto, drawn with volume: layered gradients for the key light, a cool rim light from
// the glowing slate behind them, soft cast shadows, fine feather strokes, chalk dust on the
// wings and props with real material detail (a porous chalk stick, a wax crayon in its paper).
// Mabel is the bold one: chalk raised, mid stroke, beak open in a grin, brows set. Otto is the
// calm one: crayon held close, eyes half closed, a small content smile.
//
// duck(who, options) returns an SVG group in a 220 by 250 box, facing right, feet on y = 236.

let uid = 0;
const n = (v) => String(Math.round(v * 100) / 100);

export const SLATE = {
  bg: '#0a0c0f', board: '#11161b', board2: '#161c22', chalk: '#ece9e1', chalkBlue: '#a9bfd3', accent: '#8fa8c2',
  rim: '#b9cde0', shadow: '#030405', muted: '#8d939b', hair: 'rgba(233,230,221,.10)',
};
/** Where the chalk of a drawing duck touches the slate, in the 220 by 250 box (facing right). */
export const DRAW_TIP = [246, 112];
/** The tip in scene coordinates for a duck placed with x, y, s and flip. */
export const tipAt = ({ x = 0, y = 0, s = 1, flip = false }) => [flip ? x + (220 - DRAW_TIP[0]) * s : x + DRAW_TIP[0] * s, y + DRAW_TIP[1] * s];

export const CURSOR_COLORS = ['#9fb4c9', '#c9a3a6', '#a9bf9f', '#d8c08f', '#b5a8cc'];

export const CAST = {
  mabel: {
    name: 'Mabel', light: '#efe3b8', base: '#d9c993', dark: '#a8975f', deep: '#7b6c40', wing: '#cbb97f', wingDark: '#97864f',
    beak: '#dba783', beakDark: '#b37a57', feet: '#cf9670', feetDark: '#a06d4d', blush: '#e2a49b',
  },
  otto: {
    name: 'Otto', light: '#dfe5ea', base: '#bac4cd', dark: '#86929e', deep: '#5f6a75', wing: '#a9b4bf', wingDark: '#7b8793',
    beak: '#d9a684', beakDark: '#b07a59', feet: '#cb9572', feetDark: '#9c6c4e', blush: '#d7a4a6',
  },
};

// A tiny seeded generator, so feather strokes and dust are the same on every build.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared filters: soft blur, chalk glow and chalk grain. Put once in a document's defs. */
export function sharedDefs(p = 'x') {
  return `<filter id="${p}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="${p}-blur1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="${p}-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .75 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="${p}-chalk" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" result="d"/><feTurbulence type="fractalNoise" baseFrequency="2.2" numOctaves="1" seed="9" result="m"/><feColorMatrix in="m" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.9" result="holes"/><feComposite in="d" in2="holes" operator="in"/></filter>
<filter id="${p}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="11" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.6 -.6"/></filter>`;
}

/**
 * Options: x, y, s (scale), flip, view ('three' or 'front'), expr ('bold', 'calm', 'happy',
 * 'surprised', 'sleepy', 'focused'), pose ('draw', 'hold', 'rest'), prop ('chalk', 'crayon',
 * null), defs (prefix of sharedDefs), rimSide ('left' or 'right'), shadow (cast shadow on).
 */
export function duck(who, o = {}) {
  const c = CAST[who];
  const id = `dk${++uid}`;
  const { x = 0, y = 0, s = 1, flip = false, view = 'three', expr = who === 'mabel' ? 'bold' : 'calm', pose = who === 'mabel' ? 'draw' : 'hold', prop = who === 'mabel' ? 'chalk' : 'crayon', defs = 'x', shadow = true } = o;
  const t = flip ? `translate(${n(x + 220 * s)} ${n(y)}) scale(${n(-s)} ${n(s)})` : `translate(${n(x)} ${n(y)}) scale(${n(s)})`;
  const r = rng(who === 'mabel' ? 17 : 29);
  const grad = `<defs>
<radialGradient id="${id}-b" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="${c.light}"/><stop offset=".45" stop-color="${c.base}"/><stop offset=".85" stop-color="${c.dark}"/><stop offset="1" stop-color="${c.deep}"/></radialGradient>
<radialGradient id="${id}-h" cx=".4" cy=".32" r=".75"><stop offset="0" stop-color="${c.light}"/><stop offset=".5" stop-color="${c.base}"/><stop offset=".9" stop-color="${c.dark}"/><stop offset="1" stop-color="${c.deep}"/></radialGradient>
<linearGradient id="${id}-w" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="${c.light}" stop-opacity=".9"/><stop offset=".35" stop-color="${c.wing}"/><stop offset="1" stop-color="${c.wingDark}"/></linearGradient>
<linearGradient id="${id}-k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.beak}"/><stop offset="1" stop-color="${c.beakDark}"/></linearGradient>
<linearGradient id="${id}-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.feet}"/><stop offset="1" stop-color="${c.feetDark}"/></linearGradient>
<radialGradient id="${id}-e" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#3a4250"/><stop offset=".6" stop-color="#171a20"/><stop offset="1" stop-color="#08090b"/></radialGradient>
<radialGradient id="${id}-c" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${c.blush}" stop-opacity=".75"/><stop offset="1" stop-color="${c.blush}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${SLATE.rim}" stop-opacity=".95"/><stop offset=".55" stop-color="${SLATE.rim}" stop-opacity="0"/></linearGradient>
</defs>`;
  const parts = [grad];
  if (shadow) parts.push(`<ellipse cx="108" cy="238" rx="78" ry="11" fill="${SLATE.shadow}" opacity=".7" filter="url(#${defs}-soft)"/>`);
  if (view === 'front') parts.push(frontBody(c, id, r, expr, defs));
  else parts.push(threeBody(c, id, r, expr, pose, prop, defs));
  return `<g transform="${t}">${parts.join('')}</g>`;
}

// ---------- Three quarter view (facing right) ----------

const BODY = 'M44 176 C40 132 70 110 106 110 C144 110 172 134 172 172 C172 210 142 232 106 232 C68 232 46 212 44 176 Z';
const HEAD_C = [116, 78];
const HEAD_R = 47;

function feathers(r, box, count, color, opacity, width = 1.2) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const fx = box[0] + r() * box[2];
    const fy = box[1] + r() * box[3];
    const len = 5 + r() * 6;
    out.push(`M${n(fx)} ${n(fy)}q${n(len / 2)} ${n(2.5 + r() * 2)} ${n(len)} 0`);
  }
  return `<path d="${out.join('')}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function dust(r, cx, cy, spread, count, color = SLATE.chalk) {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const rad = Math.pow(r(), 0.7) * spread;
    const size = 0.5 + r() * 1.3;
    d += `<circle cx="${n(cx + Math.cos(a) * rad)}" cy="${n(cy + Math.sin(a) * rad * 0.7)}" r="${n(size)}" fill="${color}" opacity="${n(0.25 + r() * 0.55)}"/>`;
  }
  return d;
}

function eyes3(c, id, expr) {
  // Near eye larger, far eye foreshortened near the beak.
  const near = [124, 72];
  const far = [151, 69];
  const eye = (cx, cy, rx, ry, k) => {
    let g = `<ellipse cx="${cx}" cy="${cy}" rx="${n(rx)}" ry="${n(ry)}" fill="url(#${id}-e)"/>`;
    g += `<circle cx="${n(cx - rx * 0.3)}" cy="${n(cy - ry * 0.38)}" r="${n(rx * 0.42)}" fill="#fbfaf6"/>`;
    g += `<circle cx="${n(cx + rx * 0.35)}" cy="${n(cy + ry * 0.3)}" r="${n(rx * 0.17)}" fill="#fbfaf6" opacity=".85"/>`;
    g += `<path d="M${n(cx - rx * 0.7)} ${n(cy + ry * 0.55)} q${n(rx * 0.7)} ${n(ry * 0.35)} ${n(rx * 1.4)} 0" fill="none" stroke="${SLATE.rim}" stroke-opacity=".45" stroke-width="${n(k)}" stroke-linecap="round"/>`;
    return g;
  };
  const lid = (cx, cy, rx, ry, cover) =>
    `<path d="M${n(cx - rx - 1.5)} ${n(cy - ry - 2)} H${n(cx + rx + 1.5)} V${n(cy - ry + ry * 2 * cover)} Q${n(cx)} ${n(cy - ry + ry * 2 * cover + 3)} ${n(cx - rx - 1.5)} ${n(cy - ry + ry * 2 * cover)} Z" fill="url(#${id}-h)"/><path d="M${n(cx - rx - 1)} ${n(cy - ry + ry * 2 * cover)} Q${n(cx)} ${n(cy - ry + ry * 2 * cover + 3)} ${n(cx + rx + 1)} ${n(cy - ry + ry * 2 * cover)}" fill="none" stroke="${c.deep}" stroke-width="2" stroke-linecap="round"/>`;
  const arc = (cx, cy, w, up = true) => `<path d="M${n(cx - w)} ${n(cy + (up ? 2 : -2))} Q${n(cx)} ${n(cy + (up ? -8 : 8))} ${n(cx + w)} ${n(cy + (up ? 2 : -2))}" fill="none" stroke="#14171c" stroke-width="3.2" stroke-linecap="round"/>`;
  switch (expr) {
    case 'happy':
      return arc(near[0], near[1], 9) + arc(far[0], far[1], 5.5);
    case 'sleepy':
      return arc(near[0], near[1] + 2, 9, false) + arc(far[0], far[1] + 2, 5.5, false);
    case 'surprised':
      return `<ellipse cx="${near[0]}" cy="${near[1]}" rx="11" ry="13" fill="#f6f3ea"/><ellipse cx="${far[0]}" cy="${far[1]}" rx="7" ry="11" fill="#f6f3ea"/>${eye(near[0] + 1, near[1] + 1, 5, 6, 1)}${eye(far[0] + 1, far[1] + 1, 3.4, 5, 0.8)}`;
    case 'calm':
      return eye(near[0], near[1], 9, 11, 1.4) + lid(near[0], near[1], 9, 11, 0.46) + eye(far[0], far[1], 5.6, 9, 1) + lid(far[0], far[1], 5.6, 9, 0.46);
    case 'focused':
      return eye(near[0], near[1], 9, 11, 1.4) + lid(near[0], near[1], 9, 11, 0.3) + `<path d="M${near[0] - 12} ${near[1] - 16} L${near[0] + 9} ${near[1] - 11}" stroke="#2a2621" stroke-width="3.4" stroke-linecap="round"/>` + eye(far[0], far[1], 5.6, 9, 1) + lid(far[0], far[1], 5.6, 9, 0.3);
    default: // bold
      return eye(near[0], near[1], 9.5, 11.5, 1.4) + eye(far[0], far[1], 6, 9.4, 1) + `<path d="M${near[0] - 12} ${near[1] - 18} Q${near[0] - 2} ${near[1] - 22} ${near[0] + 9} ${near[1] - 14}" fill="none" stroke="${c.deep}" stroke-width="3.6" stroke-linecap="round"/><path d="M${far[0] - 6} ${far[1] - 15} Q${far[0]} ${far[1] - 17} ${far[0] + 5} ${far[1] - 13}" fill="none" stroke="${c.deep}" stroke-width="3" stroke-linecap="round"/>`;
  }
}

function beak3(c, id, expr) {
  const open = expr === 'bold' || expr === 'surprised' || expr === 'happy';
  const upper = 'M147 83 C158 72 186 71 201 80 C206 84 204 89 197 90 C182 93 162 94 151 91 C148 89 147 86 147 83 Z';
  let g = '';
  if (open) {
    const wide = expr === 'surprised';
    g += `<path d="M151 89 C166 ${wide ? 108 : 101} 184 ${wide ? 106 : 100} 195 90 L196 92 C188 ${wide ? 112 : 104} 168 ${wide ? 114 : 106} 154 98 Z" fill="#2c1715"/>`;
    g += `<path d="M163 ${wide ? 103 : 99} C171 ${wide ? 107 : 103} 180 ${wide ? 106 : 102} 186 ${wide ? 100 : 97} C182 ${wide ? 107 : 102} 172 ${wide ? 109 : 104} 165 ${wide ? 106 : 101} Z" fill="#c4807a"/>`;
    g += `<path d="M154 ${wide ? 101 : 97} C168 ${wide ? 112 : 105} 184 ${wide ? 111 : 103} 194 ${wide ? 98 : 94} C191 ${wide ? 108 : 102} 174 ${wide ? 116 : 108} 158 ${wide ? 108 : 102} Z" fill="url(#${id}-k)"/>`;
  } else {
    g += `<path d="M151 90 C166 95 184 95 196 90 C192 98 174 101 158 98 Z" fill="url(#${id}-k)"/>`;
  }
  g += `<path d="${upper}" fill="url(#${id}-k)"/>`;
  g += `<path d="M156 79 C168 73 186 73 197 80" fill="none" stroke="#f6dcc6" stroke-opacity=".75" stroke-width="2" stroke-linecap="round"/>`;
  g += `<ellipse cx="175" cy="80.5" rx="2.4" ry="1.2" fill="${c.beakDark}"/>`;
  if (!open) g += `<path d="M152 90 C168 94 184 94 197 89" fill="none" stroke="${c.beakDark}" stroke-width="1.8" stroke-linecap="round"/><path d="M151 90 C147 93 143 92 141 88" fill="none" stroke="${c.deep}" stroke-width="2" stroke-linecap="round"/>`;
  return g;
}

function chalkStick(id, r, defs) {
  // A porous stick of chalk, one end worn flat, the other broken.
  let g = `<defs><linearGradient id="${id}-ch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".4" stop-color="#e9e6dd"/><stop offset="1" stop-color="#b9b5aa"/></linearGradient></defs>`;
  g += `<path d="M0 -7 H50 L54 -4 L52 0 L55 3 L50 7 H0 C-3 7 -4 -7 0 -7 Z" fill="url(#${id}-ch)"/>`;
  g += `<ellipse cx="0" cy="0" rx="3.2" ry="7" fill="#f7f5ef"/>`;
  let pores = '';
  for (let i = 0; i < 16; i++) pores += `<circle cx="${n(6 + r() * 44)}" cy="${n(-5 + r() * 10)}" r="${n(0.4 + r() * 0.6)}" fill="#a39f94" opacity=".55"/>`;
  g += pores;
  g += `<path d="M6 -4.5 H46" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" stroke-linecap="round"/>`;
  g += `<g filter="url(#${defs}-blur1)">${dust(r, -6, 4, 12, 18)}</g>`;
  return g;
}

function crayon(id, c, color, band) {
  // Wax crayon in a paper wrapper: printed bands, a zigzag, worn conical tip with a sheen.
  let g = `<defs><linearGradient id="${id}-cr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".45"/><stop offset=".3" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>`;
  g += `<path d="M0 -7 H44 V7 H0 C-3 7 -3 -7 0 -7 Z" fill="${color}"/>`;
  g += `<path d="M44 -7 H52 L66 -2 C68 -1 68 1 66 2 L52 7 H44 Z" fill="${band}"/>`;
  g += `<path d="M4 -7 V7 M8 -7 V7 M36 -7 V7 M40 -7 V7" stroke="${band}" stroke-width="2"/>`;
  g += `<path d="M12 2 l3 -4 l3 4 l3 -4 l3 4 l3 -4 l3 4" fill="none" stroke="#f4efe6" stroke-opacity=".6" stroke-width="1.2" stroke-linejoin="round"/>`;
  g += `<path d="M0 -7 H66 V7 H0 Z" fill="url(#${id}-cr)"/>`;
  g += `<path d="M53 -4 L64 -1.2" stroke="#fff" stroke-opacity=".65" stroke-width="1.3" stroke-linecap="round"/>`;
  return g;
}

function wing(c, id, r, prop, defs, pose) {
  // Shoulder at 0 0, the wing points down and to the right; the tip holds the prop.
  let g = `<path d="M-6 -2 C16 -16 52 -8 64 16 C72 34 62 54 42 60 L12 54 C-2 42 -12 16 -6 -2 Z" fill="#000" opacity=".28" filter="url(#${defs}-soft)"/>`;
  g += `<path d="M-10 -8 C12 -22 48 -14 60 10 C68 28 58 48 38 54 L33 47 L27 54 L21 46 L13 50 L8 43 C-6 34 -16 10 -10 -8 Z" fill="url(#${id}-w)"/>`;
  g += `<path d="M2 6 C14 4 30 10 40 22 M0 18 C12 18 26 24 34 34 M2 30 C10 32 20 36 26 44" fill="none" stroke="${c.wingDark}" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/>`;
  g += `<path d="M-8 -6 C10 -18 42 -14 56 6" fill="none" stroke="${SLATE.rim}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`;
  // Chalk dust caught in the feathers.
  g += `<g opacity=".9">${dust(r, 36, 40, 14, 22)}</g>`;
  if (prop === 'chalk') g += `<g transform="translate(44 44) rotate(${pose === 'draw' ? 0 : -20})">${chalkStick(id, r, defs)}</g>`;
  if (prop === 'crayon') g += `<g transform="translate(36 46) rotate(-8)">${crayon(id, c, '#c9a3a6', '#9d7378')}</g>`;
  return g;
}

function threeBody(c, id, r, expr, pose, prop, defs) {
  let g = '';
  // Feet, far then near.
  g += `<path d="M118 224 C112 234 112 240 120 240 L146 240 C150 238 146 232 138 230 Z" fill="url(#${id}-f)"/>`;
  g += `<path d="M78 224 C70 234 70 241 78 241 L106 241 C112 239 106 232 96 230 Z" fill="url(#${id}-f)"/><path d="M84 238 l6 -6 M94 239 l4 -6" stroke="${c.feetDark}" stroke-width="1.4" stroke-linecap="round"/>`;
  // Tail tuft.
  g += `<path d="M50 152 C32 142 22 126 24 110 C36 120 50 126 64 130 Z" fill="url(#${id}-b)"/><path d="M48 146 C36 140 30 130 30 120" fill="none" stroke="${SLATE.rim}" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>`;
  // Body with key light, ambient occlusion under the head and rim light on the back.
  g += `<path d="${BODY}" fill="url(#${id}-b)"/>`;
  g += `<ellipse cx="120" cy="124" rx="40" ry="14" fill="${c.deep}" opacity=".45" filter="url(#${defs}-soft)"/>`;
  g += `<path d="M46 178 C42 136 70 113 104 112" fill="none" stroke="url(#${id}-rim)" stroke-width="3.4" stroke-linecap="round" filter="url(#${defs}-blur1)"/>`;
  g += feathers(r, [96, 150, 66, 66], 26, c.light, 0.5);
  g += feathers(r, [60, 186, 90, 36], 18, c.deep, 0.28);
  // Head.
  g += `<circle cx="${HEAD_C[0]}" cy="${HEAD_C[1]}" r="${HEAD_R}" fill="url(#${id}-h)"/>`;
  g += `<path d="M74 62 C80 42 98 31 120 31" fill="none" stroke="url(#${id}-rim)" stroke-width="3.2" stroke-linecap="round" filter="url(#${defs}-blur1)"/>`;
  g += feathers(r, [86, 44, 50, 22], 10, c.light, 0.45, 1.1);
  // Tuft: three curls.
  g += `<path d="M108 34 C102 20 108 10 118 12 C112 18 114 26 118 33 Z M118 33 C120 18 132 12 140 18 C130 20 126 26 124 34 Z M114 33 C110 26 98 22 92 28 C100 28 106 30 110 35 Z" fill="url(#${id}-h)"/>`;
  g += `<ellipse cx="114" cy="98" rx="12" ry="8" fill="url(#${id}-c)"/>`;
  g += eyes3(c, id, expr);
  g += beak3(c, id, expr);
  // Wing with the prop, posed.
  // Drawing: the wing reaches out in front, chalk up toward the slate. Holding: close to the chest.
  const arm = pose === 'draw' ? 'translate(112 150) rotate(-40) scale(1.3)' : `translate(86 146) rotate(${pose === 'hold' ? 6 : 14})`;
  g += `<g transform="${arm}">${wing(c, id, r, prop, defs, pose)}</g>`;
  return g;
}

// ---------- Front view ----------

function frontBody(c, id, r, expr, defs) {
  let g = '';
  g += `<path d="M70 226 C62 236 64 241 72 241 L98 241 C102 239 98 232 90 230 Z M150 226 C158 236 156 241 148 241 L122 241 C118 239 122 232 130 230 Z" fill="url(#${id}-f)"/>`;
  g += `<ellipse cx="110" cy="174" rx="64" ry="58" fill="url(#${id}-b)"/>`;
  g += `<path d="M50 176 C48 140 74 118 108 116" fill="none" stroke="url(#${id}-rim)" stroke-width="3.4" stroke-linecap="round" filter="url(#${defs}-blur1)"/>`;
  g += `<ellipse cx="110" cy="128" rx="38" ry="12" fill="${c.deep}" opacity=".45" filter="url(#${defs}-soft)"/>`;
  g += feathers(r, [80, 156, 60, 60], 26, c.light, 0.5);
  // Both wings at the sides.
  g += `<path d="M50 150 C30 160 28 196 46 210 L52 204 L56 212 L62 204 C66 186 62 162 50 150 Z" fill="url(#${id}-w)"/>`;
  g += `<path d="M170 150 C190 160 192 196 174 210 L168 204 L164 212 L158 204 C154 186 158 162 170 150 Z" fill="url(#${id}-w)"/>`;
  g += `<g>${dust(r, 52, 200, 10, 12)}${dust(r, 168, 200, 10, 12)}</g>`;
  g += `<circle cx="110" cy="80" r="48" fill="url(#${id}-h)"/>`;
  g += `<path d="M66 66 C72 46 90 34 112 33" fill="none" stroke="url(#${id}-rim)" stroke-width="3.2" stroke-linecap="round" filter="url(#${defs}-blur1)"/>`;
  g += `<path d="M104 36 C98 22 104 12 114 14 C108 20 110 28 114 35 Z M114 35 C116 20 128 14 136 20 C126 22 122 28 120 36 Z" fill="url(#${id}-h)"/>`;
  g += `<ellipse cx="80" cy="98" rx="11" ry="7" fill="url(#${id}-c)"/><ellipse cx="140" cy="98" rx="11" ry="7" fill="url(#${id}-c)"/>`;
  const eye = (cx) => `<ellipse cx="${cx}" cy="76" rx="8.5" ry="10.5" fill="url(#${id}-e)"/><circle cx="${cx - 2.6}" cy="72" r="3.6" fill="#fbfaf6"/><circle cx="${cx + 3}" cy="79.5" r="1.4" fill="#fbfaf6" opacity=".85"/>`;
  const lid = (cx, cover) => `<path d="M${cx - 10} 64 H${cx + 10} V${n(65.5 + 21 * cover)} Q${cx} ${n(68.5 + 21 * cover)} ${cx - 10} ${n(65.5 + 21 * cover)} Z" fill="url(#${id}-h)"/><path d="M${cx - 9.5} ${n(65.5 + 21 * cover)} Q${cx} ${n(68.5 + 21 * cover)} ${cx + 9.5} ${n(65.5 + 21 * cover)}" fill="none" stroke="${c.deep}" stroke-width="2" stroke-linecap="round"/>`;
  g += eye(92) + eye(128);
  if (expr === 'calm') g += lid(92, 0.46) + lid(128, 0.46);
  if (expr === 'bold') g += `<path d="M80 58 Q90 54 100 62 M120 62 Q130 54 140 58" fill="none" stroke="${c.deep}" stroke-width="3.4" stroke-linecap="round"/>`;
  // Beak seen from the front: wide and flat.
  g += `<path d="M84 98 C92 90 128 90 136 98 C138 108 126 112 110 112 C94 112 82 108 84 98 Z" fill="url(#${id}-k)"/>`;
  g += `<path d="M90 110 C98 118 122 118 130 110" fill="none" stroke="${c.beakDark}" stroke-width="2.4" stroke-linecap="round"/>`;
  g += `<path d="M94 96 C102 92 118 92 126 96" fill="none" stroke="#f6dcc6" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/><ellipse cx="104" cy="99" rx="1.8" ry="1.1" fill="${c.beakDark}"/><ellipse cx="116" cy="99" rx="1.8" ry="1.1" fill="${c.beakDark}"/>`;
  return g;
}

// ---------- Props on their own, for the character sheet ----------

export function propChalk(x, y, s = 2) {
  const r = rng(5);
  return `<g transform="translate(${x} ${y}) scale(${s}) rotate(-12)">${chalkStick(`pc${++uid}`, r, 'x')}</g>`;
}

export function propCrayon(x, y, s = 2, color = '#c9a3a6', band = '#9d7378') {
  return `<g transform="translate(${x} ${y}) scale(${s}) rotate(-12)">${crayon(`pk${++uid}`, CAST.otto, color, band)}</g>`;
}

export function propEraser(x, y, s = 2) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="0" y="0" width="64" height="18" rx="4" fill="#3b424b"/><rect x="0" y="0" width="64" height="7" rx="3" fill="#59626d"/><path d="M4 18 H60" stroke="#262b31" stroke-width="2"/><path d="M6 22 C20 24 44 24 58 22" stroke="#ece9e1" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/></g>`;
}

export function propNote(x, y, s = 1, color = '#e6d9a8', rot = -4, text = '') {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M4 6 H108 V100 L96 112 H4 Z" fill="#000" opacity=".35" filter="url(#x-soft)"/><path d="M0 0 H104 V96 L92 108 H0 Z" fill="${color}"/><path d="M104 96 L92 108 L92 98 C92 96 94 96 96 96 Z" fill="#000" opacity=".18"/><rect x="34" y="-8" width="38" height="14" rx="2" fill="#ece9e1" opacity=".55" transform="rotate(3 52 0)"/>${text ? `<text x="12" y="40" font-family="'Kalam','Segoe Print',cursive" font-size="17" fill="#2a2620">${text}</text>` : ''}</g>`;
}

/** A collaborator cursor with a name tag, its tip at 0 0. */
export function cursorTag(color, name) {
  const w = 16 + name.length * 7.6;
  return `<path d="M0 0 L0 19 L5 14.4 L8.6 22 L11.6 20.6 L8 13.2 L14.8 13 Z" fill="${color}" stroke="#0a0c0f" stroke-width="1.5" stroke-linejoin="round"/><rect x="13" y="18" width="${n(w)}" height="22" rx="11" fill="${color}"/><text x="${n(13 + w / 2)}" y="33.5" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="600" fill="#101317">${name}</text>`;
}

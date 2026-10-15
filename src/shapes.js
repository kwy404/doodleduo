// What each element looks like, as a short list of drawing primitives. The canvas renderer and
// the SVG export both read these, so the screen, the PNG and the SVG agree.
//   { t: 'path', d, fill, stroke, width, alpha }   an SVG path string (Path2D reads it too)
//   { t: 'text', x, y, lines, fs, color, font }     lines start at y, one every fs * LINE
//   { t: 'image', x, y, w, h, src }
//   { t: 'note', x, y, w, h, fill }                 the paper of a sticky note

import { STROKE_STYLE, outlinePath, strokeOutline } from './smooth.js';
import { arrowHead, normBox, strokePoints, strokeSize } from './geometry.js';

export const LINE = 1.3;
export const NOTE_PAD = 14;
export const NOTE_FS = 20;
export const TEXT_FONT = "'Kalam', 'Segoe Print', 'Comic Sans MS', cursive";

/** Board palettes. ink is the default stroke color and follows the theme. */
export const THEMES = {
  dark: { paper: '#121518', dot: '#262b31', ink: '#e9e6dd', noteText: '#1b1d20' },
  light: { paper: '#f2f1ec', dot: '#d6d4cb', ink: '#24272b', noteText: '#1b1d20' },
};

/** Muted ink colors for strokes, shapes and text. */
export const INKS = ['ink', '#9fb4c9', '#c9a3a6', '#a9bf9f', '#d8c08f', '#b5a8cc'];
/** Muted sticky note papers. */
export const NOTES = ['#e6d9a8', '#c9d8b8', '#e6c3bd', '#bccfdd', '#d3c6df'];

export const resolveColor = (c, theme) => (!c || c === 'ink' ? theme.ink : c);

const f = (n) => (Math.round(n * 100) / 100).toString();

/** Breaks text into lines that fit maxWidth, keeping the line breaks typed by the person. */
export function wrapText(text, maxWidth, measure) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!maxWidth || !Number.isFinite(maxWidth)) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() && measure(next.trimEnd()) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
      // A single word longer than the line is cut where it stops fitting.
      while (measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** A rough text width for places without a canvas (tests, the SVG export in Node). */
export const roughMeasure = (fs) => (s) => s.length * fs * 0.5;

/**
 * Primitives for one element.
 * ctx: { theme, measure(text, fs) }
 */
export function primitives(el, ctx) {
  const theme = ctx.theme || THEMES.dark;
  const color = resolveColor(el.color, theme);
  const size = el.size || 2;
  switch (el.type) {
    case 'pen':
    case 'hl': {
      const style = STROKE_STYLE[el.type];
      const poly = strokeOutline(strokePoints(el), { size: strokeSize(el), thinning: style.thinning, smoothing: style.smoothing });
      return poly.length ? [{ t: 'path', d: outlinePath(poly), fill: color, alpha: style.alpha }] : [];
    }
    case 'rect': {
      const b = normBox(el.x, el.y, el.w, el.h);
      const r = Math.min(8, b.w / 4, b.h / 4);
      const d = `M${f(b.x + r)} ${f(b.y)}H${f(b.x + b.w - r)}Q${f(b.x + b.w)} ${f(b.y)} ${f(b.x + b.w)} ${f(b.y + r)}V${f(b.y + b.h - r)}Q${f(b.x + b.w)} ${f(b.y + b.h)} ${f(b.x + b.w - r)} ${f(b.y + b.h)}H${f(b.x + r)}Q${f(b.x)} ${f(b.y + b.h)} ${f(b.x)} ${f(b.y + b.h - r)}V${f(b.y + r)}Q${f(b.x)} ${f(b.y)} ${f(b.x + r)} ${f(b.y)}Z`;
      return [{ t: 'path', d, fill: el.fill ? color : null, fillAlpha: 0.22, stroke: color, width: size }];
    }
    case 'ellipse': {
      const b = normBox(el.x, el.y, el.w, el.h);
      const rx = Math.max(0.5, b.w / 2);
      const ry = Math.max(0.5, b.h / 2);
      const cx = b.x + rx;
      const cy = b.y + ry;
      const d = `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
      return [{ t: 'path', d, fill: el.fill ? color : null, fillAlpha: 0.22, stroke: color, width: size }];
    }
    case 'line':
    case 'arrow': {
      const x2 = el.x + el.w;
      const y2 = el.y + el.h;
      let d = `M${f(el.x)} ${f(el.y)}L${f(x2)} ${f(y2)}`;
      if (el.type === 'arrow') {
        const [a, b, c] = arrowHead(el.x, el.y, x2, y2, size);
        d += `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}L${f(c[0])} ${f(c[1])}`;
      }
      return [{ t: 'path', d, fill: null, stroke: color, width: size }];
    }
    case 'text': {
      const fs = el.fs || 28;
      return [{ t: 'text', x: el.x, y: el.y, lines: String(el.text || '').split('\n'), fs, color, font: TEXT_FONT }];
    }
    case 'note': {
      const b = normBox(el.x, el.y, el.w, el.h);
      const fs = el.fs || NOTE_FS;
      const measure = ctx.measure ? (s) => ctx.measure(s, fs) : roughMeasure(fs);
      const lines = wrapText(el.text || '', b.w - NOTE_PAD * 2, measure);
      const fit = Math.max(1, Math.floor((b.h - NOTE_PAD * 2) / (fs * LINE)));
      return [
        { t: 'note', x: b.x, y: b.y, w: b.w, h: b.h, fill: el.color && el.color !== 'ink' ? el.color : NOTES[0] },
        { t: 'text', x: b.x + NOTE_PAD, y: b.y + NOTE_PAD, lines: lines.slice(0, fit), fs, color: theme.noteText, font: TEXT_FONT },
      ];
    }
    case 'image': {
      const b = normBox(el.x, el.y, el.w, el.h);
      return [{ t: 'image', x: b.x, y: b.y, w: b.w, h: b.h, src: el.src }];
    }
    default:
      return [];
  }
}

/** The baseline of line i of a text primitive (canvas and SVG use the same one). */
export const baseline = (p, i) => p.y + i * p.fs * LINE + p.fs * 0.9;

/** Width and height of a text element, for its bounds. */
export function measureText(text, fs, measure) {
  const lines = String(text || '').split('\n');
  const w = Math.max(fs * 0.6, ...lines.map((l) => measure(l, fs)));
  return { w: Math.ceil(w), h: Math.ceil(lines.length * fs * LINE) };
}

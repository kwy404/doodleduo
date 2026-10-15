// SVG export: the visible elements as one standalone vector file. Images are embedded as data
// URLs so the file opens anywhere; text uses the board font with cursive fallbacks.

import { THEMES, baseline, primitives } from './shapes.js';
import { unionBounds } from './geometry.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (Math.round(v * 100) / 100).toString();

/**
 * elements: bottom first (Board.visible()). options: theme ('dark' or 'light'), padding,
 * images (hash to data URL), measure(text, fs), background (false for a transparent file).
 */
export function toSvg(elements, { theme = 'light', padding = 32, images = {}, measure, background = true } = {}) {
  const palette = THEMES[theme] || THEMES.light;
  const box = unionBounds(elements) || { x: 0, y: 0, w: 320, h: 200 };
  const x = Math.floor(box.x - padding);
  const y = Math.floor(box.y - padding);
  const w = Math.ceil(box.w + padding * 2);
  const h = Math.ceil(box.h + padding * 2);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`,
  ];
  if (background) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${palette.paper}"/>`);
  for (const el of elements) {
    for (const p of primitives(el, { theme: palette, measure })) {
      if (p.t === 'path') {
        const attrs = [`d="${p.d}"`];
        if (p.fill) attrs.push(`fill="${p.fill}"`);
        else attrs.push('fill="none"');
        if (p.fill && p.fillAlpha) attrs.push(`fill-opacity="${p.fillAlpha}"`);
        if (p.stroke) attrs.push(`stroke="${p.stroke}" stroke-width="${n(p.width)}" stroke-linecap="round" stroke-linejoin="round"`);
        if (p.alpha != null && p.alpha !== 1) attrs.push(`opacity="${p.alpha}"`);
        out.push(`<path ${attrs.join(' ')}/>`);
      } else if (p.t === 'note') {
        out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="6" fill="${p.fill}"/>`);
      } else if (p.t === 'text') {
        const tspans = p.lines.map((line, i) => `<tspan x="${n(p.x)}" y="${n(baseline(p, i))}">${esc(line)}</tspan>`).join('');
        out.push(`<text font-family="${esc(p.font)}" font-size="${n(p.fs)}" fill="${p.color}" xml:space="preserve">${tspans}</text>`);
      } else if (p.t === 'image') {
        const href = images[p.src];
        if (href) out.push(`<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none" href="${esc(href)}"/>`);
        else out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="none" stroke="${palette.dot}" stroke-dasharray="6 6"/>`);
      }
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

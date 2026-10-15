import { describe, expect, it } from 'vitest';
import { Board } from '../src/crdt.js';
import { toSvg } from '../src/svg.js';
import { THEMES, measureText, primitives, roughMeasure, wrapText } from '../src/shapes.js';

const IMG = 'c'.repeat(64);

describe('svg export', () => {
  it('draws every kind of element as vector shapes', () => {
    const b = new Board('a');
    b.create('s1', { type: 'pen', color: 'ink', size: 4 });
    b.addPoints('s1', [0, 0, 0.5, 40, 20, 0.7, 80, 0, 0.5]);
    b.create('h1', { type: 'hl', color: '#d8c08f', size: 18 });
    b.addPoints('h1', [0, 50, 0.5, 90, 50, 0.5]);
    b.create('r1', { type: 'rect', x: 0, y: 100, w: 80, h: 40, color: '#9fb4c9', size: 2, fill: true });
    b.create('e1', { type: 'ellipse', x: 100, y: 100, w: 60, h: 40, color: 'ink', size: 2 });
    b.create('a1', { type: 'arrow', x: 0, y: 200, w: 100, h: 0, color: 'ink', size: 2 });
    b.create('t1', { type: 'text', x: 0, y: 250, text: 'Hello <duo> & "friends"', fs: 24, color: 'ink' });
    b.create('n1', { type: 'note', x: 200, y: 0, w: 160, h: 160, text: 'Bring snacks', color: '#c9d8b8' });
    b.create('i1', { type: 'image', x: 200, y: 200, w: 40, h: 40, src: IMG });
    const svg = toSvg(b.visible(), { theme: 'light', images: { [IMG]: 'data:image/png;base64,AAAA' } });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`fill="${THEMES.light.paper}"`);
    expect(svg).toContain(`fill="${THEMES.light.ink}"`);
    expect(svg).toContain('opacity="0.35"');
    expect(svg).toContain('fill-opacity="0.22"');
    expect(svg).toContain('Hello &lt;duo&gt; &amp; &quot;friends&quot;');
    expect(svg).toContain('<image');
    expect(svg).toContain('fill="#c9d8b8"');
    expect((svg.match(/<path /g) || []).length).toBe(5);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('marks a missing picture instead of failing, and can skip the background', () => {
    const svg = toSvg([{ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'd'.repeat(64) }], { background: false, theme: 'dark' });
    expect(svg).toContain('stroke-dasharray');
    expect(svg).not.toContain(THEMES.dark.paper);
  });

  it('wraps note text and keeps typed line breaks', () => {
    const m = roughMeasure(10);
    expect(wrapText('one two three four', 45, m)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('a\nb', 100, m)).toEqual(['a', 'b']);
    expect(wrapText('abcdefghijklmnop', 40, m).every((l) => m(l) <= 40)).toBe(true);
    expect(measureText('ab\ncdef', 10, (s, fs) => s.length * fs)).toEqual({ w: 40, h: 26 });
    const [paper, text] = primitives({ type: 'note', x: 0, y: 0, w: 100, h: 60, text: 'x '.repeat(80) }, {});
    expect(paper.t).toBe('note');
    expect(text.lines.length).toBeLessThanOrEqual(1);
  });
});

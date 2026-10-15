import { describe, expect, it } from 'vitest';
import { arrowHead, bounds, eraserTouches, hit, moveFields, overlaps, resizeFields, segmentDistance, strokePoints, topAt, unionBounds } from '../src/geometry.js';

const pen = { id: 'p', type: 'pen', size: 4, points: [[0, 0, 0.5], [100, 0, 0.5]] };
const rect = { id: 'r', type: 'rect', x: 10, y: 10, w: 100, h: 50, size: 2 };

describe('geometry', () => {
  it('finds bounds for strokes, shapes and flipped boxes', () => {
    expect(bounds(pen)).toEqual({ x: -3, y: -3, w: 106, h: 6 });
    expect(bounds({ type: 'note', x: 50, y: 50, w: -20, h: -10 })).toEqual({ x: 30, y: 40, w: 20, h: 10 });
    expect(unionBounds([{ type: 'note', x: 0, y: 0, w: 10, h: 10 }, { type: 'note', x: 20, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
    expect(unionBounds([])).toBeNull();
  });

  it('hits strokes near the line, outlines on the edge and filled shapes inside', () => {
    expect(hit(pen, 50, 3)).toBe(true);
    expect(hit(pen, 50, 20)).toBe(false);
    expect(hit(rect, 10, 30)).toBe(true);
    expect(hit(rect, 60, 35)).toBe(false);
    expect(hit({ ...rect, fill: true }, 60, 35)).toBe(true);
    const ell = { type: 'ellipse', x: 0, y: 0, w: 100, h: 100, size: 2 };
    expect(hit(ell, 50, 1)).toBe(true);
    expect(hit(ell, 50, 50)).toBe(false);
    expect(hit({ type: 'arrow', x: 0, y: 0, w: 100, h: 100, size: 2 }, 50, 51)).toBe(true);
    expect(topAt([rect, { ...rect, id: 'top', fill: true }], 60, 35).id).toBe('top');
  });

  it('applies the transform of a moved and resized stroke', () => {
    const moved = { ...pen, ...moveFields(pen, 10, 5) };
    expect(strokePoints(moved)[0]).toEqual([10, 5, 0.5]);
    const from = bounds(pen);
    const to = { x: from.x, y: from.y, w: from.w * 2, h: from.h };
    const big = { ...pen, ...resizeFields(pen, from, to) };
    expect(bounds(big).w).toBeGreaterThan(from.w * 1.9);
  });

  it('resizes boxes, lines and text with the selection', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 0, y: 0, w: 200, h: 50 };
    expect(resizeFields({ type: 'note', x: 50, y: 50, w: 50, h: 50 }, from, to)).toEqual({ x: 100, y: 25, w: 100, h: 25 });
    expect(resizeFields({ type: 'line', x: 0, y: 0, w: 100, h: 100 }, from, to)).toEqual({ x: 0, y: 0, w: 200, h: 50 });
    expect(resizeFields({ type: 'text', x: 0, y: 0, w: 100, h: 100, fs: 20 }, from, to).fs).toBe(10);
  });

  it('selects by overlap and erases along a path', () => {
    expect(overlaps(rect, { x: 100, y: 50, w: 50, h: 50 })).toBe(true);
    expect(overlaps(rect, { x: 200, y: 200, w: -50, h: -50 })).toBe(false);
    expect(eraserTouches(pen, 50, -30, 50, 30, 4)).toBe(true);
    expect(eraserTouches(pen, 50, 20, 60, 30, 4)).toBe(false);
    expect(segmentDistance(5, 5, 0, 0, 10, 0)).toBe(5);
  });

  it('draws an arrow head at the end of the line', () => {
    const [a, tip, c] = arrowHead(0, 0, 100, 0, 2);
    expect(tip).toEqual([100, 0]);
    expect(a[0]).toBeLessThan(100);
    expect(a[1]).toBeCloseTo(-c[1], 5);
  });
});

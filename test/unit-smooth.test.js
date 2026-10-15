import { describe, expect, it } from 'vitest';
import { flatPressure, outlinePath, radiusAt, relax, speedPressure, speedToPressure, streamline, strokeOutline, thin } from '../src/smooth.js';

const jitter = (n, amp, seed = 3) => {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return Array.from({ length: n }, (_, i) => [i * 4, 100 + r() * amp, 0.5]);
};
const roughness = (pts) => {
  let sum = 0;
  for (let i = 1; i < pts.length - 1; i++) sum += Math.abs(pts[i - 1][1] - 2 * pts[i][1] + pts[i + 1][1]);
  return sum / (pts.length - 2);
};

describe('streamline', () => {
  it('pulls each sample part of the way, which removes jitter', () => {
    const raw = jitter(80, 6);
    const out = [];
    for (const p of raw) out.push(streamline(out[out.length - 1], p, 0.5));
    expect(roughness(out)).toBeLessThan(roughness(raw) * 0.6);
    expect(streamline(null, [3, 4])).toEqual([3, 4, 0.5]);
    expect(streamline([0, 0, 1], [10, 0, 0.2], 0)).toEqual([10, 0, 0.2]);
    expect(streamline([0, 0, 1], [10, 0, 0.2], 0.5)).toEqual([5, 0, 0.2]);
  });

  it('the moving average smooths the centerline and keeps the ends', () => {
    const raw = jitter(50, 5);
    const out = relax(raw, 2);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    expect(roughness(out)).toBeLessThan(roughness(raw) * 0.5);
  });
});

describe('pressure', () => {
  it('detects devices without real pressure', () => {
    expect(flatPressure([[0, 0, 0.5], [1, 1, 0.5]])).toBe(true);
    expect(flatPressure([[0, 0, 0.2], [1, 1, 0.7]])).toBe(false);
  });

  it('turns speed into pressure: fast is thin, slow is full', () => {
    const slow = speedPressure(Array.from({ length: 30 }, (_, i) => [i, 0, 0.5]));
    const fast = speedPressure(Array.from({ length: 30 }, (_, i) => [i * 40, 0, 0.5]));
    expect(slow[29][2]).toBeGreaterThan(0.8);
    expect(fast[29][2]).toBeLessThan(0.3);
    expect(speedToPressure(0.5, 0)).toBeGreaterThan(0.5);
  });

  it('makes the line wider with more pressure, and the highlighter constant', () => {
    expect(radiusAt(10, 1)).toBeGreaterThan(radiusAt(10, 0.2));
    expect(radiusAt(10, 1, 0)).toBe(radiusAt(10, 0.1, 0));
    expect(radiusAt(10, 1, 0)).toBe(5);
  });
});

describe('outline', () => {
  const width = (poly, x) => {
    const ys = poly.filter((p) => Math.abs(p[0] - x) < 2.5).map((p) => p[1]);
    return Math.max(...ys) - Math.min(...ys);
  };

  it('draws a single point as a round dot of the stroke size', () => {
    const poly = strokeOutline([[10, 10, 1]], { size: 8, thinning: 0 });
    expect(poly.length).toBeGreaterThan(8);
    for (const [x, y] of poly) expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(4, 5);
  });

  it('follows the pressure along the line', () => {
    const pts = Array.from({ length: 41 }, (_, i) => [i * 5, 0, i / 40]);
    const poly = strokeOutline(pts, { size: 20, smoothing: 0 });
    expect(width(poly, 190)).toBeGreaterThan(width(poly, 10) * 1.5);
  });

  it('is a closed loop around the line with round caps', () => {
    const pts = [[0, 0, 0.5], [50, 0, 0.5], [100, 0, 0.5]];
    const poly = strokeOutline(pts, { size: 10, thinning: 0, capSteps: 8 });
    expect(Math.min(...poly.map((p) => p[0]))).toBeCloseTo(-5, 1);
    expect(Math.max(...poly.map((p) => p[0]))).toBeCloseTo(105, 1);
    expect(Math.max(...poly.map((p) => p[1]))).toBeCloseTo(5, 5);
    expect(poly).toHaveLength(3 + 7 + 3 + 7);
  });

  it('survives duplicates, bad numbers and empty input', () => {
    expect(strokeOutline([])).toEqual([]);
    const poly = strokeOutline([[1, 1, 0.5], [1, 1, 0.5], [NaN, 2, 0.5], [5, 5]], { size: 4 });
    expect(poly.length).toBeGreaterThan(4);
    expect(poly.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('writes a closed path of quadratic curves, the same every time', () => {
    const poly = strokeOutline(jitter(20, 3), { size: 6 });
    const d = outlinePath(poly);
    expect(d).toMatch(/^M-?[\d.]+ -?[\d.]+(Q-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+)+Z$/);
    expect((d.match(/Q/g) || []).length).toBe(poly.length);
    expect(outlinePath(strokeOutline(jitter(20, 3), { size: 6 }))).toBe(d);
    expect(outlinePath([])).toBe('');
  });

  it('thins out samples that barely moved', () => {
    const pts = [[0, 0], [0.1, 0], [0.2, 0], [5, 0], [5.1, 0]];
    expect(thin(pts, 1)).toEqual([[0, 0], [5, 0], [5.1, 0]]);
  });
});

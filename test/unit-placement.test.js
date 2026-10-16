import { describe, expect, it } from 'vitest';
import { nextIndex, placeMenu, placeSubmenu, typeahead } from '../src/placement.js';

describe('context menu placement', () => {
  const vp = { vw: 1000, vh: 700 };

  it('opens right and below the point when there is room', () => {
    expect(placeMenu({ x: 100, y: 120, w: 220, h: 300, ...vp })).toEqual({ x: 100, y: 120, maxH: 684 });
  });

  it('flips left and up near the bottom right corner and stays inside', () => {
    const p = placeMenu({ x: 990, y: 690, w: 220, h: 300, ...vp });
    expect(p).toMatchObject({ x: 770, y: 390 });
    expect(p.x + 220).toBeLessThanOrEqual(1000 - 8);
    expect(p.y + 300).toBeLessThanOrEqual(700 - 8);
  });

  it('clamps to the margin when flipping is not enough, and pins a too tall menu to the top', () => {
    expect(placeMenu({ x: 150, y: 20, w: 220, h: 300, vw: 320, vh: 300 })).toMatchObject({ x: 8, y: 8 });
    expect(placeMenu({ x: 10, y: 400, w: 200, h: 900, ...vp })).toMatchObject({ y: 8, maxH: 684 });
  });

  it('opens a submenu on the right, on the left without room, and over the parent on a phone', () => {
    expect(placeSubmenu({ ix: 100, iy: 200, iw: 220, ih: 36, w: 180, h: 200, ...vp })).toMatchObject({ x: 316, y: 200, side: 'right' });
    expect(placeSubmenu({ ix: 700, iy: 200, iw: 220, ih: 36, w: 180, h: 200, ...vp })).toMatchObject({ x: 524, side: 'left' });
    const phone = placeSubmenu({ ix: 40, iy: 200, iw: 260, ih: 36, w: 200, h: 200, vw: 320, vh: 640 });
    expect(phone.side).toBe('over');
    expect(phone.x).toBeGreaterThanOrEqual(8);
    expect(phone.x + 200).toBeLessThanOrEqual(320 - 8);
  });

  it('lifts a submenu that would run off the bottom so it ends at the item', () => {
    const p = placeSubmenu({ ix: 100, iy: 600, iw: 220, ih: 36, w: 180, h: 200, ...vp });
    expect(p.y).toBe(436);
  });
});

describe('menu keyboard helpers', () => {
  const items = [{ label: 'Copy' }, { separator: true }, { label: 'Cut', disabled: true }, { label: 'Delete' }, { label: 'Duplicate' }];

  it('moves to the next enabled item and wraps around', () => {
    expect(nextIndex(items, 0, 1)).toBe(3);
    expect(nextIndex(items, 4, 1)).toBe(0);
    expect(nextIndex(items, 0, -1)).toBe(4);
    expect(nextIndex([{ label: 'x', disabled: true }], 0, 1)).toBe(-1);
  });

  it('jumps to the next item that starts with the typed letters', () => {
    expect(typeahead(items, 0, 'd')).toBe(3);
    expect(typeahead(items, 3, 'd')).toBe(4);
    expect(typeahead(items, 4, 'du')).toBe(4);
    expect(typeahead(items, 0, 'cu')).toBe(-1);
  });
});

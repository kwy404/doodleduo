import { describe, expect, it } from 'vitest';
import { Board } from '../src/crdt.js';
import { FILE_FORMAT, FormatError, bytesDataUrl, cleanName, dataUrlBytes, decodeBoardFile, encodeBoardFile, fileName } from '../src/format.js';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function sample() {
  const b = new Board('ana');
  b.create('s1', { type: 'pen', color: 'ink', size: 4 });
  b.addPoints('s1', [0, 0, 0.5, 10, 10, 0.7]);
  b.create('n1', { type: 'note', x: 5, y: 5, w: 200, h: 200, text: 'Ideas\nfor Saturday', color: '#e6d9a8' });
  b.create('i1', { type: 'image', x: 0, y: 0, w: 64, h: 64, src: HASH });
  b.change('n1', { x: 40 });
  return b;
}

describe('board file', () => {
  it('round trips the board, the state and the images it uses', () => {
    const b = sample();
    const text = encodeBoardFile({ board: { id: 'board123', name: 'Trip plan', created: 1 }, state: b.toState(), blobs: { [HASH]: PNG, [OTHER]: PNG } });
    const data = JSON.parse(text);
    expect(data).toMatchObject({ format: FILE_FORMAT, version: 1, board: { id: 'board123', name: 'Trip plan', created: 1 } });
    expect(Object.keys(data.blobs)).toEqual([HASH]); // only images the board uses
    const back = decodeBoardFile(text);
    const c = new Board('bia');
    c.mergeState(back.state);
    expect(c.fingerprint()).toBe(b.fingerprint());
    expect(back.blobs[HASH]).toBe(PNG);
  });

  it('is canonical: the same board always gives the same text', () => {
    const one = encodeBoardFile({ board: { id: 'board123', name: 'x', created: 1 }, state: sample().toState() });
    const b = new Board('other');
    b.mergeState(sample().toState());
    const two = encodeBoardFile({ board: { id: 'board123', name: 'x', created: 1 }, state: b.toState() });
    expect(two).toBe(one);
  });

  it('merges a file into a board that already has some of it', () => {
    const file = decodeBoardFile(encodeBoardFile({ board: { id: 'board123', name: 'x' }, state: sample().toState() }));
    const mine = new Board('caio');
    mine.mergeState(sample().toState());
    mine.create('r1', { type: 'rect', x: 0, y: 0, w: 1, h: 1 });
    mine.mergeState(file.state);
    expect(mine.visible().map((e) => e.id).sort()).toEqual(['i1', 'n1', 'r1', 's1']);
  });

  it('explains files it cannot read', () => {
    const reason = (text) => {
      try {
        decodeBoardFile(text);
      } catch (err) {
        expect(err).toBeInstanceOf(FormatError);
        return err.reason;
      }
      return 'ok';
    };
    expect(reason('not json')).toBe('json');
    expect(reason('{"format":"other"}')).toBe('format');
    expect(reason(JSON.stringify({ format: FILE_FORMAT, version: 9 }))).toBe('version');
    expect(reason(JSON.stringify({ format: FILE_FORMAT, version: 1, board: { id: 'x' } }))).toBe('id');
    expect(reason(JSON.stringify({ format: FILE_FORMAT, version: 1, board: { id: 'board123' }, state: { v: 1 } }))).toBe('state');
  });

  it('drops unknown fields, bad blobs and data URLs that are not images', () => {
    const text = JSON.stringify({
      format: FILE_FORMAT,
      version: 1,
      board: { id: 'board123', name: '  Hi\u0007there  ' },
      state: { v: 1, elements: [['e1', { type: ['rect', 1, 'a'], onload: ['x', 1, 'a'], x: ['nope', 2, 'a'] }]] },
      blobs: { [HASH]: 'data:text/html;base64,PHNjcmlwdD4=', short: PNG },
    });
    const back = decodeBoardFile(text);
    expect(back.board.name).toBe('Hi there');
    expect(back.state.elements).toEqual([['e1', { type: ['rect', 1, 'a'] }]]);
    expect(back.blobs).toEqual({});
  });

  it('makes safe file names and converts data URLs', () => {
    expect(fileName('Plano da Viagem: São Paulo!', '.png')).toBe('plano-da-viagem-sao-paulo.png');
    expect(fileName('', '.svg')).toBe('board.svg');
    expect(cleanName('')).toBe('Untitled board');
    const bytes = Uint8Array.from([1, 2, 3, 250]);
    const url = bytesDataUrl(bytes, 'image/webp');
    expect(dataUrlBytes(url)).toEqual({ type: 'image/webp', bytes });
    expect(() => dataUrlBytes('data:text/plain;base64,AA==')).toThrow(FormatError);
  });
});

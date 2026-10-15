// Exports: a PNG drawn by the same renderer as the screen, an SVG from the shared primitives,
// and the board file with the full CRDT state and its pictures. Importing a board file merges
// it into the board with the same id, or adds it as a new board.

import { unionBounds } from '../core/geometry.js';
import { toSvg } from '../core/svg.js';
import { Board } from '../core/crdt.js';
import { FILE_EXTENSION, dataUrlBytes, decodeBoardFile, encodeBoardFile, fileName } from '../core/format.js';
import { hashBytes } from '../core/blobs.js';
import { THEMES } from '../core/shapes.js';
import { measurer, paint } from './canvas.js';
import * as images from './images.js';
import * as db from './db.js';

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function preload(list) {
  await Promise.all(list.filter((e) => e.type === 'image').map((e) => images.load(e.src)));
}

/** Draws the elements to a canvas: the whole drawing with padding, at scale (capped at 8000 px). */
export async function renderCanvas(list, { theme = 'dark', scale = 2, padding = 32, maxSide = 8000 } = {}) {
  await preload(list);
  await document.fonts?.ready;
  const box = unionBounds(list) || { x: 0, y: 0, w: 320, h: 200 };
  const w = box.w + padding * 2;
  const h = box.h + padding * 2;
  const k = Math.min(scale, maxSide / w, maxSide / h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  paint(ctx, list, { theme: THEMES[theme], cam: { x: box.x - padding, y: box.y - padding, z: 1 }, dpr: k, width: w, height: h, grid: false, measure: measurer(ctx) });
  return canvas;
}

export async function exportPng(session, theme) {
  const canvas = await renderCanvas(session.board.visible(), { theme });
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  download(blob, fileName(session.meta.name, '.png'));
}

export async function exportSvg(session, theme) {
  const list = session.board.visible();
  const pics = {};
  for (const el of list) if (el.type === 'image' && !pics[el.src]) pics[el.src] = await images.dataUrl(el.src);
  const measure = measurer(document.createElement('canvas').getContext('2d'));
  const text = toSvg(list, { theme, images: pics, measure });
  download(new Blob([text], { type: 'image/svg+xml' }), fileName(session.meta.name, '.svg'));
}

export async function exportFile(session) {
  const state = session.board.toState();
  const blobs = {};
  for (const el of session.board.visible()) if (el.type === 'image' && !blobs[el.src]) blobs[el.src] = await images.dataUrl(el.src);
  const text = encodeBoardFile({ board: session.meta, state, blobs });
  download(new Blob([text], { type: 'application/json' }), fileName(session.meta.name, FILE_EXTENSION));
}

/** A small preview of the board for the board list, as a data URL. */
export async function thumbnail(list, theme) {
  if (!list.length) return '';
  const canvas = await renderCanvas(list, { theme, scale: 1, padding: 24, maxSide: 360 });
  const out = document.createElement('canvas');
  out.width = 240;
  out.height = 150;
  const ctx = out.getContext('2d');
  ctx.fillStyle = THEMES[theme].paper;
  ctx.fillRect(0, 0, 240, 150);
  const k = Math.min(240 / canvas.width, 150 / canvas.height);
  ctx.drawImage(canvas, (240 - canvas.width * k) / 2, (150 - canvas.height * k) / 2, canvas.width * k, canvas.height * k);
  return out.toDataURL('image/webp', 0.7);
}

/** Reads a board file and saves it here, merging into a board with the same id. Returns the board id. */
export async function importFile(file) {
  const data = decodeBoardFile(await file.text());
  for (const [hash, url] of Object.entries(data.blobs)) {
    const { type, bytes } = dataUrlBytes(url);
    if ((await hashBytes(bytes)) === hash) await db.putBlob(hash, { mime: type, bytes });
  }
  const have = await db.getBoard(data.board.id);
  const board = new Board('import');
  const saved = have ? await db.getState(data.board.id) : null;
  if (saved) board.mergeState(saved);
  board.mergeState(data.state);
  await db.putState(data.board.id, board.toState());
  await db.putBoard({ ...(have || { id: data.board.id, name: data.board.name, created: data.board.created, thumb: '' }), updated: Date.now() });
  return data.board.id;
}

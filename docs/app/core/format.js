// Copied from src/ by scripts/sync-core.mjs. Edit the file in src/ instead.
// The board file (.doodleduo): one JSON document with the board name and id, the full CRDT
// state and every image the board uses, as data URLs. Opening a file of a board you already
// have merges the two, because the state carries every field's time stamp.
//
// {
//   "format": "doodleduo-board",
//   "version": 1,
//   "board": { "id": "...", "name": "...", "created": 1760000000000 },
//   "state": { "v": 1, "elements": [[id, { field: [value, time, replica] }, [[start, x, y, p, ...]]]] },
//   "blobs": { "<sha-256 hex>": "data:image/webp;base64,..." }
// }

import { Board, STATE_VERSION } from './crdt.js';

export const FILE_FORMAT = 'doodleduo-board';
export const FILE_VERSION = 1;
export const FILE_EXTENSION = '.doodleduo';
export const MAX_FILE_CHARS = 80 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export class FormatError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'FormatError';
    this.reason = reason;
  }
}

export const validBoardId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(id);
export const cleanName = (name, fallback = 'Untitled board') => String(name ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) || fallback;
export const validHash = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+=*)$/;

/** The board file text. blobs maps image hashes to data URLs; unknown or bad ones are left out. */
export function encodeBoardFile({ board, state, blobs = {} }) {
  if (!validBoardId(board?.id)) throw new FormatError('id', 'The board has no valid id');
  const used = new Set(state.elements.map((e) => e[1]?.src?.[0]).filter(Boolean));
  const outBlobs = {};
  for (const h of [...used].sort()) if (validHash(h) && DATA_URL.test(blobs[h] || '')) outBlobs[h] = blobs[h];
  return JSON.stringify({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    board: { id: board.id, name: cleanName(board.name), created: Number.isFinite(board.created) ? board.created : Date.now() },
    state,
    blobs: outBlobs,
  });
}

/**
 * Reads a board file. Returns { board, state, blobs } with everything checked: a state that
 * merges cleanly into an empty board, and blobs that are image data URLs under their hash.
 */
export function decodeBoardFile(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_CHARS) throw new FormatError('size', 'This file is too large to be a board.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FormatError('json', 'This file is not a board file. It could not be read as JSON.');
  }
  if (!data || data.format !== FILE_FORMAT) throw new FormatError('format', 'This file is not a board file.');
  if (!Number.isInteger(data.version) || data.version > FILE_VERSION) throw new FormatError('version', 'This board file comes from a newer version. Update the app and try again.');
  if (!validBoardId(data.board?.id)) throw new FormatError('id', 'The board in this file has no valid id.');
  if (!data.state || data.state.v !== STATE_VERSION || !Array.isArray(data.state.elements)) throw new FormatError('state', 'The drawing in this file is damaged.');
  // Merging into a scratch board validates every field and drops anything unknown.
  const scratch = new Board('file');
  try {
    scratch.mergeState(data.state);
  } catch {
    throw new FormatError('state', 'The drawing in this file is damaged.');
  }
  const blobs = {};
  for (const [h, url] of Object.entries(data.blobs || {})) if (validHash(h) && typeof url === 'string' && DATA_URL.test(url)) blobs[h] = url;
  return {
    board: { id: data.board.id, name: cleanName(data.board.name), created: Number.isFinite(data.board.created) ? data.board.created : Date.now() },
    state: scratch.toState(),
    blobs,
  };
}

/** A safe file name for exports: "Our trip plan" becomes "our-trip-plan". */
export function fileName(name, extension) {
  const base = cleanName(name, 'board')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'board'}${extension}`;
}

/** Splits a data URL into its type and bytes. */
export function dataUrlBytes(url) {
  const m = DATA_URL.exec(url);
  if (!m) throw new FormatError('image', 'Not an image data URL');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1], bytes };
}

/** Bytes and a type to a data URL. */
export function bytesDataUrl(bytes, type) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

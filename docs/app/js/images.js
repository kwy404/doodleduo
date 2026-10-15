// Pictures pasted or dropped on the board: scaled down to at most 1600 pixels on the long side,
// compressed to WebP (or JPEG where WebP encoding is missing), named by the SHA-256 of the
// result and kept in IndexedDB. Peers get the same bytes, checked against that name.

import { hashBytes } from '../core/blobs.js';
import * as db from './db.js';

export const MAX_SIDE = 1600;
const cache = new Map(); // hash -> { img, url } or a pending promise

async function encode(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Compresses an image file. Resolves with { hash, mime, bytes, w, h }. Animated GIFs keep only their first frame. */
export async function compress(file) {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  let blob = await encode(canvas, 'image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', 0.85);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = await hashBytes(bytes);
  return { hash, mime: blob.type, bytes, w, h };
}

/** Stores a picture and returns it decoded for drawing. */
export async function store(hash, mime, bytes) {
  await db.putBlob(hash, { mime, bytes });
  cache.delete(hash);
  return load(hash);
}

/** The decoded picture for a hash, or null when this device does not have it (yet). */
export function load(hash) {
  const have = cache.get(hash);
  if (have) return have instanceof Promise ? have : Promise.resolve(have);
  const p = (async () => {
    const rec = await db.getBlob(hash);
    if (!rec) {
      cache.delete(hash);
      return null;
    }
    const url = URL.createObjectURL(new Blob([rec.bytes], { type: rec.mime }));
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode().catch(() => {});
    const out = { img, url, mime: rec.mime };
    cache.set(hash, out);
    return out;
  })();
  cache.set(hash, p);
  return p;
}

/** The picture if it is decoded already, without waiting. */
export function ready(hash) {
  const have = cache.get(hash);
  return have && !(have instanceof Promise) ? have : null;
}

/** A data URL of a stored picture, for exports. */
export async function dataUrl(hash) {
  const rec = await db.getBlob(hash);
  if (!rec) return null;
  let bin = '';
  for (let i = 0; i < rec.bytes.length; i += 0x8000) bin += String.fromCharCode(...rec.bytes.subarray(i, i + 0x8000));
  return `data:${rec.mime};base64,${btoa(bin)}`;
}

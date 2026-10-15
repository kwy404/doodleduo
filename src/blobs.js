// Images travel next to the board, not inside it: an image element only names its picture by
// the SHA-256 of the compressed bytes. Pictures go over the connection in small base64 chunks
// and are checked against that hash on arrival, so a peer can only ever deliver the picture the
// element asked for.

import { toHex } from './bytes.js';

export const CHUNK_CHARS = 48000;
export const MAX_BLOB_BYTES = 12 * 1024 * 1024;

/** SHA-256 of bytes as lower case hex. */
export async function hashBytes(bytes) {
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}

const b64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Messages for one picture: { type: 'blob', h, mime, i, n, d }. */
export function blobMessages(hash, mime, bytes, chunkChars = CHUNK_CHARS) {
  const text = b64(bytes);
  const n = Math.max(1, Math.ceil(text.length / chunkChars));
  const out = [];
  for (let i = 0; i < n; i++) out.push({ type: 'blob', h: hash, mime, i, n, d: text.slice(i * chunkChars, (i + 1) * chunkChars) });
  return out;
}

/** Collects chunks per hash. push() resolves with { hash, mime, bytes } once a picture is whole and verified. */
export class BlobAssembler {
  constructor({ maxBytes = MAX_BLOB_BYTES, maxPending = 32 } = {}) {
    this.maxBytes = maxBytes;
    this.maxPending = maxPending;
    this.pending = new Map();
  }

  async push(msg) {
    if (!msg || !/^[0-9a-f]{64}$/.test(msg.h) || !/^image\/(png|jpeg|webp|gif)$/.test(msg.mime)) return null;
    if (!Number.isInteger(msg.n) || msg.n < 1 || msg.n > Math.ceil((this.maxBytes * 4) / 3 / 1000) || !Number.isInteger(msg.i) || msg.i < 0 || msg.i >= msg.n) return null;
    if (typeof msg.d !== 'string' || !/^[A-Za-z0-9+/]*=*$/.test(msg.d)) return null;
    let p = this.pending.get(msg.h);
    if (!p) {
      if (this.pending.size >= this.maxPending) this.pending.delete(this.pending.keys().next().value);
      p = { n: msg.n, mime: msg.mime, parts: new Array(msg.n), got: 0 };
      this.pending.set(msg.h, p);
    }
    if (p.n !== msg.n || p.parts[msg.i] !== undefined) return null;
    p.parts[msg.i] = msg.d;
    p.got++;
    if (p.got < p.n) return null;
    this.pending.delete(msg.h);
    let bytes;
    try {
      const bin = atob(p.parts.join(''));
      if (bin.length > this.maxBytes) return null;
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return null;
    }
    if ((await hashBytes(bytes)) !== msg.h) return null;
    return { hash: msg.h, mime: p.mime, bytes };
  }
}

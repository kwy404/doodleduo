import { describe, expect, it } from 'vitest';
import { BlobAssembler, blobMessages, hashBytes } from '../src/blobs.js';

describe('pictures over the connection', () => {
  it('splits, reorders and rebuilds a picture checked by its hash', async () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 7) % 256);
    const hash = await hashBytes(bytes);
    const msgs = blobMessages(hash, 'image/webp', bytes, 10000);
    expect(msgs.length).toBeGreaterThan(5);
    const asm = new BlobAssembler();
    let done = null;
    for (const m of msgs.reverse()) done = (await asm.push(m)) || done;
    expect(done.hash).toBe(hash);
    expect(done.bytes).toEqual(bytes);
  });

  it('refuses a picture that does not match its hash, and odd messages', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const msgs = blobMessages('e'.repeat(64), 'image/png', bytes);
    expect(await new BlobAssembler().push(msgs[0])).toBeNull();
    const asm = new BlobAssembler();
    expect(await asm.push({ ...msgs[0], mime: 'text/html' })).toBeNull();
    expect(await asm.push({ ...msgs[0], d: '<script>' })).toBeNull();
    expect(await asm.push({ ...msgs[0], i: 5 })).toBeNull();
  });
});

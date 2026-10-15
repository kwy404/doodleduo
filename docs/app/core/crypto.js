// Copied from src/ by scripts/sync-core.mjs. Edit the file in src/ instead.
// Random ids and the DTLS fingerprints of a connection.

/** Random id as lowercase hex, 2 characters per byte. */
export function randomId(bytes = 8) {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The DTLS certificate fingerprints announced in an SDP, normalized and without duplicates. */
export function sdpFingerprints(sdp) {
  const out = [];
  for (const line of String(sdp || '').split(/\r?\n/)) {
    const m = /^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)/.exec(line.trim());
    if (m) out.push(`${m[1].toLowerCase()} ${m[2].toUpperCase()}`);
  }
  return [...new Set(out)];
}

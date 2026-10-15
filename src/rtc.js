// WebRTC links for the mesh: one RTCPeerConnection per pair of people with one ordered,
// reliable data channel. The offer and the answer wait for ICE gathering to finish (no
// trickle), so each fits in a single message through the pairing relays or the mesh.

export const STUN_SERVERS = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

const turnError = (reason, message) => Object.assign(new TypeError(message), { reason });

/** Checks a TURN server typed in settings. Returns { urls, username, credential } or throws with a reason. */
export function parseTurn({ urls, username = '', credential = '' }) {
  const list = (Array.isArray(urls) ? urls : String(urls || '').split(/[\s,]+/)).map((u) => u.trim()).filter(Boolean);
  if (!list.length) throw turnError('empty', 'Add a TURN address, like turn:turn.example.com:3478');
  for (const u of list) {
    if (!/^(turns?|stun):[^\s/?#]+(:\d{1,5})?(\?transport=(udp|tcp))?$/i.test(u)) throw turnError('format', `"${u}" is not a TURN address. It looks like turn:host:3478`);
  }
  if (list.some((u) => /^turns?:/i.test(u)) && (!username || !credential)) throw turnError('auth', 'A TURN server needs a user name and a password.');
  return { urls: list, username: String(username), credential: String(credential) };
}

/** ICE servers: the public STUN servers in order, then the TURN server from settings, if any. */
export function buildIceServers(turn = null) {
  const out = STUN_SERVERS.map((urls) => ({ urls }));
  if (turn?.urls?.length) out.push({ urls: turn.urls, username: turn.username, credential: turn.credential });
  return out;
}

/** Counts candidate types in an SDP. */
export function candidateTypes(sdp) {
  const out = { host: 0, srflx: 0, relay: 0, prflx: 0 };
  for (const m of String(sdp || '').matchAll(/^a=candidate:.* typ (host|srflx|relay|prflx)/gm)) out[m[1]]++;
  return out;
}

/**
 * Why a link did not open, as a key the app translates: 'offline', 'blocked' (no candidates
 * at all), 'no-stun' (no public address: STUN did not answer), 'strict-nat' (both sides have
 * addresses but no path worked) or 'timeout'.
 */
export function diagnose({ localSdp, remoteSdp, online = true }) {
  if (!online) return 'offline';
  const local = candidateTypes(localSdp);
  const remote = candidateTypes(remoteSdp);
  if (!local.srflx && !local.relay) return local.host ? 'no-stun' : 'blocked';
  if (local.relay && remote.relay) return 'timeout';
  return 'strict-nat';
}

/**
 * Asks one STUN server for this device's public address. Resolves with { url, ok, ms }.
 * A server answered when a server reflexive (srflx) candidate shows up.
 */
export function probeStun(url, { timeout = 5000, RTCPeerConnection: PC = globalThis.RTCPeerConnection } = {}) {
  return new Promise((resolve) => {
    if (!PC) return resolve({ url, ok: false, ms: 0 });
    const started = Date.now();
    let pc;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        // already closed
      }
      resolve({ url, ok, ms: Date.now() - started });
    };
    const timer = setTimeout(() => finish(false), timeout);
    try {
      pc = new PC({ iceServers: [{ urls: url }] });
      pc.createDataChannel('probe');
      pc.onicecandidate = (e) => {
        if (e.candidate && / typ srflx/.test(e.candidate.candidate)) finish(true);
        else if (!e.candidate) finish(false);
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}

/** Probes every STUN server at once. Resolves with the results in list order. */
export function probeAllStun(urls = STUN_SERVERS, options) {
  return Promise.all(urls.map((u) => probeStun(u, options)));
}

export class RtcLink {
  constructor({ iceServers = buildIceServers(), gatherTimeout = 6000, RTCPeerConnection: PC = globalThis.RTCPeerConnection } = {}) {
    this.pc = new PC({ iceServers, bundlePolicy: 'max-bundle' });
    this.gatherTimeout = gatherTimeout;
    this.open = false;
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onfail = null;
    this.onstate = null;
    this.dc = this.pc.createDataChannel('board', { negotiated: true, id: 0 });
    this.dc.onopen = () => {
      if (this.open || this.closed) return;
      this.open = true;
      clearTimeout(this.openTimer);
      this.onopen?.();
    };
    this.dc.onmessage = (e) => this.onmessage?.(e.data);
    this.dc.onclose = () => this._end('closed');
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.onstate?.(s);
      if (s === 'failed') this._end('failed');
      else if (s === 'disconnected') {
        clearTimeout(this.lostTimer);
        this.lostTimer = setTimeout(() => {
          if (this.pc.connectionState !== 'connected') this._end('failed');
        }, 12000);
      } else if (s === 'connected') clearTimeout(this.lostTimer);
    };
  }

  async _gather() {
    const pc = this.pc;
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => pc.iceGatheringState === 'complete' && done();
      const timer = setTimeout(done, this.gatherTimeout);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  /** Creates the offer and waits for every ICE candidate. Calling it twice gives the same offer. */
  offer() {
    this._offering ??= (async () => {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this._gather();
      return this.pc.localDescription.sdp;
    })();
    return this._offering;
  }

  /** Answers an offer. Idempotent: a repeated offer (a relay that delivers twice) gets the same answer. */
  answer(sdp) {
    this._answering ??= (async () => {
      await this.pc.setRemoteDescription({ type: 'offer', sdp });
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await this._gather();
      this._watchOpen();
      return this.pc.localDescription.sdp;
    })();
    return this._answering;
  }

  /** Applies the answer. Idempotent: a second answer is ignored and resolves false. */
  async complete(sdp) {
    if (this.answered || this.closed || this.pc.signalingState !== 'have-local-offer') return false;
    this.answered = true;
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (err) {
      this.answered = false;
      throw err;
    }
    this._watchOpen();
    return true;
  }

  _watchOpen(ms = 25000) {
    clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => {
      if (!this.open && !this.closed) this.onfail?.('timeout');
    }, ms);
  }

  send(text) {
    if (this.dc.readyState !== 'open') throw new Error('link is not open');
    this.dc.send(text);
  }

  /** Bytes waiting in the channel buffer, to slow down big transfers. */
  get buffered() {
    return this.dc.bufferedAmount;
  }

  diagnose(online) {
    return diagnose({ localSdp: this.pc.localDescription?.sdp, remoteSdp: this.pc.remoteDescription?.sdp, online });
  }

  _end(reason) {
    if (this.closed) return;
    const wasOpen = this.open;
    this.closed = true;
    this.open = false;
    clearTimeout(this.openTimer);
    clearTimeout(this.lostTimer);
    try {
      this.pc.close();
    } catch {
      // already closed
    }
    if (wasOpen) this.onclose?.(reason);
    else this.onfail?.(reason);
  }

  close() {
    this._end('closed');
  }
}

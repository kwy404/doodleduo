import { describe, expect, it } from 'vitest';
import { STUN_SERVERS, buildIceServers, candidateTypes, diagnose, parseTurn, probeStun } from '../src/rtc.js';

class FakePC {
  constructor(config) {
    this.config = config;
    FakePC.last = this;
  }
  createDataChannel() {}
  async createOffer() {
    return { type: 'offer', sdp: '' };
  }
  async setLocalDescription() {
    const url = this.config.iceServers[0].urls;
    setTimeout(() => {
      if (url.includes('good')) this.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 1 203.0.113.5 5000 typ srflx raddr 0.0.0.0 rport 0' } });
      else if (!url.includes('silent')) this.onicecandidate?.({ candidate: null });
    }, 5);
  }
  close() {
    this.closed = true;
  }
}

describe('ICE servers', () => {
  it('lists the public STUN servers in order, then a TURN server from settings', () => {
    expect(STUN_SERVERS[0]).toBe('stun:stun.cloudflare.com:3478');
    expect(buildIceServers().map((s) => s.urls)).toEqual(STUN_SERVERS);
    const turn = parseTurn({ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' });
    expect(buildIceServers(turn).at(-1)).toEqual({ urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'p' });
  });

  it('checks TURN settings', () => {
    expect(() => parseTurn({ urls: '' })).toThrow(/TURN address/);
    expect(() => parseTurn({ urls: 'http://x' })).toThrow(/not a TURN address/);
    expect(() => parseTurn({ urls: 'turn:x:3478' })).toThrow(/user name/);
  });

  it('asks a STUN server for a public address and gives up after a timeout', async () => {
    expect(await probeStun('stun:good', { RTCPeerConnection: FakePC })).toMatchObject({ ok: true });
    expect(FakePC.last.closed).toBe(true);
    expect(await probeStun('stun:bad', { RTCPeerConnection: FakePC })).toMatchObject({ ok: false });
    expect(await probeStun('stun:silent', { RTCPeerConnection: FakePC, timeout: 30 })).toMatchObject({ ok: false });
    expect(await probeStun('stun:x', { RTCPeerConnection: null })).toMatchObject({ ok: false });
  });

  it('explains failed links from the gathered candidates', () => {
    const host = 'a=candidate:1 1 udp 1 192.168.0.2 5000 typ host\r\n';
    const srflx = 'a=candidate:2 1 udp 1 203.0.113.5 5000 typ srflx raddr 0.0.0.0 rport 0\r\n';
    expect(candidateTypes(host + srflx)).toEqual({ host: 1, srflx: 1, relay: 0, prflx: 0 });
    expect(diagnose({ localSdp: host, remoteSdp: host })).toBe('no-stun');
    expect(diagnose({ localSdp: '', remoteSdp: '' })).toBe('blocked');
    expect(diagnose({ localSdp: srflx, remoteSdp: srflx })).toBe('strict-nat');
    expect(diagnose({ online: false })).toBe('offline');
  });
});

// Voice, camera and screen for the people on a board, adapted from howlden. The call is
// board wide: everyone who joined it sends their microphone to everyone else in it, and the
// camera and the screen ride along. The microphone goes through the browser's own filters and,
// in Strong mode (the default), through our noise suppression AudioWorklet (core/dsp.js).

import { Emitter } from '../core/mesh.js';
import { micConstraints, usesDenoise } from '../core/call.js';

const SLOTS = ['mic', 'camera', 'screen'];
const SPEAK_LEVEL = 0.018;
const SPEAK_HOLD = 280;

export class MediaManager extends Emitter {
  /** settings: { noiseMode, sensitivity (0 to 100), save() } */
  constructor(settings) {
    super();
    this.settings = settings;
    this.session = null;
    this.inCall = false;
    this.pipe = null;
    this.mic = null;
    this.camera = null;
    this.screen = null;
    this.muted = false;
    this.peers = new Map(); // peerId -> { call, muted, camera, screen }
    this.remote = new Map(); // peerId -> { streams: Map, audio: Map }
    this.ctx = null;
    this.meters = new Map();
    this.speaking = new Set();
    this.lastLoud = new Map();
    this.sink = document.createElement('div');
    this.sink.hidden = true;
    document.body.append(this.sink);
    setInterval(() => this._measure(), 90);
  }

  /** The session whose mesh carries the media. */
  use(session) {
    this.session = session;
  }

  get noiseMode() {
    return this.settings.noiseMode || 'strong';
  }

  get sensitivity() {
    return (this.settings.sensitivity ?? 50) / 100;
  }

  /** 'strong' when our worklet runs on the microphone, else the browser mode, or null. */
  get processing() {
    const pipe = this.pipe || this.testPipe;
    if (!pipe) return null;
    return pipe.chain ? 'strong' : this.noiseMode === 'off' ? 'off' : 'standard';
  }

  get micLevel() {
    return this.testPipe?.level || this.pipe?.level || null;
  }

  _ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _constraints() {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    return micConstraints({ noiseMode: this.noiseMode, supported });
  }

  /** Opens the microphone, through the worklet in Strong mode. Returns { raw, out, chain }. */
  async _openPipe() {
    const raw = await navigator.mediaDevices.getUserMedia({ audio: this._constraints() });
    for (const track of raw.getAudioTracks()) if ('contentHint' in track) track.contentHint = 'speech';
    if (!usesDenoise({ noiseMode: this.noiseMode }) || !this.ctx?.audioWorklet || typeof AudioWorkletNode === 'undefined') return { raw, out: raw, chain: null };
    try {
      this.workletReady ??= this.ctx.audioWorklet.addModule(new URL('./denoise-worklet.js', import.meta.url));
      await this.workletReady;
      const src = this.ctx.createMediaStreamSource(raw);
      const node = new AudioWorkletNode(this.ctx, 'doodleduo-denoise', { processorOptions: { sensitivity: this.sensitivity } });
      const dest = this.ctx.createMediaStreamDestination();
      src.connect(node);
      node.connect(dest);
      const pipe = { raw, out: dest.stream, chain: { src, node, dest }, level: null };
      node.port.onmessage = (e) => {
        pipe.level = e.data;
        this.emit('mic-level', e.data);
      };
      return pipe;
    } catch (err) {
      console.warn('doodleduo: noise suppression is not available here', err);
      this.workletReady = null;
      return { raw, out: raw, chain: null };
    }
  }

  _closePipe(pipe) {
    if (!pipe) return;
    try {
      pipe.chain?.src.disconnect();
      pipe.chain?.node.disconnect();
    } catch {
      // already disconnected
    }
    this._stop(pipe.raw);
    if (pipe.out !== pipe.raw) this._stop(pipe.out);
  }

  _stop(stream) {
    for (const t of stream?.getTracks() || []) t.stop();
  }

  setSensitivity(value) {
    this.settings.sensitivity = value;
    this.settings.save();
    for (const pipe of [this.pipe, this.testPipe]) pipe?.chain?.node.port.postMessage({ sensitivity: this.sensitivity });
  }

  async setNoiseMode(mode) {
    this.settings.noiseMode = mode;
    this.settings.save();
    await this.restartMic();
  }

  // ---------- Mic test ----------

  /** Hear yourself the way others hear you, after noise suppression. */
  async startMicTest() {
    this._ensureContext();
    this.stopMicTest();
    const pipe = await this._openPipe();
    this.testPipe = pipe;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.srcObject = pipe.out;
    this.sink.append(el);
    el.play().catch(() => {});
    pipe.el = el;
    // The bar shows what the microphone picks up; the gate label shows what the suppressor lets through.
    this._meter('test', pipe.raw);
    this.emit('change');
  }

  stopMicTest() {
    const pipe = this.testPipe;
    if (!pipe) return;
    this.testPipe = null;
    pipe.el?.remove();
    this._unmeter('test');
    this._closePipe(pipe);
    this.emit('change');
  }

  get testing() {
    return !!this.testPipe;
  }

  // ---------- The call ----------

  async join() {
    if (this.inCall || !this.session) return;
    this._ensureContext();
    this.inCall = true;
    try {
      this.pipe = await this._openPipe();
      this.mic = this.pipe.out;
      this._meter('self', this.mic);
    } catch (err) {
      this.pipe = null;
      this.mic = null;
      this.emit('error', err.name === 'NotAllowedError' ? 'mic-denied' : err.name === 'NotFoundError' ? 'mic-missing' : 'mic-failed');
    }
    this._gate();
    this._refresh();
  }

  leave() {
    if (!this.inCall) return;
    this.inCall = false;
    this._closePipe(this.pipe);
    for (const s of [this.camera, this.screen]) this._stop(s);
    this.pipe = this.mic = this.camera = this.screen = null;
    this._unmeter('self');
    for (const peerId of this.remote.keys()) this._dropAudio(peerId);
    this._refresh();
  }

  async restartMic() {
    if (this.testPipe) await this.startMicTest();
    if (!this.inCall) return;
    const old = this.pipe;
    try {
      this.pipe = await this._openPipe();
      this.mic = this.pipe.out;
    } catch {
      this.emit('error', 'mic-failed');
      return;
    }
    this._unmeter('self');
    this._meter('self', this.mic);
    this._closePipe(old);
    this._gate();
    this._refresh();
  }

  toggleMute() {
    this.muted = !this.muted;
    this._gate();
    this._announce();
    this.emit('change');
  }

  _gate() {
    for (const t of [...(this.mic?.getAudioTracks() || []), ...(this.pipe?.raw.getAudioTracks() || [])]) t.enabled = !this.muted;
  }

  async toggleCamera() {
    if (!this.inCall) await this.join();
    if (this.camera) {
      this._stop(this.camera);
      this.camera = null;
    } else {
      try {
        this.camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 320 }, frameRate: { ideal: 24 } } });
      } catch (err) {
        this.emit('error', err.name === 'NotAllowedError' ? 'camera-denied' : 'camera-failed');
        return;
      }
    }
    this._refresh();
  }

  async toggleScreen() {
    if (!this.inCall) await this.join();
    if (this.screen) {
      this._stop(this.screen);
      this.screen = null;
    } else {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        this.emit('error', 'screen-unsupported');
        return;
      }
      try {
        this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
        this.screen.getVideoTracks()[0].addEventListener('ended', () => {
          if (this.screen) this.toggleScreen();
        });
      } catch (err) {
        if (err.name !== 'NotAllowedError') this.emit('error', 'screen-failed');
        return;
      }
    }
    this._refresh();
  }

  /** My call state, as everyone else sees it. */
  get state() {
    return { call: this.inCall, muted: this.muted || !this.mic, camera: !!this.camera, screen: !!this.screen };
  }

  _announce() {
    this.session?.broadcast({ type: 'voice', ...this.state });
  }

  _refresh() {
    for (const peerId of this.session?.mesh?.links.keys() || []) this.sync(peerId);
    this._announce();
    this.emit('change');
    this.emit('video');
  }

  /** A peer told us their call state. */
  peerState(peerId, s) {
    this.peers.set(peerId, { call: !!s.call, muted: !!s.muted, camera: !!s.camera, screen: !!s.screen });
    this.sync(peerId);
    if (!s.call) this._dropAudio(peerId);
    this.emit('change');
    this.emit('video');
  }

  /** Makes the tracks I send to one peer match whether we are both in the call. */
  sync(peerId) {
    const link = this.session?.mesh?.links.get(peerId);
    if (!link?.setTrack) return;
    const together = this.inCall && this.peers.get(peerId)?.call;
    const streams = { mic: this.mic, camera: this.camera, screen: this.screen };
    for (const slot of SLOTS) {
      const stream = together ? streams[slot] : null;
      const track = stream && (slot === 'mic' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0]);
      const sender = link.senders[slot];
      if (track && sender?.track === track) continue;
      if (track || sender) link.setTrack(slot, track || null, stream);
    }
  }

  /** A link opened: listen for its tracks and tell the peer where I am. */
  attach(peerId, link) {
    link.ontrack = ({ track, stream }) => {
      const entry = this.remote.get(peerId) || { streams: new Map(), audio: new Map() };
      this.remote.set(peerId, entry);
      entry.streams.set(stream.id, stream);
      const refresh = () => this.emit('video');
      track.addEventListener('ended', refresh);
      track.addEventListener('mute', refresh);
      track.addEventListener('unmute', refresh);
      stream.addEventListener('removetrack', refresh);
      if (track.kind === 'audio' && this.inCall) this._playAudio(peerId, entry, stream);
      refresh();
    };
    link.onmedia = () => this.emit('video');
    this.session?.mesh?.sendTo(peerId, { type: 'voice', ...this.state });
  }

  detach(peerId) {
    this._dropAudio(peerId);
    this.remote.delete(peerId);
    this.peers.delete(peerId);
    this.emit('video');
    this.emit('change');
  }

  _playAudio(peerId, entry, stream) {
    if (entry.audio.has(stream.id)) return;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.srcObject = stream;
    this.sink.append(el);
    el.play().catch(() => this.emit('error', 'autoplay'));
    entry.audio.set(stream.id, el);
    this._meter(peerId, stream);
  }

  _dropAudio(peerId) {
    const entry = this.remote.get(peerId);
    if (!entry) return;
    for (const el of entry.audio.values()) {
      el.srcObject = null;
      el.remove();
    }
    entry.audio.clear();
    this._unmeter(peerId);
  }

  /** The remote stream of one person in a slot, if it carries a live video track. */
  remoteVideo(peerId, slot) {
    const link = this.session?.mesh?.links.get(peerId);
    const entry = this.remote.get(peerId);
    const id = link?.remoteMedia?.[slot];
    const stream = id && entry?.streams.get(id);
    const track = stream?.getVideoTracks()[0];
    return track && track.readyState === 'live' ? stream : null;
  }

  // ---------- Levels and speaking ----------

  _meter(key, stream) {
    if (!this.ctx || !stream.getAudioTracks().length) return;
    this._unmeter(key);
    try {
      const source = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.meters.set(key, { source, analyser, buf: new Uint8Array(analyser.fftSize), level: 0 });
    } catch {
      // some browsers cannot analyse remote streams; the speaking ring just stays off
    }
  }

  _unmeter(key) {
    const m = this.meters.get(key);
    if (!m) return;
    m.source.disconnect();
    this.meters.delete(key);
    this.lastLoud.delete(key);
  }

  level(key) {
    return this.meters.get(key)?.level || 0;
  }

  _measure() {
    if (!this.meters.size && !this.speaking.size) return;
    const now = performance.now();
    const next = new Set();
    for (const [key, m] of this.meters) {
      m.analyser.getByteTimeDomainData(m.buf);
      let sum = 0;
      for (const v of m.buf) sum += ((v - 128) / 128) ** 2;
      m.level = Math.sqrt(sum / m.buf.length);
      const loud = key === 'self' ? !this.muted && m.level > SPEAK_LEVEL : m.level > SPEAK_LEVEL;
      if (loud) this.lastLoud.set(key, now);
      if (key !== 'test' && now - (this.lastLoud.get(key) || -1e9) < SPEAK_HOLD) next.add(key);
    }
    const changed = next.size !== this.speaking.size || [...next].some((k) => !this.speaking.has(k));
    this.speaking = next;
    if (changed) this.emit('speaking', next);
    this.emit('levels');
  }
}

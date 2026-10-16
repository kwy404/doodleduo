// Call helpers with no browser state: microphone constraints, whether our own noise
// suppression runs, and a small rate limit for chat reactions. Adapted from howlden.

/**
 * getUserMedia audio constraints. Echo cancellation and automatic gain are always on; the
 * browser's own noise suppression (and voice isolation where supported) follow the mode:
 * 'strong' (browser plus our DSP worklet), 'standard' (browser only) or 'off'.
 */
export function micConstraints({ noiseMode = 'strong', supported = {}, inputId = '' } = {}) {
  const clean = noiseMode !== 'off';
  const audio = { echoCancellation: true, autoGainControl: true, noiseSuppression: clean };
  if (supported.voiceIsolation) audio.voiceIsolation = clean;
  if (inputId) audio.deviceId = { exact: inputId };
  return audio;
}

/** Whether our own noise suppression worklet should run. */
export function usesDenoise({ noiseMode = 'strong' } = {}) {
  return noiseMode === 'strong';
}

/** At most `max` events per key in any `windowMs`. */
export class RateLimit {
  constructor({ max = 6, windowMs = 2000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  allow(key, now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    const ok = recent.length < this.max;
    if (ok) recent.push(now);
    this.hits.set(key, recent);
    return ok;
  }
}

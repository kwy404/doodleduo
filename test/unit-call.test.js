import { describe, expect, it } from 'vitest';
import { RateLimit, micConstraints, usesDenoise } from '../src/call.js';

describe('microphone constraints', () => {
  it('keeps echo cancellation and gain on, and noise suppression by mode', () => {
    expect(micConstraints({ noiseMode: 'strong' })).toEqual({ echoCancellation: true, autoGainControl: true, noiseSuppression: true });
    expect(micConstraints({ noiseMode: 'off' })).toEqual({ echoCancellation: true, autoGainControl: true, noiseSuppression: false });
    expect(micConstraints({ noiseMode: 'standard', supported: { voiceIsolation: true }, inputId: 'mic2' })).toEqual({ echoCancellation: true, autoGainControl: true, noiseSuppression: true, voiceIsolation: true, deviceId: { exact: 'mic2' } });
    expect('voiceIsolation' in micConstraints({ noiseMode: 'standard' })).toBe(false);
  });

  it('runs our own noise suppression only in Strong mode, the default', () => {
    expect(usesDenoise()).toBe(true);
    expect(usesDenoise({ noiseMode: 'standard' })).toBe(false);
    expect(usesDenoise({ noiseMode: 'off' })).toBe(false);
  });
});

describe('rate limit', () => {
  it('allows a burst, then waits for the window to pass', () => {
    const rl = new RateLimit({ max: 3, windowMs: 1000 });
    expect([1, 2, 3, 4].map(() => rl.allow('a', 100))).toEqual([true, true, true, false]);
    expect(rl.allow('b', 100)).toBe(true);
    expect(rl.allow('a', 1200)).toBe(true);
  });
});

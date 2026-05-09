import { describe, it, expect } from 'vitest';
import { expSmooth, normalise, logBinAverage, NOTE_MAP } from './fft-audio';

// ── Pure math helpers ────────────────────────────────────────────────────────

describe('expSmooth', () => {
  it('returns raw value when smooth=0', () => {
    expect(expSmooth(0.8, 0.2, 0)).toBeCloseTo(0.8);
  });

  it('returns prev value when smooth=1', () => {
    expect(expSmooth(0.8, 0.2, 1)).toBeCloseTo(0.2);
  });

  it('blends with smooth=0.5', () => {
    expect(expSmooth(1, 0, 0.5)).toBeCloseTo(0.5);
  });

  it('converges toward raw value over iterations', () => {
    let v = 0;
    for (let i = 0; i < 20; i++) v = expSmooth(1, v, 0.8);
    expect(v).toBeGreaterThan(0.9);
  });
});

describe('normalise', () => {
  it('clamps to 0 below cutoff', () => {
    expect(normalise(0.04, 0.05, 2)).toBe(0);
  });

  it('maps full range with scale=1 and cutoff=0', () => {
    expect(normalise(0.5, 0, 1)).toBeCloseTo(0.5);
    expect(normalise(1,   0, 1)).toBeCloseTo(1);
  });

  it('allows values above 1 when scale pushes past 1', () => {
    expect(normalise(1, 0, 10)).toBeCloseTo(10);
  });

  it('applies scale above cutoff', () => {
    // raw=0.1, cutoff=0, scale=2 → 0.2
    expect(normalise(0.1, 0, 2)).toBeCloseTo(0.2);
  });
});

describe('logBinAverage', () => {
  it('returns 0 for empty range', () => {
    const spectrum = new Float32Array(256).fill(128);
    // freqLow >= freqHigh would give zero count
    expect(logBinAverage(spectrum, 44100, 22050, 22050)).toBe(0);
  });

  it('returns raw float average of spectrum values in range', () => {
    const spectrum = new Float32Array(256).fill(255);
    const result = logBinAverage(spectrum, 44100, 20, 22000);
    expect(result).toBeCloseTo(255, 0);
  });

  it('returns proportional value for partial spectrum fill', () => {
    const spectrum = new Float32Array(256).fill(0);
    // Fill only low bins
    for (let i = 0; i < 10; i++) spectrum[i] = 128;
    const low  = logBinAverage(spectrum, 44100, 20, 200);
    const high = logBinAverage(spectrum, 44100, 10000, 20000);
    expect(low).toBeGreaterThan(high);
  });
});

// ── NOTE_MAP ─────────────────────────────────────────────────────────────────

describe('NOTE_MAP', () => {
  it('maps C to 0', () => expect(NOTE_MAP['C']).toBe(0));
  it('maps B to 11', () => expect(NOTE_MAP['B']).toBe(11));
  it('maps sharps and flats to same index', () => {
    expect(NOTE_MAP['C#']).toBe(NOTE_MAP['Db']);
    expect(NOTE_MAP['F#']).toBe(NOTE_MAP['Gb']);
    expect(NOTE_MAP['A#']).toBe(NOTE_MAP['Bb']);
  });
  it('covers all 12 chromatic pitch classes', () => {
    const indices = new Set(Object.values(NOTE_MAP));
    expect(indices.size).toBe(12);
  });
});

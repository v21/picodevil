/**
 * Audio-reactive FFT signal source.
 *
 * `fft` is the main export — a Proxy that exposes:
 * - `fft[n]` / `fft.bin(n)` — signal for frequency bin n (0-1)
 * - `fft.bass` / `fft.mid` / `fft.treble` — named bin signals
 * - `fft.bin("bass treble")` — mini-notation pattern alternating between named bins (live values)
 * - `fft.vol` — overall RMS volume (0-1)
 * - `fft.centroid` — spectral brightness (0=bass-heavy, 1=treble-heavy)
 * - `fft.flatness` — tonal vs noise (0=tonal, 1=white noise)
 * - `fft.chroma[n]` / `fft.chroma['C']` — signal for chroma pitch class
 * - `fft.chroma("C A")` — mini-notation pattern alternating between chroma values (live)
 *
 * Auto-starts on first access (browser mic permission prompt).
 * Call `fft.setSource('system')` for system audio, `fft.setSource('screen:name')` to
 * tap audio from an existing loadScreen() stream.
 *
 * @example
 * $: s("clip").alpha(fft[0])
 * @example
 * $: s("clip").x(fft.bass.range(-0.5, 0.5))
 * @example
 * $: s("clip").huerot(fft.centroid)
 * @example
 * fft.setSource('system'); $: s("clip").alpha(fft.vol)
 */

import Meyda from 'meyda';
import type { MeydaFeaturesObject, MeydaAudioFeature } from 'meyda';
import { signal } from '@strudel/core';
import { mini } from '@strudel/mini';
import { getAllStreamStates } from './stream-manager';

// ── Constants ────────────────────────────────────────────────────────────────

const FFT_BUFFER_SIZE = 512;
const LOG_FREQ_MIN = 20;    // Hz
const LOG_FREQ_MAX = 20000; // Hz

/**
 * Chroma pitch class name → index (0=C, 11=B).
 * @internal
 */
export const NOTE_MAP: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

// ── Singleton state ──────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let meydaAnalyzer: InstanceType<typeof Meyda.constructor> | null = null;
let currentStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let streamIsBorrowed = false; // true when stream's tracks belong to a screen capture
let initStarted = false;
// macOS Core Audio powers down the mic when idle; first onaudioprocess buffer contains
// a hardware startup transient (step-function discontinuity) that looks like broadband
// FFT energy. Skip updateFrame processing for 300ms after Meyda starts to clear it.
let meydaReadyAt = 0; // performance.now() timestamp after which updateFrame is live

// Meyda amplitudeSpectrum magnitudes peak at ~1–5 for loud music at normal volume.
// scale=0.5 maps a bin0raw of ~2 to 1.0; cutoff=0.001 gates background noise.
const config = { bins: 4, smooth: 0.5, cutoff: 0.001, scale: 0.5 };

/** Features to pull each frame — grows lazily as signals are first accessed. */
const activeFeatures = new Set<MeydaAudioFeature>(['amplitudeSpectrum']);

// ── Per-frame audio data ─────────────────────────────────────────────────────

let binValues = new Float32Array(config.bins);
let prevBinValues = new Float32Array(config.bins);
let volValue = 0;
let prevVol = 0;
let centroidValue = 0;
let prevCentroid = 0;
let flatnessValue = 0;
let prevFlatness = 0;
const chromaValues = new Float32Array(12);
const prevChromaValues = new Float32Array(12);

// ── Signal caches ────────────────────────────────────────────────────────────

const binSignalCache = new Map<number, ReturnType<typeof signal>>();
const chromaSignalCache = new Map<number, ReturnType<typeof signal>>();
let _volSignal: ReturnType<typeof signal> | null = null;
let _centroidSignal: ReturnType<typeof signal> | null = null;
let _flatnessSignal: ReturnType<typeof signal> | null = null;

// ── Math helpers ─────────────────────────────────────────────────────────────

/** @internal */
export function expSmooth(raw: number, prev: number, smooth: number): number {
  return smooth * prev + (1 - smooth) * raw;
}

/** @internal */
export function normalise(raw: number, cutoff: number, scale: number): number {
  return Math.max(0, (raw - cutoff) / Math.max(1e-6, 1 - cutoff)) * scale;
}

/** @internal */
export function logBinAverage(
  spectrum: Float32Array,
  sampleRate: number,
  freqLow: number,
  freqHigh: number,
): number {
  const nyquist = sampleRate / 2;
  const idxLow  = Math.floor(freqLow  / nyquist * spectrum.length);
  const idxHigh = Math.ceil (freqHigh / nyquist * spectrum.length);
  let sum = 0, count = 0;
  for (let i = Math.max(0, idxLow); i < Math.min(idxHigh, spectrum.length); i++) {
    sum += spectrum[i];
    count++;
  }
  return count > 0 ? sum / count : 0;  // raw Meyda float magnitude (not byte data)
}

// ── Audio init ───────────────────────────────────────────────────────────────

async function lazyInit(): Promise<void> {
  if (initStarted) return;
  initStarted = true;
  // Create AudioContext synchronously — if we're called during a user gesture
  // (Ctrl+Enter eval), the context starts in "running" state. If called from rAF
  // (render loop), it may start "suspended"; the resume() below handles that.
  audioCtx ??= new AudioContext();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // The permission grant is a user activation — resume() here is reliable.
    await audioCtx.resume();
    currentStream = stream;
    streamIsBorrowed = false;
    sourceNode = audioCtx.createMediaStreamSource(stream);
    startMeyda(sourceNode);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[fft] audio init failed:', msg);
    initStarted = false; // allow retry on next access
  }
}

function startMeyda(source: MediaStreamAudioSourceNode): void {
  if (meydaAnalyzer) {
    try { (meydaAnalyzer as any).stop(); } catch {}
  }
  meydaReadyAt = performance.now() + 300;
  meydaAnalyzer = Meyda.createMeydaAnalyzer({
    audioContext: audioCtx!,
    source,
    bufferSize: FFT_BUFFER_SIZE,
    featureExtractors: [],  // pull mode: passed at get() call time, not at construction
  });
  (meydaAnalyzer as any).start();
}

// ── updateFrame ──────────────────────────────────────────────────────────────

/**
 * @internal
 * Called once per render frame (before pattern queries).
 * Pulls current audio features from Meyda and updates bin/signal values.
 */
export function updateFrame(): void {
  if (!meydaAnalyzer) return;
  if (performance.now() < meydaReadyAt) return;

  let features: Partial<MeydaFeaturesObject> | null;
  try {
    features = (meydaAnalyzer as any).get([...activeFeatures]);
  } catch { return; }
  if (!features) return;

  const sampleRate = audioCtx?.sampleRate ?? 44100;

  // Frequency bins (log-spaced)
  if (features.amplitudeSpectrum) {
    const spectrum = features.amplitudeSpectrum;

    for (let b = 0; b < config.bins; b++) {
      const freqLow  = LOG_FREQ_MIN * Math.pow(LOG_FREQ_MAX / LOG_FREQ_MIN, b       / config.bins);
      const freqHigh = LOG_FREQ_MIN * Math.pow(LOG_FREQ_MAX / LOG_FREQ_MIN, (b + 1) / config.bins);
      const mag = logBinAverage(spectrum, sampleRate, freqLow, freqHigh);
      const raw = normalise(mag, config.cutoff, config.scale);
      binValues[b] = expSmooth(raw, prevBinValues[b], config.smooth);
      prevBinValues[b] = binValues[b];
      if (b === 0) console.log(`[fft] bin0 mag=${mag.toFixed(4)} raw=${raw.toFixed(4)} smoothed=${binValues[0].toFixed(4)}`);
    }
  }

  if (activeFeatures.has('rms') && features.rms != null) {
    const raw = normalise(features.rms, config.cutoff, config.scale);
    volValue = expSmooth(raw, prevVol, config.smooth);
    prevVol = volValue;
  }

  if (activeFeatures.has('spectralCentroid') && features.spectralCentroid != null) {
    const raw = Math.min(1, features.spectralCentroid / (sampleRate / 2));
    centroidValue = expSmooth(raw, prevCentroid, config.smooth);
    prevCentroid = centroidValue;
  }

  if (activeFeatures.has('spectralFlatness') && features.spectralFlatness != null) {
    flatnessValue = expSmooth(features.spectralFlatness, prevFlatness, config.smooth);
    prevFlatness = flatnessValue;
  }

  if (activeFeatures.has('chroma') && features.chroma) {
    const chroma = features.chroma;
    const maxVal = Math.max(...chroma, 1e-6);
    for (let i = 0; i < 12; i++) {
      const raw = chroma[i] / maxVal;
      chromaValues[i] = expSmooth(raw, prevChromaValues[i], config.smooth);
      prevChromaValues[i] = chromaValues[i];
    }
  }
}

// ── Signal factories ─────────────────────────────────────────────────────────

function getBinSignal(n: number): ReturnType<typeof signal> {
  // Trigger init here (signal-creation time = Ctrl+Enter = user gesture),
  // so AudioContext is created while a user activation is live.
  if (!initStarted) lazyInit();
  if (!binSignalCache.has(n)) {
    activeFeatures.add('amplitudeSpectrum');
    binSignalCache.set(n, signal(() => binValues[Math.min(n, binValues.length - 1)] ?? 0));
  }
  return binSignalCache.get(n)!;
}

function getChromaSignal(idx: number): ReturnType<typeof signal> {
  if (!initStarted) lazyInit();
  const i = ((idx % 12) + 12) % 12;
  if (!chromaSignalCache.has(i)) {
    activeFeatures.add('chroma');
    chromaSignalCache.set(i, signal(() => chromaValues[i]));
  }
  return chromaSignalCache.get(i)!;
}

function resolveNote(key: string): number {
  if (key in NOTE_MAP) return NOTE_MAP[key];
  const n = parseInt(key, 10);
  return isNaN(n) ? 0 : ((n % 12) + 12) % 12;
}

function resolveBinName(token: string): number {
  if (token === 'bass') return 0;
  if (token === 'mid') return Math.floor(config.bins / 2);
  if (token === 'treble') return config.bins - 1;
  const n = parseInt(token, 10);
  return isNaN(n) ? 0 : n;
}

// ── setSource ────────────────────────────────────────────────────────────────

/** @internal — accessed as fft.setSource() */
export async function setSource(source: string): Promise<void> {
  audioCtx ??= new AudioContext();

  // Stop existing stream (unless we borrowed tracks from a screen capture)
  if (currentStream && !streamIsBorrowed) {
    currentStream.getTracks().forEach(t => t.stop());
  }
  currentStream = null;
  streamIsBorrowed = false;
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  let stream: MediaStream;

  if (source === 'mic') {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } else if (source === 'system') {
    // Chrome macOS requires video:true; we stop the video track immediately
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    displayStream.getVideoTracks().forEach(t => t.stop());
    stream = displayStream;
  } else if (source.startsWith('screen:')) {
    const name = source.slice(7);
    const state = getAllStreamStates().find(s => s.name === name && s.kind === 'screen' && s.active);
    if (!state) throw new Error(`[fft] no active screen stream "${name}"`);
    const audioTracks = state.stream.getAudioTracks();
    if (audioTracks.length === 0) throw new Error(`[fft] screen stream "${name}" has no audio tracks`);
    // Wrap the borrowed audio track in a new MediaStream — don't stop the original
    stream = new MediaStream([audioTracks[0]]);
    streamIsBorrowed = true;
  } else {
    // Treat as deviceId
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: source } } });
  }

  currentStream = stream;
  initStarted = true; // prevent lazyInit from firing again
  await audioCtx.resume();
  sourceNode = audioCtx.createMediaStreamSource(stream);
  startMeyda(sourceNode);
}

// ── getFftState (sidebar) ────────────────────────────────────────────────────

/** @internal */
export function getFftState() {
  return {
    active: meydaAnalyzer !== null,
    bins: Array.from(binValues) as number[],
    vol: volValue,
    centroid: centroidValue,
    config: { ...config },
  };
}

// ── config change callback ───────────────────────────────────────────────────

let _configChangeCb: (() => void) | null = null;

/** @internal Register a callback fired whenever bins/smooth/cutoff/scale changes. */
export function onFftConfigChange(cb: () => void): void { _configChangeCb = cb; }

/** @internal Apply a saved config object (from URL state) without side effects. */
export function applyFftConfig(cfg: { bins?: number; smooth?: number; cutoff?: number; scale?: number }): void {
  if (cfg.bins   != null) config.bins   = Math.max(1, Math.min(64, Math.round(cfg.bins)));
  if (cfg.smooth != null) config.smooth = Math.max(0, Math.min(1, cfg.smooth));
  if (cfg.cutoff != null) config.cutoff = Math.max(0, Math.min(1, cfg.cutoff));
  if (cfg.scale  != null) config.scale  = Math.max(0, cfg.scale);
  if (cfg.bins   != null) {
    binValues    = new Float32Array(config.bins);
    prevBinValues = new Float32Array(config.bins);
  }
}

/** @internal Returns the current config for URL persistence. */
export function getFftConfig(): { bins: number; smooth: number; cutoff: number; scale: number } {
  return { ...config };
}

// ── chroma proxy (callable + indexable) ─────────────────────────────────────

function chromaFn(arg: string | number): unknown {
  if (typeof arg === 'number') return getChromaSignal(arg);
  // mini-notation string: live pattern alternating between named chroma values
  activeFeatures.add('chroma');
  if (!initStarted) lazyInit();
  return mini(arg).fmap((v: unknown) => {
    const key = String(v);
    return chromaValues[resolveNote(key)] ?? 0;
  });
}

const chromaProxy = new Proxy(chromaFn as Record<string | symbol, unknown>, {
  get(target, key: string | symbol) {
    if (typeof key === 'string') {
      if (/^\d+$/.test(key)) return getChromaSignal(parseInt(key, 10));
      if (key in NOTE_MAP) return getChromaSignal(NOTE_MAP[key]);
    }
    return target[key];
  },
  apply(target, _thisArg, args) {
    return (target as unknown as typeof chromaFn)(...(args as [string | number]));
  },
});

// ── fftImpl ──────────────────────────────────────────────────────────────────

const fftImpl = {
  get vol() {
    activeFeatures.add('rms');
    if (!initStarted) lazyInit();
    if (!_volSignal) _volSignal = signal(() => volValue);
    return _volSignal;
  },
  get centroid() {
    activeFeatures.add('spectralCentroid');
    if (!initStarted) lazyInit();
    if (!_centroidSignal) _centroidSignal = signal(() => centroidValue);
    return _centroidSignal;
  },
  get flatness() {
    activeFeatures.add('spectralFlatness');
    if (!initStarted) lazyInit();
    if (!_flatnessSignal) _flatnessSignal = signal(() => flatnessValue);
    return _flatnessSignal;
  },

  get bass()   { return getBinSignal(0); },
  get mid()    { return getBinSignal(Math.floor(config.bins / 2)); },
  get treble() { return getBinSignal(config.bins - 1); },

  chroma: chromaProxy,

  /**
   * Explicit bin accessor. `fft.bin(0)` equals `fft[0]`.
   * Pass a mini-notation string to alternate between named bins:
   * `fft.bin("bass treble")` alternates between bass and treble bin values (both live).
   * @example
   * $: s("clip").alpha(fft.bin(0))
   * @example
   * $: s("clip").alpha(fft.bin("bass treble"))
   */
  bin(arg: number | string): unknown {
    if (typeof arg === 'number') return getBinSignal(arg);
    if (!initStarted) lazyInit();
    return mini(arg).fmap((v: unknown) => {
      const token = String(v);
      const idx = resolveBinName(token);
      return binValues[Math.min(idx, binValues.length - 1)] ?? 0;
    });
  },

  /**
   * Set number of frequency bands (1–64). Default: 4.
   * @param {number} n number of bins
   * @example fft.setBins(8)
   */
  setBins(n: number) {
    config.bins = Math.max(1, Math.min(64, Math.round(n)));
    binValues = new Float32Array(config.bins);
    prevBinValues = new Float32Array(config.bins);
    _configChangeCb?.();
  },

  /**
   * Temporal smoothing (0–1). 0 = instant/jumpy, 1 = frozen. Default: 0.5.
   * @param {number} v smoothing factor
   * @example fft.setSmooth(0.9)
   */
  setSmooth(v: number) { config.smooth = Math.max(0, Math.min(1, v)); _configChangeCb?.(); },

  /**
   * Noise floor — values below this threshold map to 0. Default: 0.001.
   * @param {number} v cutoff 0–1
   * @example fft.setCutoff(0.1)
   */
  setCutoff(v: number) { config.cutoff = Math.max(0, Math.min(1, v)); _configChangeCb?.(); },

  /**
   * Gain multiplier. Default: 0.5. Values above 1 are allowed.
   * @param {number} v scale factor
   * @example fft.setScale(2)
   */
  setScale(v: number) { config.scale = Math.max(0, v); _configChangeCb?.(); },

  setSource,
};

// ── fft proxy: numeric index access for bins ─────────────────────────────────

/**
 * Audio-reactive signal source. Properties are Strudel signals updated each frame from
 * a microphone or system audio input. Values typically 0–1 but can exceed 1 for loud audio.
 * Auto-starts on first access (browser requests mic permission).
 *
 * **Frequency bins** — log-spaced across 20 Hz–20 kHz:
 * `fft[n]`, `fft.bass`, `fft.mid`, `fft.treble`, `fft.bin(n)`, `fft.bin("bass treble")`
 *
 * **Other signals:**
 * `fft.vol` (RMS volume), `fft.centroid` (0=bass-heavy, 1=treble-heavy),
 * `fft.flatness` (0=tonal, 1=noise)
 *
 * **Chroma (pitch classes):**
 * `fft.chroma['C']`, `fft.chroma['F#']`, `fft.chroma[n]`, `fft.chroma("C A")`
 *
 * **Config** (survives re-eval):
 * `fft.setBins(n)`, `fft.setSmooth(v)`, `fft.setCutoff(v)`, `fft.setScale(v)`
 *
 * **Source** (or use the Audio sidebar tab):
 * `fft.setSource('mic'|'system'|'screen:name'|deviceId)`
 *
 * @example
 * $: s("clip").alpha(fft[0])
 * @example
 * $: s("clip").scale(fft.bass.range(1, 2))
 * @example
 * $: s("clip").huerot(fft.centroid)
 * @example
 * $: s("clip").alpha(fft.vol)
 * @example
 * $: s("clip").alpha(fft.chroma['C'])
 * @example
 * $: s("clip").huerot(fft.chroma("C A"))
 * @example
 * $: s("clip").alpha(fft.bin("bass treble"))
 * @example
 * fft.setBins(8); fft.setSmooth(0.8)
 * @example
 * fft.setSource('system')
 */
export const fft = new Proxy(fftImpl, {
  get(target, key: string | symbol) {
    if (typeof key === 'string' && /^\d+$/.test(key)) {
      return getBinSignal(parseInt(key, 10));
    }
    return (target as Record<string | symbol, unknown>)[key];
  },
}) as typeof fftImpl & { [n: number]: ReturnType<typeof signal> };

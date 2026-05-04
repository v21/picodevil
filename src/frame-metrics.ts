import { isNativeRate } from "./playback-rate";

const MAX_SAMPLES = 300;

export interface FrameMetrics {
  frameTimes: number[];
  interFrameTimes: number[];
  heapSamples: number[];
  seekCount: number;
  poolSize: number;
  freePoolSize: number;
  shareHits: number;
  maxFrameTime: number;
  maxInterFrameTime: number;
  xLog: number[];
  naturalCount: number;
  seekModeCount: number;
  screensCount: number;
  eventsPerFrame: number;
  seeksThisFrame: number;
  driftSeeksThisFrame: number;
  seeksHistory: number[];
  driftSeeksHistory: number[];
  /** Per-phase rolling frame times (ms, last 300 frames). */
  phaseQuery: number[];
  phaseAssign: number[];
  phaseDraw: number[];
  phasePrewarm: number[];
  reset(): void;
}

export function recordFrameMetrics(
  metrics: FrameMetrics,
  frameDuration: number,
  interFrameGap: number,
  activeVideoEls: Array<{ paused: boolean; playbackRate: number }>,
  freeVideoPool: Map<string, unknown[]>,
  screensCount: number,
  lastEventCount: number,
  heapSize?: number,
): void {
  metrics.frameTimes.push(frameDuration);
  if (metrics.frameTimes.length > MAX_SAMPLES) metrics.frameTimes.shift();
  if (frameDuration > metrics.maxFrameTime) metrics.maxFrameTime = frameDuration;

  metrics.interFrameTimes.push(interFrameGap);
  if (metrics.interFrameTimes.length > MAX_SAMPLES) metrics.interFrameTimes.shift();
  if (interFrameGap > metrics.maxInterFrameTime) metrics.maxInterFrameTime = interFrameGap;

  if (heapSize !== undefined) {
    metrics.heapSamples.push(heapSize);
    if (metrics.heapSamples.length > MAX_SAMPLES) metrics.heapSamples.shift();
  }

  metrics.poolSize = activeVideoEls.length;
  let freeCount = 0;
  for (const list of freeVideoPool.values()) freeCount += list.length;
  metrics.freePoolSize = freeCount;

  metrics.screensCount = screensCount;
  metrics.eventsPerFrame = lastEventCount;

  let naturalCount = 0, seekModeCount = 0;
  for (const el of activeVideoEls) {
    if (el.paused) seekModeCount++;
    else if (isNativeRate(el.playbackRate)) naturalCount++;
    else seekModeCount++;
  }
  metrics.naturalCount = naturalCount;
  metrics.seekModeCount = seekModeCount;

  metrics.seeksHistory.push(metrics.seeksThisFrame);
  if (metrics.seeksHistory.length > MAX_SAMPLES) metrics.seeksHistory.shift();
  metrics.driftSeeksHistory.push(metrics.driftSeeksThisFrame);
  if (metrics.driftSeeksHistory.length > MAX_SAMPLES) metrics.driftSeeksHistory.shift();
  metrics.driftSeeksThisFrame = 0;
}

export function createMetrics(): FrameMetrics {
  return {
    frameTimes: [],
    interFrameTimes: [],
    heapSamples: [],
    seekCount: 0,
    poolSize: 0,
    freePoolSize: 0,
    shareHits: 0,
    maxFrameTime: 0,
    maxInterFrameTime: 0,
    xLog: [],
    naturalCount: 0,
    seekModeCount: 0,
    screensCount: 0,
    eventsPerFrame: 0,
    seeksThisFrame: 0,
    driftSeeksThisFrame: 0,
    seeksHistory: [],
    driftSeeksHistory: [],
    phaseQuery: [],
    phaseAssign: [],
    phaseDraw: [],
    phasePrewarm: [],
    reset() {
      this.frameTimes = [];
      this.interFrameTimes = [];
      this.heapSamples = [];
      this.seekCount = 0;
      this.shareHits = 0;
      this.maxFrameTime = 0;
      this.maxInterFrameTime = 0;
      this.xLog = [];
      this.phaseQuery = [];
      this.phaseAssign = [];
      this.phaseDraw = [];
      this.phasePrewarm = [];
    },
  };
}

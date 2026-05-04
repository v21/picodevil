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

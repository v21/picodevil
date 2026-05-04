import { Pattern } from "@strudel/core";

export interface CpsSnapshot {
  cyclesPerSecond: number;
  cpsPattern: Pattern | null;
  accumulatedCycle: number;
  startMs: number;
  lastTickMs: number;
}

export class CpsController {
  private _cyclesPerSecond: number;
  private _cpsPattern: Pattern | null = null;
  private _accumulatedCycle: number = 0;
  private _startMs: number;
  private _lastTickMs: number;

  constructor(initialCps: number, nowMs: number) {
    this._cyclesPerSecond = initialCps;
    this._startMs = nowMs;
    this._lastTickMs = nowMs;
  }

  get cyclesPerSecond(): number { return this._cyclesPerSecond; }
  get cpsPattern(): Pattern | null { return this._cpsPattern; }

  setCps(cps: number | Pattern, nowMs: number): void {
    if (typeof cps === "number") {
      if (cps === 0) {
        const nowSec = (nowMs - this._startMs) / 1000;
        this._accumulatedCycle = nowSec * this._cyclesPerSecond;
        this._cyclesPerSecond = 0;
        this._cpsPattern = null;
        return;
      }
      const nowSec = (nowMs - this._startMs) / 1000;
      // When frozen (cyclesPerSecond=0), the real position is in accumulatedCycle
      const currentCycle = this._cyclesPerSecond === 0
        ? this._accumulatedCycle
        : nowSec * this._cyclesPerSecond;
      this._startMs = nowMs - (currentCycle / cps) * 1000;
      this._cyclesPerSecond = cps;
      this._cpsPattern = null;
    } else {
      this._cpsPattern = cps;
    }
  }

  setCpm(cpm: number | Pattern, nowMs: number): void {
    if (typeof cpm === "number") {
      this.setCps(cpm / 60, nowMs);
    } else {
      this.setCps(cpm.fmap((v: number) => v / 60), nowMs);
    }
  }

  tick(nowMs: number): { cps: number; cycle: number; t: number } {
    const nowSec = (nowMs - this._startMs) / 1000;
    const deltaSec = (nowMs - this._lastTickMs) / 1000;
    this._lastTickMs = nowMs;

    let cps = this._cyclesPerSecond;
    if (this._cpsPattern) {
      const haps = this._cpsPattern.queryArc(this._accumulatedCycle, this._accumulatedCycle);
      if (haps.length > 0) cps = Math.max(0, Number(haps[0].value)) || 0;
    }
    this._accumulatedCycle += deltaSec * cps;

    const cycle = (this._cpsPattern || this._cyclesPerSecond === 0)
      ? this._accumulatedCycle
      : nowSec * this._cyclesPerSecond;
    return { cps, cycle, t: Math.floor(cycle) + (cycle % 1) };
  }

  snapshot(): CpsSnapshot {
    return {
      cyclesPerSecond: this._cyclesPerSecond,
      cpsPattern: this._cpsPattern,
      accumulatedCycle: this._accumulatedCycle,
      startMs: this._startMs,
      lastTickMs: this._lastTickMs,
    };
  }

  restore(snap: CpsSnapshot): void {
    this._cyclesPerSecond = snap.cyclesPerSecond;
    this._cpsPattern = snap.cpsPattern;
    this._accumulatedCycle = snap.accumulatedCycle;
    this._startMs = snap.startMs;
    this._lastTickMs = snap.lastTickMs;
  }
}

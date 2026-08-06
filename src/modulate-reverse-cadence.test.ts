/**
 * Invariant: `.modulate()` is transparent to the wrapped pattern's video
 * playback. A modulator is just another screen through the pool (a hidden
 * auto-FBO layer), so `s(x).speed(-1)` used as a modulator must produce the
 * same element identity, seek cadence, and position trajectory as the same
 * clip standalone — no churn, no extra/dropped seeks, no drift.
 *
 * Reverse playback is the sharp case: it has no native rate, so position is
 * driven by manual seeks throttled on `!el.seeking`. The mock models real seek
 * LATENCY (a seek stays in-flight a few frames) so that throttle actually
 * engages — an instant-seek mock would mask any cadence difference.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { screen } from "./screen-pattern";
import {
  initRegistry, resetRegistry, collectScreens, getNamedScreenIndices,
} from "./pattern-registry";
import type { Renderer, TileParams } from "./renderer-interface";
import "./visual-controls";
import "./effects-controls";

// A real range-fetch seek takes a few frames to decode; while in flight the
// element reports seeking=true, which the reverse throttle (`!el.seeking`) gates on.
const SEEK_LATENCY_FRAMES = 3;

class MockVideo {
  private _l: Record<string, Function[]> = {};
  private _seeking = false; private _target = 0; private _left = 0;
  private _ct = 0; private _src = "";
  duration = 10; videoWidth = 320; videoHeight = 240;
  paused = true; playbackRate = 1;
  loop = false; muted = true; playsInline = true; preload = "";
  id: number; seekCount = 0; _state: any;
  constructor(id: number) { this.id = id; }
  get seeking() { return this._seeking; }
  get currentTime() { return this._ct; }
  set currentTime(v: number) {
    this._target = v; this._seeking = true; this._left = SEEK_LATENCY_FRAMES; this.seekCount++;
  }
  /** Advance any in-flight seek toward completion. Call once before each render. */
  tick() { if (this._seeking && --this._left <= 0) { this._ct = this._target; this._seeking = false; this._d("seeked"); } }
  get src() { return this._src; }
  set src(v: string) { this._src = v; this._d("loadedmetadata"); this._d("loadeddata"); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {} removeAttribute() { this._src = ""; }
  addEventListener(t: string, fn: Function) { (this._l[t] ||= []).push(fn); }
  removeEventListener() {}
  private _d(t: string) { for (const fn of this._l[t] || []) fn.call(this, { type: t }); }
}

class MockRenderer implements Renderer {
  resize() {} beginFrame() {} drawTile(_p: TileParams) {} endFrame() {}
  beginOffscreen() {} endOffscreen() {} snapshotSoFar() {} captureAll() {}
  sweepAutoFBOs() {} getViewportSize() { return { w: 640, h: 480 }; } dispose() {}
}

interface Trace { elementCount: number; trajectory: string[]; seeksPerFrame: number[]; }

/** Drive `frames` frames and record canalmoss element count + per-frame position/seeks. */
function trace(build: () => void, frames: number): Trace {
  resetRegistry(); initRegistry();
  build();
  const screens = collectScreens();
  const named = getNamedScreenIndices();
  let nextId = 0;
  const created: MockVideo[] = [];
  const pool = createVideoPoolManager({
    resolveMediaUrl: (n: string) => "http://test/" + n,
    createElement: () => { const v = new MockVideo(nextId++); created.push(v); return v as any; },
  }) as any;
  const fr = new FrameRenderer(new MockRenderer(), pool, createMetrics());

  const cps = 1, dt = 1 / 60;
  const trajectory: string[] = [];
  const seeksPerFrame: number[] = [];
  let prevSeeks = 0;
  for (let f = 0; f < frames; f++) {
    for (const v of created) v.tick();
    fr.render(screens as any, named, f * cps * dt, cps, f * cps * dt, 1000 + f * dt * 1000);
    const cm = created.filter(v => v.src.includes("canalmoss"));
    trajectory.push(cm.map(v => v.currentTime.toFixed(3)).join("|"));
    const totalSeeks = cm.reduce((n, v) => n + v.seekCount, 0);
    seeksPerFrame.push(totalSeeks - prevSeeks);
    prevSeeks = totalSeeks;
  }
  const elementCount = new Set(created.filter(v => v.src.includes("canalmoss")).map(v => v.id)).size;
  return { elementCount, trajectory, seeksPerFrame };
}

const FRAMES = 24;
const standaloneReverse = () => { (screen("canalmoss.mp4") as any).speed(-1).p("$"); };

beforeEach(() => { resetRegistry(); initRegistry(); });

describe("modulate is transparent to the modulator's video playback", () => {
  it("reverse modulator under a rolling consumer matches standalone exactly", () => {
    const standalone = trace(standaloneReverse, FRAMES);
    const asModulator = trace(() => {
      (screen("ducks.mp4") as any).rolling().modulate((screen("canalmoss.mp4") as any).speed(-1)).p("$");
    }, FRAMES);
    // One element (no churn), and byte-identical seek cadence + position trajectory.
    expect(standalone.elementCount).toBe(1);
    expect(asModulator.elementCount).toBe(1);
    expect(asModulator.trajectory).toEqual(standalone.trajectory);
    expect(asModulator.seeksPerFrame).toEqual(standalone.seeksPerFrame);
  });

  it("reverse modulator under a non-rolling consumer matches standalone too", () => {
    const standalone = trace(standaloneReverse, FRAMES);
    const asModulator = trace(() => {
      (screen("ducks.mp4") as any).modulate((screen("canalmoss.mp4") as any).speed(-1)).p("$");
    }, FRAMES);
    expect(asModulator.trajectory).toEqual(standalone.trajectory);
  });
});

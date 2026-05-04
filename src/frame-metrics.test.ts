import { describe, it, expect } from "vitest";
import { createMetrics, recordFrameMetrics } from "./frame-metrics";

function makeEl(paused: boolean, playbackRate: number) {
  return { paused, playbackRate };
}

describe("recordFrameMetrics", () => {
  it("appends frameDuration and updates maxFrameTime", () => {
    const m = createMetrics();
    recordFrameMetrics(m, 12, 17, [], new Map(), 0, 0);
    expect(m.frameTimes).toEqual([12]);
    expect(m.maxFrameTime).toBe(12);

    recordFrameMetrics(m, 8, 17, [], new Map(), 0, 0);
    expect(m.frameTimes).toEqual([12, 8]);
    expect(m.maxFrameTime).toBe(12); // max stays 12
  });

  it("appends interFrameGap and updates maxInterFrameTime", () => {
    const m = createMetrics();
    recordFrameMetrics(m, 5, 20, [], new Map(), 0, 0);
    expect(m.interFrameTimes).toEqual([20]);
    expect(m.maxInterFrameTime).toBe(20);
  });

  it("trims frameTimes and interFrameTimes to 300 samples", () => {
    const m = createMetrics();
    for (let i = 0; i < 301; i++) recordFrameMetrics(m, i, i, [], new Map(), 0, 0);
    expect(m.frameTimes.length).toBe(300);
    expect(m.interFrameTimes.length).toBe(300);
    expect(m.frameTimes[0]).toBe(1); // first entry (0) was shifted out
  });

  it("appends heapSize when provided", () => {
    const m = createMetrics();
    recordFrameMetrics(m, 5, 16, [], new Map(), 0, 0, 1_000_000);
    expect(m.heapSamples).toEqual([1_000_000]);
  });

  it("skips heapSamples when heapSize is undefined", () => {
    const m = createMetrics();
    recordFrameMetrics(m, 5, 16, [], new Map(), 0, 0, undefined);
    expect(m.heapSamples).toEqual([]);
  });

  it("sets poolSize from activeVideoEls length", () => {
    const m = createMetrics();
    recordFrameMetrics(m, 5, 16, [makeEl(false, 1), makeEl(false, 1)], new Map(), 0, 0);
    expect(m.poolSize).toBe(2);
  });

  it("sets freePoolSize as sum of free list lengths", () => {
    const m = createMetrics();
    const freePool = new Map([
      ["a.mp4", [{}, {}]],
      ["b.mp4", [{}]],
    ]);
    recordFrameMetrics(m, 5, 16, [], freePool as any, 0, 0);
    expect(m.freePoolSize).toBe(3);
  });

  it("sets screensCount and eventsPerFrame", () => {
    const m = createMetrics();
    recordFrameMetrics(m, 5, 16, [], new Map(), 7, 42);
    expect(m.screensCount).toBe(7);
    expect(m.eventsPerFrame).toBe(42);
  });

  it("counts natural rate elements as naturalCount", () => {
    const m = createMetrics();
    // playbackRate 1 is native; paused=false → natural
    recordFrameMetrics(m, 5, 16, [makeEl(false, 1), makeEl(false, 2)], new Map(), 0, 0);
    expect(m.naturalCount).toBe(2);
    expect(m.seekModeCount).toBe(0);
  });

  it("counts paused elements as seekModeCount", () => {
    const m = createMetrics();
    recordFrameMetrics(m, 5, 16, [makeEl(true, 1)], new Map(), 0, 0);
    expect(m.seekModeCount).toBe(1);
    expect(m.naturalCount).toBe(0);
  });

  it("counts non-native-rate playing elements as seekModeCount", () => {
    const m = createMetrics();
    // rate 0.001 is below native range
    recordFrameMetrics(m, 5, 16, [makeEl(false, 0.001)], new Map(), 0, 0);
    expect(m.seekModeCount).toBe(1);
    expect(m.naturalCount).toBe(0);
  });

  it("rolls seeksThisFrame into seeksHistory and trims to 300", () => {
    const m = createMetrics();
    m.seeksThisFrame = 3;
    recordFrameMetrics(m, 5, 16, [], new Map(), 0, 0);
    expect(m.seeksHistory).toEqual([3]);

    for (let i = 0; i < 300; i++) recordFrameMetrics(m, 5, 16, [], new Map(), 0, 0);
    expect(m.seeksHistory.length).toBe(300);
  });

  it("rolls driftSeeksThisFrame into driftSeeksHistory and resets it to 0", () => {
    const m = createMetrics();
    m.driftSeeksThisFrame = 5;
    recordFrameMetrics(m, 5, 16, [], new Map(), 0, 0);
    expect(m.driftSeeksHistory).toEqual([5]);
    expect(m.driftSeeksThisFrame).toBe(0);
  });
});

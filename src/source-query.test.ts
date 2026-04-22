import { describe, it, expect } from "vitest";
import { queryNeeded, type NeededSource } from "./source-query";
import { VIDEO_BASE, IMAGE_BASE } from "./config";

// Minimal screen mock: returns provided haps from queryArc
function makeScreen(haps: any[]) {
  return { queryArc: (_s: number, _e: number) => haps };
}

// Minimal hap
function makeHap(value: any, wholeBegin = 0, wholeEnd = 1) {
  return { value, whole: { begin: wholeBegin, end: wholeEnd }, part: { begin: wholeBegin, end: wholeEnd } };
}

describe("queryNeeded", () => {
  it("returns empty list for no screens", () => {
    const { needed } = queryNeeded([], 0, 1, new Map());
    expect(needed).toHaveLength(0);
  });

  it("skips non-object events", () => {
    const screen = makeScreen([makeHap(null), makeHap(42)]);
    const { needed } = queryNeeded([screen], 0, 1, new Map());
    expect(needed).toHaveLength(0);
  });

  it("skips color events (handled separately)", () => {
    const screen = makeScreen([makeHap({ _type: "color", color: "red" })]);
    const { needed } = queryNeeded([screen], 0, 1, new Map());
    expect(needed).toHaveLength(0);
  });

  it("produces NeededSource for a video event", () => {
    const screen = makeScreen([makeHap({ _type: "video", src: "clip.mp4" })]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed } = queryNeeded([screen], 0, 0.5, durations);
    expect(needed).toHaveLength(1);
    expect(needed[0].kind).toBe("video");
    expect(needed[0].srcUrl).toBe(VIDEO_BASE + "clip.mp4");
    expect(needed[0].speed).toBe(1);
    expect(needed[0].expectedTime).toBeCloseTo(0); // cycle 0, event begin 0 → time 0
  });

  it("produces NeededSource for an image event (expectedTime=0, speed=0)", () => {
    const screen = makeScreen([makeHap({ _type: "image", src: "photo.jpg" })]);
    const { needed } = queryNeeded([screen], 0, 1, new Map());
    expect(needed).toHaveLength(1);
    expect(needed[0].kind).toBe("image");
    expect(needed[0].srcUrl).toBe(IMAGE_BASE + "photo.jpg");
    expect(needed[0].speed).toBe(0);
    expect(needed[0].expectedTime).toBe(0);
  });

  it("marks rolling video with expectedTime=null", () => {
    const screen = makeScreen([makeHap({ _type: "video", src: "clip.mp4", rolling: true })]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed } = queryNeeded([screen], 0, 1, durations);
    expect(needed[0].expectedTime).toBeNull();
  });

  it("deduplicates two events with same srcUrl+speed+similar time into one NeededSource", () => {
    const hap1 = makeHap({ _type: "video", src: "clip.mp4" });
    const hap2 = makeHap({ _type: "video", src: "clip.mp4" });
    const screen = makeScreen([hap1, hap2]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed, eventMap } = queryNeeded([screen], 0, 0.5, durations);
    // Both events at the same time → deduplicated to one NeededSource
    expect(needed).toHaveLength(1);
    // Both haps should map to the same NeededSource
    const events = eventMap.get(needed[0])!;
    expect(events).toHaveLength(2);
  });

  it("does NOT deduplicate events with same src but different speeds", () => {
    const hap1 = makeHap({ _type: "video", src: "clip.mp4", speed: 1 });
    const hap2 = makeHap({ _type: "video", src: "clip.mp4", speed: 2 });
    const screen = makeScreen([hap1, hap2]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed } = queryNeeded([screen], 0, 0.5, durations);
    expect(needed).toHaveLength(2);
  });

  it("does NOT deduplicate events with same src but different expected times", () => {
    // Use chopStack-like scenario: same src, speed 1, but different sync offsets
    // At t=1, cps=0.5: elapsed=2s. sync=0→expected=2s; sync=0.2→expected=0s (2s apart)
    const hap1 = makeHap({ _type: "video", src: "clip.mp4", sync: 0 });
    const hap2 = makeHap({ _type: "video", src: "clip.mp4", sync: 0.2 });
    const screen = makeScreen([hap1, hap2]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed } = queryNeeded([screen], 1, 0.5, durations);
    expect(needed).toHaveLength(2);
  });

  it("respects custom urlBase from event", () => {
    const screen = makeScreen([makeHap({ _type: "video", src: "clip.mp4", urlBase: "/custom/" })]);
    const { needed } = queryNeeded([screen], 0, 1, new Map());
    expect(needed[0].srcUrl).toBe("/custom/clip.mp4");
  });

  it("handles queryArc errors gracefully (skips screen)", () => {
    const bad = { queryArc: () => { throw new Error("boom"); } };
    const good = makeScreen([makeHap({ _type: "image", src: "x.jpg" })]);
    const { needed } = queryNeeded([bad, good], 0, 1, new Map());
    expect(needed).toHaveLength(1);
  });

  it("eventMap maps each NeededSource to its FrameEvents", () => {
    const hap = makeHap({ _type: "video", src: "a.mp4" });
    const screen = makeScreen([hap]);
    const durations = new Map([[VIDEO_BASE + "a.mp4", 5]]);
    const { needed, eventMap } = queryNeeded([screen], 0, 1, durations);
    expect(eventMap.has(needed[0])).toBe(true);
    const events = eventMap.get(needed[0])!;
    expect(events[0].hap).toBe(hap);
  });
});

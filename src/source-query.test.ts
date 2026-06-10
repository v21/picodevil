import { describe, it, expect } from "vitest";
import { stack } from "@strudel/core";
import { queryNeeded, type NeededSource } from "./source-query";
import { getVideoBase, getImageBase } from "./server-config";
import { MAX_SOURCES_PER_FRAME, MAX_EVENTS_PER_FRAME } from "./config";
import { flushWarnings, clearWarnings } from "./warnings";

const VIDEO_BASE = getVideoBase() || "http://localhost:47426/videos/";
const IMAGE_BASE = getImageBase() || "http://localhost:47426/images/";
import { screen } from "./screen-pattern";
import { matchSources } from "./source-matcher";
import { renderVideoFrame, type VideoEl } from "./video-playback";
import { createVideoState } from "./video-element-state";
import "./index-patterns";
import "./visual-controls";

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

  it("caps distinct sources per frame and warns (crash guard)", () => {
    clearWarnings();
    // Many more distinct video sources than the cap — would otherwise create a
    // <video> element per source and crash the tab.
    const haps = Array.from({ length: MAX_SOURCES_PER_FRAME + 200 }, (_, i) =>
      makeHap({ _type: "video", src: `clip${i}.mp4` }));
    const { needed } = queryNeeded([makeScreen(haps)], 0, 0.5, new Map());
    expect(needed.length).toBeLessThanOrEqual(MAX_SOURCES_PER_FRAME);
    expect(flushWarnings().some(m => /too many sources/i.test(m))).toBe(true);
  });

  it("caps total events per frame", () => {
    clearWarnings();
    const haps = Array.from({ length: MAX_EVENTS_PER_FRAME + 500 }, () =>
      makeHap({ _type: "color", color: "red" })); // colours count toward allEvents, not needed
    const { allEvents } = queryNeeded([makeScreen(haps)], 0, 1, new Map());
    expect(allEvents.length).toBeLessThanOrEqual(MAX_EVENTS_PER_FRAME);
    expect(flushWarnings().some(m => /too many/i.test(m))).toBe(true);
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

  it("does NOT deduplicate rolling events with different sync values", () => {
    const hap1 = makeHap({ _type: "video", src: "clip.mp4", rolling: true, sync: 0.5 });
    const hap2 = makeHap({ _type: "video", src: "clip.mp4", rolling: true, sync: 0.2 });
    const screen = makeScreen([hap1, hap2]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed } = queryNeeded([screen], 0, 1, durations);
    expect(needed).toHaveLength(2);
  });

  it("deduplicates rolling events with same sync value", () => {
    const hap1 = makeHap({ _type: "video", src: "clip.mp4", rolling: true, sync: 0.5 });
    const hap2 = makeHap({ _type: "video", src: "clip.mp4", rolling: true, sync: 0.5 });
    const screen = makeScreen([hap1, hap2]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed } = queryNeeded([screen], 0, 1, durations);
    expect(needed).toHaveLength(1);
  });

  it("deduplicates rolling events with no sync value", () => {
    const hap1 = makeHap({ _type: "video", src: "clip.mp4", rolling: true });
    const hap2 = makeHap({ _type: "video", src: "clip.mp4", rolling: true });
    const screen = makeScreen([hap1, hap2]);
    const durations = new Map([[VIDEO_BASE + "clip.mp4", 10]]);
    const { needed } = queryNeeded([screen], 0, 1, durations);
    expect(needed).toHaveLength(1);
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

describe("queryNeeded with real pattern API", () => {
  const SRC = "hXJaBfcdCKM.mp4";
  const srcUrl = VIDEO_BASE + SRC;
  const durations = new Map([[srcUrl, 10]]);
  const CPS = 0.5;

  it("stack(s(x).rolling().sync(.5), s(x).rolling().sync(.2)).index().tile() → two NeededSources", () => {
    // This is the exact user-reported pattern that was showing both videos in sync.
    // Both should get separate NeededSources so they can be assigned separate elements.
    const pat = stack(
      screen(SRC).rolling().sync(.5),
      screen(SRC).rolling().sync(.2),
    ).index().tile();

    const scr = { queryArc: (s: number, e: number) => pat.queryArc(s, e) };
    const { needed } = queryNeeded([scr], 0, CPS, durations);

    // Log event values for diagnosis
    const haps = pat.queryArc(0, 0.0001);
    console.log("haps count:", haps.length);
    haps.forEach((h: any, i: number) => console.log(`hap[${i}] sync=${h.value?.sync} rolling=${h.value?.rolling} src=${h.value?.src}`));
    console.log("needed count:", needed.length);
    needed.forEach((ns: any, i: number) => console.log(`ns[${i}] sync=${ns.ev.sync} expectedTime=${ns.expectedTime}`));

    // Two different sync offsets → must NOT share a NeededSource
    expect(needed).toHaveLength(2);
    const syncVals = needed.map((ns: any) => ns.ev.sync).sort();
    expect(syncVals[0]).toBeCloseTo(0.2);
    expect(syncVals[1]).toBeCloseTo(0.5);
  });

  it("stack(s(x).rolling().sync(.5), s(x).rolling().sync(.5)).index().tile() → one NeededSource (shared)", () => {
    const pat = stack(
      screen(SRC).rolling().sync(.5),
      screen(SRC).rolling().sync(.5),
    ).index().tile();

    const scr = { queryArc: (s: number, e: number) => pat.queryArc(s, e) };
    const { needed } = queryNeeded([scr], 0, CPS, durations);

    // Same sync offset → can share
    expect(needed).toHaveLength(1);
  });
});

/** Make a mock video element with a mutable state object (duration settable after creation). */
function makeMutableVideoEl(initialDuration: number): VideoEl {
  const state = { currentTime: 0, duration: initialDuration, paused: true, playbackRate: 1 };
  return Object.assign(
    {
      _state: createVideoState(),
      get currentTime() { return state.currentTime; },
      set currentTime(v: number) { state.currentTime = v; },
      get duration() { return state.duration; },
      get paused() { return state.paused; },
      get playbackRate() { return state.playbackRate; },
      set playbackRate(v: number) { state.playbackRate = v; },
      get src() { return "test.mp4"; },
      play() { state.paused = false; return Promise.resolve(); },
      pause() { state.paused = true; },
    },
    { _mutableState: state },
  ) as unknown as VideoEl & { _mutableState: typeof state };
}

describe("rolling+sync full pipeline: dedup → matchSources → renderVideoFrame", () => {
  const SRC = "hXJaBfcdCKM.mp4";
  const srcUrl = VIDEO_BASE + SRC;
  const DUR = 10;
  const CPS = 0.5;
  const durations = new Map([[srcUrl, DUR]]);

  it("two rolling+sync tiles with different offsets render to different video positions", () => {
    const pat = stack(
      screen(SRC).rolling().sync(.5),
      screen(SRC).rolling().sync(.2),
    ).index().tile();
    const scr = { queryArc: (s: number, e: number) => pat.queryArc(s, e) };

    const { needed, eventMap } = queryNeeded([scr], 0, CPS, durations);
    expect(needed).toHaveLength(2);

    // Build a free pool with two fresh elements (simulating a page load where no
    // elements exist yet and both are freshly created by matchSources).
    const el0 = makeMutableVideoEl(DUR);
    const el1 = makeMutableVideoEl(DUR);
    let elIdx = 0;
    const freePool = new Map<string, any[]>();
    const assignments = matchSources(needed, freePool, durations, 0.016, () => {
      const el = [el0, el1][elIdx++];
      (el as any)._state.srcUrl = srcUrl;
      return el;
    });

    expect(assignments).toHaveLength(2);

    // Run renderVideoFrame for both assignments
    for (const a of assignments) {
      const ns = a.needed;
      const fes = eventMap.get(ns)!;
      for (const fe of fes) {
        renderVideoFrame({
          ev: fe.ev, el: a.el as VideoEl,
          currentCycle: 0, eventBegin: 0, cps: CPS,
        });
      }
    }

    // After renderVideoFrame, the two elements should be at their respective sync positions
    const positions = assignments.map(a => (a.el as VideoEl).currentTime).sort((a, b) => a - b);
    console.log("element positions:", positions);

    // sync=0.2 → 2s, sync=0.5 → 5s — should NOT both be at 0
    expect(positions[0]).toBeCloseTo(2, 0);
    expect(positions[1]).toBeCloseTo(5, 0);
  });
});

import { describe, it, expect } from "vitest";
import { matchSources, type NeededSource, type FreePool, type Assignment } from "./source-matcher";
import { createVideoState, type VideoEl } from "./video-element-state";

function makeVideoEl(currentTime = 0, srcUrl = "http://test/a.mp4"): VideoEl {
  const el = {
    currentTime,
    duration: 10,
    src: srcUrl,
    paused: true,
    playbackRate: 1,
    loop: false,
    muted: false,
    playsInline: false,
    preload: "",
    videoWidth: 320,
    videoHeight: 240,
    play() { return Promise.resolve(); },
    pause() {},
    load() {},
    removeAttribute() {},
    addEventListener() {},
    _state: createVideoState(),
  } as unknown as VideoEl;
  el._state.srcUrl = srcUrl;
  return el;
}

function makeImageEl(srcUrl = "http://test/img.jpg"): HTMLImageElement {
  return { src: srcUrl, naturalWidth: 100, naturalHeight: 100 } as unknown as HTMLImageElement;
}

function makeNeededVideo(
  srcUrl: string,
  expectedTime: number | null,
  speed = 1,
  ev: any = {},
): NeededSource {
  return { kind: "video", srcUrl, expectedTime, speed, ev, hap: {} };
}

function makeNeededImage(srcUrl: string): NeededSource {
  return { kind: "image", srcUrl, expectedTime: 0, speed: 0, ev: {}, hap: {} };
}

describe("matchSources", () => {
  const FRAME_DT = 1 / 60;

  describe("empty inputs", () => {
    it("returns empty assignments for empty needed list", () => {
      const free: FreePool = new Map();
      const result = matchSources([], free, new Map(), FRAME_DT);
      expect(result).toHaveLength(0);
    });

    it("allocates new element when free pool is empty", () => {
      const free: FreePool = new Map();
      const needed = [makeNeededVideo("http://test/a.mp4", 0)];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result).toHaveLength(1);
      expect(result[0].isNew).toBe(true);
      expect(result[0].el).toBeDefined();
    });
  });

  describe("pool reuse", () => {
    it("reuses a free element with matching srcUrl", () => {
      const el = makeVideoEl(0, "http://test/a.mp4");
      const free: FreePool = new Map([["http://test/a.mp4", [el]]]);
      const needed = [makeNeededVideo("http://test/a.mp4", 0)];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result[0].el).toBe(el);
      expect(result[0].isNew).toBe(false);
      // Free pool should be emptied for this src (key removed when list becomes empty)
      expect(free.get("http://test/a.mp4") ?? []).toHaveLength(0);
    });

    it("does NOT reuse an element with wrong srcUrl", () => {
      const el = makeVideoEl(0, "http://test/b.mp4");
      const free: FreePool = new Map([["http://test/b.mp4", [el]]]);
      const needed = [makeNeededVideo("http://test/a.mp4", 0)];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result[0].isNew).toBe(true);
      // b.mp4 element should remain in free pool
      expect(free.get("http://test/b.mp4")).toContain(el);
    });

    it("prefers element with closest predicted time", () => {
      const elFar = makeVideoEl(1.0, "http://test/a.mp4"); // far from target 8
      const elClose = makeVideoEl(7.9, "http://test/a.mp4"); // close to target 8
      const free: FreePool = new Map([["http://test/a.mp4", [elFar, elClose]]]);
      const durations = new Map([["http://test/a.mp4", 10]]);
      const needed = [makeNeededVideo("http://test/a.mp4", 8)];
      const result = matchSources(needed, free, durations, FRAME_DT);
      expect(result[0].el).toBe(elClose);
    });

    it("does not assign the same element twice", () => {
      const el = makeVideoEl(5, "http://test/a.mp4");
      const free: FreePool = new Map([["http://test/a.mp4", [el]]]);
      const durations = new Map([["http://test/a.mp4", 10]]);
      const needed = [
        makeNeededVideo("http://test/a.mp4", 4),
        makeNeededVideo("http://test/a.mp4", 6),
      ];
      const result = matchSources(needed, free, durations, FRAME_DT);
      // One gets the element, the other gets a new one
      const assignedEls = result.map(r => r.el);
      expect(new Set(assignedEls).size).toBe(2);
    });
  });

  describe("rolling sources (expectedTime=null)", () => {
    it("matches any element with the same srcUrl (score 0 for rolling)", () => {
      const el = makeVideoEl(7.3, "http://test/a.mp4");
      const free: FreePool = new Map([["http://test/a.mp4", [el]]]);
      const needed = [makeNeededVideo("http://test/a.mp4", null)];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result[0].el).toBe(el);
      expect(result[0].isNew).toBe(false);
    });

    it("prefers the FIRST (front) candidate — the previously active element — to avoid state reset", () => {
      // In renderer.ts, previously active elements are prepended (unshifted) to the freePool
      // so they appear at index 0. Rolling must take from index 0 to reuse the element with
      // preserved _state (lastEventBegin=0), avoiding isNewEvent=true and a spurious seek.
      const previouslyActive = makeVideoEl(5.0, "http://test/a.mp4"); // front = preferred
      const idlePoolEl = makeVideoEl(0.0, "http://test/a.mp4");       // back = avoid
      const free: FreePool = new Map([["http://test/a.mp4", [previouslyActive, idlePoolEl]]]);
      const needed = [makeNeededVideo("http://test/a.mp4", null)];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result[0].el).toBe(previouslyActive);
    });

    it("creates a new element when no matching src in pool for rolling", () => {
      const free: FreePool = new Map();
      const needed = [makeNeededVideo("http://test/a.mp4", null)];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result[0].isNew).toBe(true);
    });
  });

  describe("image sources", () => {
    it("reuses a free image element", () => {
      const el = makeImageEl("http://test/img.jpg");
      const free: FreePool = new Map([["http://test/img.jpg", [el as any]]]);
      const needed = [makeNeededImage("http://test/img.jpg")];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result[0].el).toBe(el);
      expect(result[0].isNew).toBe(false);
    });

    it("creates a new image element when pool is empty", () => {
      const free: FreePool = new Map();
      const needed = [makeNeededImage("http://test/img.jpg")];
      const result = matchSources(needed, free, new Map(), FRAME_DT);
      expect(result[0].isNew).toBe(true);
      expect((result[0].el as HTMLImageElement).src).toBe("http://test/img.jpg");
    });
  });

  describe("unmatched free elements", () => {
    it("leaves unmatched elements back in free pool", () => {
      const el = makeVideoEl(5, "http://test/b.mp4");
      const free: FreePool = new Map([["http://test/b.mp4", [el]]]);
      // Need something else entirely
      const needed = [makeNeededVideo("http://test/a.mp4", 0)];
      matchSources(needed, free, new Map(), FRAME_DT);
      // b.mp4 should remain in free pool (it was not consumed)
      expect(free.get("http://test/b.mp4")).toContain(el);
    });
  });

  describe("in-flight elements (desiredTime)", () => {
    // Regression: begin().syncStack() seek storm. Same-src elements driven to deterministic
    // slots are permanently mid-seek (their decoded currentTime is stranded between where they
    // were and where they were last commanded). Matching on the stranded currentTime reshuffles
    // the element→slot binding every frame, which poisons velocity tracking and produces a
    // nonnative seek storm. Matching on desiredTime (the committed target) keeps the binding
    // stable so each element settles on its slot and plays natively.
    it("keeps each element on the slot it was committed to, ignoring stranded currentTime", () => {
      // 3 slots at 2/4/6s. Each element was last commanded to one slot (desiredTime) but its
      // decoded currentTime is stranded elsewhere (mid-seek). currentTime-based matching would
      // scramble them; desiredTime-based matching must keep el_i on its own slot.
      const el0 = makeVideoEl(5.5, "http://test/a.mp4"); el0._state.desiredTime = 2;
      const el1 = makeVideoEl(1.5, "http://test/a.mp4"); el1._state.desiredTime = 4;
      const el2 = makeVideoEl(3.5, "http://test/a.mp4"); el2._state.desiredTime = 6;
      const free: FreePool = new Map([["http://test/a.mp4", [el0, el1, el2]]]);
      const durations = new Map([["http://test/a.mp4", 10]]);
      const needed = [
        makeNeededVideo("http://test/a.mp4", 2),
        makeNeededVideo("http://test/a.mp4", 4),
        makeNeededVideo("http://test/a.mp4", 6),
      ];
      const result = matchSources(needed, free, durations, FRAME_DT);
      // Each needed slot should get the element whose desiredTime matches it.
      expect((result[0].el as VideoEl)._state.desiredTime).toBe(2);
      expect((result[1].el as VideoEl)._state.desiredTime).toBe(4);
      expect((result[2].el as VideoEl)._state.desiredTime).toBe(6);
    });

    it("falls back to currentTime when desiredTime is unset (cold pool element)", () => {
      // No desiredTime → behaves exactly like before: nearest predicted currentTime wins.
      const elFar = makeVideoEl(1.0, "http://test/a.mp4");
      const elClose = makeVideoEl(7.9, "http://test/a.mp4");
      const free: FreePool = new Map([["http://test/a.mp4", [elFar, elClose]]]);
      const durations = new Map([["http://test/a.mp4", 10]]);
      const needed = [makeNeededVideo("http://test/a.mp4", 8)];
      const result = matchSources(needed, free, durations, FRAME_DT);
      expect(result[0].el).toBe(elClose);
    });

    it("falls back to currentTime when a seek has landed (desiredTime ≈ currentTime)", () => {
      // desiredTime set but the element has reached it → settled → match on actual position.
      const elA = makeVideoEl(2.0, "http://test/a.mp4"); elA._state.desiredTime = 2.0;
      const elB = makeVideoEl(8.0, "http://test/a.mp4"); elB._state.desiredTime = 8.0;
      const free: FreePool = new Map([["http://test/a.mp4", [elA, elB]]]);
      const durations = new Map([["http://test/a.mp4", 10]]);
      const needed = [makeNeededVideo("http://test/a.mp4", 8)];
      const result = matchSources(needed, free, durations, FRAME_DT);
      expect(result[0].el).toBe(elB);
    });
  });

  describe("minimum-seek assignment (wrap cascade)", () => {
    // At a loop wrap, two playheads keep tracking their slots (no seek) while one wraps to
    // loopStart (must seek). Greedy, processing the wrapped slot first, would grab the closest
    // tracking element and shove everyone down (3 seeks). The seek-penalty optimum keeps the two
    // tracking elements in place and seeks only the wrapping one.
    it("keeps tracking elements put and seeks only the wrapping one", () => {
      const src = "http://test/a.mp4";
      // Two elements tracking slots 3.90 / 4.20 (currentTime ≈ slot → noSeek), one at 4.90 whose
      // slot has wrapped to 1.90 (far from any current position → must seek).
      const elA = makeVideoEl(3.90, src); elA._state.desiredTime = 3.90;
      const elB = makeVideoEl(4.20, src); elB._state.desiredTime = 4.20;
      const elC = makeVideoEl(4.90, src); elC._state.desiredTime = 4.90;
      const free: FreePool = new Map([[src, [elA, elB, elC]]]);
      const durations = new Map([[src, 10]]);
      // Wrapped slot processed FIRST — the order that makes greedy cascade.
      const needed = [
        makeNeededVideo(src, 1.90),
        makeNeededVideo(src, 3.90),
        makeNeededVideo(src, 4.20),
      ];
      const result = matchSources(needed, free, durations, 0);
      const bySlot = new Map(result.map(a => [a.needed.expectedTime, a.el as VideoEl]));
      // Tracking elements stay on their own slots; the wrapping element takes loopStart.
      expect(bySlot.get(3.90)).toBe(elA);
      expect(bySlot.get(4.20)).toBe(elB);
      expect(bySlot.get(1.90)).toBe(elC);
    });
  });

  describe("minimum-seek assignment (surplus free elements)", () => {
    // With more elements than slots (e.g. surplus free elements from a shrunk pattern, kept by the
    // reservoir + parked near slots by prewarm), a committed element that is still seeking toward
    // its slot must NOT be evicted by a free element that coincidentally sits near that slot.
    // Continuing toward your own committed slot is not a NEW seek, so it must not cost SEEK_PENALTY.
    it("keeps committed (mid-seek) elements on their slots; surplus free ones don't steal them", () => {
      const src = "http://test/a.mp4";
      // Four active elements committed to slots 2/4/6/8 but stranded mid-seek (currentTime far).
      const a2 = makeVideoEl(9.0, src); a2._state.desiredTime = 2;
      const a4 = makeVideoEl(1.0, src); a4._state.desiredTime = 4;
      const a6 = makeVideoEl(3.0, src); a6._state.desiredTime = 6;
      const a8 = makeVideoEl(5.0, src); a8._state.desiredTime = 8;
      // Four surplus FREE elements parked just beside the slots (within drift → noSeek), no commit.
      const f2 = makeVideoEl(2.1, src);
      const f4 = makeVideoEl(4.1, src);
      const f6 = makeVideoEl(6.1, src);
      const f8 = makeVideoEl(8.1, src);
      // Renderer prepends previously-active elements, so actives come first.
      const free: FreePool = new Map([[src, [a2, a4, a6, a8, f2, f4, f6, f8]]]);
      const durations = new Map([[src, 10]]);
      const needed = [
        makeNeededVideo(src, 2), makeNeededVideo(src, 4),
        makeNeededVideo(src, 6), makeNeededVideo(src, 8),
      ];
      const result = matchSources(needed, free, durations, 0);
      const bySlot = new Map(result.map(a => [a.needed.expectedTime, a.el as VideoEl]));
      expect(bySlot.get(2)).toBe(a2);
      expect(bySlot.get(4)).toBe(a4);
      expect(bySlot.get(6)).toBe(a6);
      expect(bySlot.get(8)).toBe(a8);
    });
  });

  describe("forward prediction", () => {
    it("uses predicted time (currentTime + speed * frameDt) for scoring", () => {
      // Element at 4.9s, speed 1, frameDt=1s → predicted=5.9; target=6 → forward seek 0.1
      // Element at 7.0s, speed 1, frameDt=1s → predicted=8.0; target=6 → backward seek 2
      const elNear = makeVideoEl(4.9, "http://test/a.mp4");
      const elFar = makeVideoEl(7.0, "http://test/a.mp4");
      const free: FreePool = new Map([["http://test/a.mp4", [elNear, elFar]]]);
      const durations = new Map([["http://test/a.mp4", 10]]);
      // Use frameDt=1 to make prediction clearly visible
      const needed = [makeNeededVideo("http://test/a.mp4", 6, 1)];
      const result = matchSources(needed, free, durations, 1);
      // elNear predicts to 5.9 (forward 0.1 to 6) → better
      expect(result[0].el).toBe(elNear);
    });
  });
});

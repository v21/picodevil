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

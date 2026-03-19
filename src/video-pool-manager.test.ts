import { describe, it, expect } from "vitest";
import { createVideoPoolManager, type VideoPoolManager } from "./video-pool-manager";
import { createVideoState, type VideoEl } from "./video-element-state";

/** Mock VideoEl with event dispatch support. */
function createMockElement(): VideoEl & { _emit: (event: string) => void } {
  const listeners = new Map<string, Function[]>();
  const state = createVideoState();
  return {
    _state: state,
    currentTime: 0,
    duration: 10, // default finite duration
    paused: true,
    playbackRate: 1,
    loop: false,
    muted: false,
    playsInline: false,
    src: "",
    preload: "",
    videoWidth: 320,
    videoHeight: 240,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    load() {},
    removeAttribute(_name: string) {},
    addEventListener(event: string, cb: Function, _opts?: any) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    },
    _emit(event: string) {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  } as unknown as VideoEl & { _emit: (event: string) => void };
}

function createTestPool(overrides: Partial<Parameters<typeof createVideoPoolManager>[0]> = {}): VideoPoolManager {
  return createVideoPoolManager({
    createElement: () => createMockElement() as unknown as HTMLVideoElement,
    resolveMediaUrl: (name, base) => base + name,
    ...overrides,
  });
}

describe("VideoPoolManager", () => {
  describe("getVideoEl", () => {
    it("creates a new element when pool is empty", () => {
      const pool = createTestPool();
      const el = pool.getVideoEl("test.mp4", "/videos/", "s0:e0");
      expect(el).toBeDefined();
      expect(pool.videoPool.has("s0:e0")).toBe(true);
      expect(el._state.srcUrl).toBe("/videos/test.mp4");
    });

    it("returns cached element for same poolKey", () => {
      const pool = createTestPool();
      const el1 = pool.getVideoEl("test.mp4", "/videos/", "s0:e0");
      // calling again with same poolKey should return the same element
      expect(pool.videoPool.get("s0:e0")).toBe(el1);
    });

    it("reuses element from free pool when same srcUrl", () => {
      let createCount = 0;
      const pool = createTestPool({
        createElement: () => {
          createCount++;
          return createMockElement() as unknown as HTMLVideoElement;
        },
      });

      const el = pool.getVideoEl("test.mp4", "/videos/", "s0:e0");
      pool.freeVideoEl(el);
      pool.videoPool.delete("s0:e0");

      createCount = 0; // reset count
      const el2 = pool.getVideoEl("test.mp4", "/videos/", "s0:e1");
      expect(createCount).toBe(0); // should reuse, not create
      expect(el2).toBe(el); // same element
    });

    it("creates new element when free pool has different src", () => {
      let createCount = 0;
      const pool = createTestPool({
        createElement: () => {
          createCount++;
          return createMockElement() as unknown as HTMLVideoElement;
        },
      });

      const el = pool.getVideoEl("a.mp4", "/videos/", "s0:e0");
      pool.freeVideoEl(el);
      pool.videoPool.delete("s0:e0");

      createCount = 0;
      pool.getVideoEl("b.mp4", "/videos/", "s0:e1");
      expect(createCount).toBe(1); // had to create new
    });

    it("prefers free element closest to targetTime", () => {
      const pool = createTestPool();

      // Create and free two elements with different currentTime
      const el1 = pool.getVideoEl("test.mp4", "/videos/", "k1");
      (el1 as any).currentTime = 2.0;
      pool.freeVideoEl(el1);
      pool.videoPool.delete("k1");

      const el2 = pool.getVideoEl("test.mp4", "/videos/", "k2");
      (el2 as any).currentTime = 8.0;
      pool.freeVideoEl(el2);
      pool.videoPool.delete("k2");

      // Request element targeting time 7.5 — should prefer el2 (at 8.0)
      const result = pool.getVideoEl("test.mp4", "/videos/", "k3", 7.5);
      expect(result).toBe(el2);
    });

    it("resets video state when reusing from free pool", () => {
      const pool = createTestPool();
      const el = pool.getVideoEl("test.mp4", "/videos/", "s0:e0");
      el._state.lastEventBegin = 5;
      el._state.lastExpected = 3.0;

      pool.freeVideoEl(el);
      pool.videoPool.delete("s0:e0");

      pool.getVideoEl("test.mp4", "/videos/", "s0:e1");
      expect(el._state.lastEventBegin).toBeUndefined();
      expect(el._state.lastExpected).toBeUndefined();
    });
  });

  describe("freeVideoEl", () => {
    it("moves element to free pool", () => {
      const pool = createTestPool();
      const el = pool.getVideoEl("test.mp4", "/videos/", "s0:e0");
      pool.freeVideoEl(el);
      const freeList = pool.freeVideoPool.get("/videos/test.mp4");
      expect(freeList).toContain(el);
    });

    it("destroys element when per-src cap exceeded", () => {
      const pool = createTestPool({ maxFreePerSrc: 1 });
      const el1 = pool.getVideoEl("test.mp4", "/videos/", "k1");
      const el2 = pool.getVideoEl("test.mp4", "/videos/", "k2");
      pool.freeVideoEl(el1);
      pool.videoPool.delete("k1");
      pool.freeVideoEl(el2);
      pool.videoPool.delete("k2");
      // Only 1 should survive in free pool
      const freeList = pool.freeVideoPool.get("/videos/test.mp4") ?? [];
      expect(freeList.length).toBe(1);
    });

    it("pauses the element", () => {
      const pool = createTestPool();
      const el = pool.getVideoEl("test.mp4", "/videos/", "s0:e0");
      (el as any).paused = false;
      pool.freeVideoEl(el);
      expect((el as any).paused).toBe(true);
    });
  });

  describe("trimFreePool", () => {
    it("evicts when total exceeds cap", () => {
      const pool = createTestPool({ maxFreePerSrc: 4, maxFreeTotal: 3 });

      // Create 4 elements with different srcs, free them all
      for (let i = 0; i < 4; i++) {
        const el = pool.getVideoEl(`v${i}.mp4`, "/", `k${i}`);
        pool.freeVideoEl(el);
        pool.videoPool.delete(`k${i}`);
      }

      let total = 0;
      for (const list of pool.freeVideoPool.values()) total += list.length;
      expect(total).toBeLessThanOrEqual(3);
    });
  });

  describe("clearVideos", () => {
    it("moves all active elements to free pool", () => {
      const pool = createTestPool();
      pool.getVideoEl("a.mp4", "/", "k1");
      pool.getVideoEl("b.mp4", "/", "k2");
      expect(pool.videoPool.size).toBe(2);

      pool.clearVideos();
      expect(pool.videoPool.size).toBe(0);
      // Elements should be in free pool
      let total = 0;
      for (const list of pool.freeVideoPool.values()) total += list.length;
      expect(total).toBeGreaterThan(0);
    });
  });

  describe("makeVideoEl", () => {
    it("uses injected createElement", () => {
      let called = false;
      const pool = createTestPool({
        createElement: () => {
          called = true;
          return createMockElement() as unknown as HTMLVideoElement;
        },
      });
      pool.makeVideoEl("test.mp4");
      expect(called).toBe(true);
    });

    it("attaches _state via createVideoState", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("test.mp4");
      expect(el._state).toBeDefined();
      expect(el._state.seeking).toBe(false);
      expect(el._state.srcUrl).toBeUndefined();
    });

    it("sets loop=false, muted=true, playsInline=true", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("test.mp4");
      expect(el.loop).toBe(false);
      expect(el.muted).toBe(true);
      expect(el.playsInline).toBe(true);
    });
  });

  describe("duration discovery", () => {
    it("calls onDurationDiscovered when loadedmetadata fires", () => {
      const discovered: [string, number][] = [];
      const pool = createTestPool({
        onDurationDiscovered: (url, dur) => discovered.push([url, dur]),
      });
      const el = pool.makeVideoEl("test.mp4") as any;
      el._state.srcUrl = "/videos/test.mp4";
      (el as any).duration = 5.5;
      el._emit("loadedmetadata");
      expect(discovered).toEqual([["/videos/test.mp4", 5.5]]);
      expect(pool.videoDurations.get("/videos/test.mp4")).toBe(5.5);
    });
  });

  describe("blob cache eviction", () => {
    it("evicts oldest blob URLs when cache exceeds maxBlobEntries", () => {
      const pool = createTestPool({ maxBlobEntries: 3 });

      pool.videoBlobUrls.set("url1", "blob:1");
      pool.videoBlobUrls.set("url2", "blob:2");
      pool.videoBlobUrls.set("url3", "blob:3");
      pool.videoBlobUrls.set("url4", "blob:4");

      pool.evictOldestBlobs();
      expect(pool.videoBlobUrls.size).toBe(3);
      // Oldest (url1) should be evicted
      expect(pool.videoBlobUrls.has("url1")).toBe(false);
      expect(pool.videoBlobUrls.has("url2")).toBe(true);
      expect(pool.videoBlobUrls.has("url3")).toBe(true);
      expect(pool.videoBlobUrls.has("url4")).toBe(true);
    });

    it("evicts multiple entries to get under cap", () => {
      const pool = createTestPool({ maxBlobEntries: 2 });

      pool.videoBlobUrls.set("a", "blob:a");
      pool.videoBlobUrls.set("b", "blob:b");
      pool.videoBlobUrls.set("c", "blob:c");
      pool.videoBlobUrls.set("d", "blob:d");
      pool.videoBlobUrls.set("e", "blob:e");

      pool.evictOldestBlobs();
      expect(pool.videoBlobUrls.size).toBe(2);
      // Only newest two survive
      expect(pool.videoBlobUrls.has("d")).toBe(true);
      expect(pool.videoBlobUrls.has("e")).toBe(true);
    });

    it("does nothing when under cap", () => {
      const pool = createTestPool({ maxBlobEntries: 5 });
      pool.videoBlobUrls.set("x", "blob:x");
      pool.evictOldestBlobs();
      expect(pool.videoBlobUrls.size).toBe(1);
    });

    it("getVideoEl prefers blob URL when available", () => {
      const pool = createTestPool({ maxBlobEntries: 5 });
      pool.videoBlobUrls.set("/test.mp4", "blob:cached");
      const el = pool.getVideoEl("test.mp4", "/", "k1");
      expect((el as any).src).toBe("blob:cached");
    });
  });
});

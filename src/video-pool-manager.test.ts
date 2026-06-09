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
  describe("takeFromFreePool", () => {
    it("returns null when pool is empty", () => {
      const pool = createTestPool();
      expect(pool.takeFromFreePool("/videos/test.mp4")).toBeNull();
    });

    it("returns element when one is free", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("test.mp4");
      el._state.srcUrl = "/videos/test.mp4";
      pool.freeVideoEl(el);
      const result = pool.takeFromFreePool("/videos/test.mp4");
      expect(result).toBe(el);
    });

    it("returns null for different srcUrl", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("a.mp4");
      el._state.srcUrl = "/videos/a.mp4";
      pool.freeVideoEl(el);
      expect(pool.takeFromFreePool("/videos/b.mp4")).toBeNull();
    });

    it("prefers element closest to targetTime", () => {
      const pool = createTestPool();

      const el1 = pool.makeVideoEl("test.mp4");
      el1._state.srcUrl = "/videos/test.mp4";
      (el1 as any).currentTime = 2.0;
      pool.freeVideoEl(el1);

      const el2 = pool.makeVideoEl("test.mp4");
      el2._state.srcUrl = "/videos/test.mp4";
      (el2 as any).currentTime = 8.0;
      pool.freeVideoEl(el2);

      // Request element targeting time 7.5 — should prefer el2 (at 8.0)
      const result = pool.takeFromFreePool("/videos/test.mp4", 7.5);
      expect(result).toBe(el2);
    });

    it("resets video state on take", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("test.mp4");
      el._state.srcUrl = "/videos/test.mp4";
      el._state.lastEventBegin = 5;
      el._state.lastExpected = 3.0;
      pool.freeVideoEl(el);

      pool.takeFromFreePool("/videos/test.mp4");
      expect(el._state.lastEventBegin).toBeUndefined();
      expect(el._state.lastExpected).toBeUndefined();
    });

    it("removes src from free pool map when last element taken", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("test.mp4");
      el._state.srcUrl = "/videos/test.mp4";
      pool.freeVideoEl(el);
      pool.takeFromFreePool("/videos/test.mp4");
      expect(pool.freeVideoPool.has("/videos/test.mp4")).toBe(false);
    });
  });

  describe("freeVideoEl", () => {
    it("moves element to free pool", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("test.mp4");
      el._state.srcUrl = "/videos/test.mp4";
      pool.freeVideoEl(el);
      const freeList = pool.freeVideoPool.get("/videos/test.mp4");
      expect(freeList).toContain(el);
    });

    it("accumulates multiple elements for the same src (no per-src cap)", () => {
      const pool = createTestPool({ maxFreeTotal: 100 });
      const el1 = pool.makeVideoEl("test.mp4");
      el1._state.srcUrl = "/videos/test.mp4";
      const el2 = pool.makeVideoEl("test.mp4");
      el2._state.srcUrl = "/videos/test.mp4";
      pool.freeVideoEl(el1);
      pool.freeVideoEl(el2);
      const freeList = pool.freeVideoPool.get("/videos/test.mp4") ?? [];
      expect(freeList.length).toBe(2);
    });

    it("pauses the element", () => {
      const pool = createTestPool();
      const el = pool.makeVideoEl("test.mp4");
      el._state.srcUrl = "/videos/test.mp4";
      (el as any).paused = false;
      pool.freeVideoEl(el);
      expect((el as any).paused).toBe(true);
    });
  });

  describe("trimFreePool", () => {
    it("evicts when total exceeds cap", () => {
      const pool = createTestPool({ maxFreeTotal: 3 });

      for (let i = 0; i < 4; i++) {
        const el = pool.makeVideoEl(`v${i}.mp4`);
        el._state.srcUrl = `/v${i}.mp4`;
        pool.freeVideoEl(el);
      }

      let total = 0;
      for (const list of pool.freeVideoPool.values()) total += list.length;
      expect(total).toBeLessThanOrEqual(3);
    });
  });

  describe("clearVideos", () => {
    it("moves all active elements to free pool", () => {
      const pool = createTestPool();
      const el1 = pool.makeVideoEl("a.mp4");
      el1._state.srcUrl = "/a.mp4";
      const el2 = pool.makeVideoEl("b.mp4");
      el2._state.srcUrl = "/b.mp4";
      const active = [el1, el2];

      pool.clearVideos(active);

      let total = 0;
      for (const list of pool.freeVideoPool.values()) total += list.length;
      expect(total).toBe(2);
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

});

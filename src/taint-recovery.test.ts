import { describe, it, expect, beforeEach } from "vitest";
import {
  isTaintError,
  cacheBustUrl,
  decideCure,
  appendToRing,
  buildTaintRecord,
  recoverFromDrawError,
  readTaintLog,
  clearTaintLog,
  TAINT_LOG_MAX,
  type TaintRecord,
} from "./taint-recovery";

const NOW = "2026-06-04T00:00:00.000Z";

/** A fake tainted video element with only the fields the recovery reads/writes. */
function fakeVideoEl(srcUrl: string, src: string) {
  return {
    _state: { srcUrl },
    src,
    currentSrc: src,
    crossOrigin: "anonymous",
    readyState: 4,
    networkState: 1,
    videoWidth: 640,
    videoHeight: 480,
    error: null,
  };
}

function videoParams(el: object) {
  return { source: { kind: "video", el } } as any;
}

const TAINT = (() => {
  const e = new Error("The video element contains cross-origin data, and may not be loaded.");
  e.name = "SecurityError";
  return e;
})();

describe("taint-recovery: isTaintError", () => {
  it("recognises a SecurityError", () => {
    expect(isTaintError(TAINT)).toBe(true);
  });
  it("recognises a cross-origin message even without the name", () => {
    expect(isTaintError(new Error("contains cross-origin data"))).toBe(true);
    expect(isTaintError(new Error("tainted canvases may not be exported"))).toBe(true);
  });
  it("ignores unrelated errors and non-errors", () => {
    expect(isTaintError(new Error("something else"))).toBe(false);
    expect(isTaintError(null)).toBe(false);
    expect(isTaintError("oops")).toBe(false);
  });
});

describe("taint-recovery: cacheBustUrl", () => {
  it("adds ?pdcb when no query exists", () => {
    expect(cacheBustUrl("https://cdn/x.mp4", 3)).toBe("https://cdn/x.mp4?pdcb=3");
  });
  it("adds &pdcb when a query already exists", () => {
    expect(cacheBustUrl("https://cdn/x.mp4?a=1", 7)).toBe("https://cdn/x.mp4?a=1&pdcb=7");
  });
});

describe("taint-recovery: decideCure", () => {
  it("cache-busts the source url", () => {
    expect(decideCure("https://cdn/u.mp4", 5)).toEqual({
      newSrc: "https://cdn/u.mp4?pdcb=5",
      action: "cured-cachebust",
    });
  });
  it("appends to an existing query", () => {
    expect(decideCure("https://cdn/u.mp4?a=1", 2)).toEqual({
      newSrc: "https://cdn/u.mp4?a=1&pdcb=2",
      action: "cured-cachebust",
    });
  });
  it("cannot cure without a srcUrl", () => {
    expect(decideCure(undefined, 1)).toEqual({ action: "no-cure" });
  });
});

describe("taint-recovery: appendToRing", () => {
  const rec = (i: number) => ({ time: String(i) } as TaintRecord);
  it("keeps only the most recent `max` records", () => {
    let ring: TaintRecord[] = [];
    for (let i = 0; i < TAINT_LOG_MAX + 10; i++) ring = appendToRing(ring, rec(i), TAINT_LOG_MAX);
    expect(ring).toHaveLength(TAINT_LOG_MAX);
    expect(ring[ring.length - 1].time).toBe(String(TAINT_LOG_MAX + 9)); // newest last
    expect(ring[0].time).toBe(String(10));
  });
});

describe("taint-recovery: buildTaintRecord", () => {
  it("captures element + tile diagnostics", () => {
    const el = fakeVideoEl("https://cdn/clip.mp4", "https://cdn/clip.mp4");
    const rec = buildTaintRecord(videoParams(el), { screenIndex: 2, eventIndex: 0 } as any, TAINT, NOW, "cured-cachebust");
    expect(rec).toMatchObject({
      time: NOW,
      kind: "video",
      errorName: "SecurityError",
      screenIndex: 2,
      eventIndex: 0,
      srcUrl: "https://cdn/clip.mp4",
      host: "cdn",
      crossOrigin: "anonymous",
      readyState: 4,
      videoWidth: 640,
      action: "cured-cachebust",
    });
  });
});

describe("taint-recovery: recoverFromDrawError", () => {
  beforeEach(() => clearTaintLog());

  it("returns false and does nothing for non-taint errors", () => {
    const el = fakeVideoEl("u1", "u1");
    const before = el.src;
    expect(recoverFromDrawError(new Error("plain"), videoParams(el), undefined, NOW)).toBe(false);
    expect(el.src).toBe(before);
    expect(readTaintLog()).toHaveLength(0);
  });

  it("cache-busts the element and persists a record", () => {
    const el = fakeVideoEl("https://cdn/u2.mp4", "https://cdn/u2.mp4");
    expect(recoverFromDrawError(TAINT, videoParams(el), undefined, NOW)).toBe(true);
    expect(el.src).toMatch(/^https:\/\/cdn\/u2\.mp4\?pdcb=\d+$/);
    const log = readTaintLog();
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("cured-cachebust");
    expect(log[0].srcUrl).toBe("https://cdn/u2.mp4");
  });

  it("acts once per element+src (no reload storm / no flood)", () => {
    const el = fakeVideoEl("https://cdn/u4.mp4", "https://cdn/u4.mp4");
    recoverFromDrawError(TAINT, videoParams(el), undefined, NOW);
    const afterFirst = el.src;
    // Subsequent taints for the same element+src are no-ops (deduped).
    recoverFromDrawError(TAINT, videoParams(el), undefined, NOW);
    recoverFromDrawError(TAINT, videoParams(el), undefined, NOW);
    expect(el.src).toBe(afterFirst);
    expect(readTaintLog()).toHaveLength(1);
  });
});

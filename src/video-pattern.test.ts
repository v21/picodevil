import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { VideoPattern } from "./video-pattern";
import { resolveTime, type TimeValue } from "./time-value";

function vp(src: string) {
  return VideoPattern.fromSrc(mini(src), mini);
}

/** Resolve a TimeValue to seconds given a video duration. */
function resolve(tv: TimeValue, dur: number): number {
  return resolveTime(tv, dur);
}

/** Resolve end, accounting for endIsDuration. */
function resolveEnd(v: { start: TimeValue; end: TimeValue; endIsDuration: boolean }, dur: number): number {
  const endSec = resolve(v.end, dur);
  return v.endIsDuration ? resolve(v.start, dur) + endSec : endSec;
}

describe("VideoPattern", () => {
  it("returns src and default speed", () => {
    const evs = vp("a.mp4").queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.src).toBe("a.mp4");
    expect(evs[0].value.speed).toBe(1);
  });

  it("speed() overrides default", () => {
    const evs = vp("a.mp4").speed("2").queryArc(0, 1);
    expect(evs[0].value.speed).toBe(2);
  });

  it("speed pattern aligns with src pattern", () => {
    const p = vp("a.mp4 b.mp4").speed("1 2");
    const first = p.queryArc(0, 0.001);
    const second = p.queryArc(0.5, 0.501);
    expect(first[0].value.src).toBe("a.mp4");
    expect(first[0].value.speed).toBe(1);
    expect(second[0].value.src).toBe("b.mp4");
    expect(second[0].value.speed).toBe(2);
  });

  it("chaining is immutable", () => {
    const p1 = vp("a.mp4");
    const p2 = p1.speed("3");
    expect(p1.queryArc(0, 1)[0].value.speed).toBe(1);
    expect(p2.queryArc(0, 1)[0].value.speed).toBe(3);
  });

  it("chaining speed twice uses latest", () => {
    const evs = vp("a.mp4").speed("2").speed("5").queryArc(0, 1);
    expect(evs[0].value.speed).toBe(5);
  });

  it("multiple src events in one cycle", () => {
    const evs = vp("a.mp4 b.mp4 c.mp4").queryArc(0, 1);
    expect(evs).toHaveLength(3);
    expect(evs.map(e => e.value.src)).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
  });

  it("mini subdivision works for speed", () => {
    const p = vp("a.mp4").speed("[1 2] 3");
    const evs = p.queryArc(0, 0.001);
    expect(evs[0].value.speed).toBe(1);
  });

  it("two videos with three speeds: every point in cycle has a valid src", () => {
    const p = vp("a.mp4 b.mp4").speed("0.5 1 -1");
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const evs = p.queryArc(t, t + 0.001);
      expect(evs.length).toBeGreaterThanOrEqual(1);
      expect(evs[0].value.src).toMatch(/\.mp4$/);
    }
  });

  it("two videos: src alternates across the cycle", () => {
    const p = vp("a.mp4 b.mp4").speed("0.5 1 -1");
    const first = p.queryArc(0, 0.001);
    const second = p.queryArc(0.5, 0.501);
    expect(first[0].value.src).toBe("a.mp4");
    expect(second[0].value.src).toBe("b.mp4");
  });

  it("pre-probe queryArc(0,1) returns all unique sources", () => {
    const srcPattern = mini("a.mp4 b.mp4");
    const probe = srcPattern.queryArc(0, 1);
    const srcs = probe.map(ev => ev.value);
    expect(srcs).toContain("a.mp4");
    expect(srcs).toContain("b.mp4");
  });

  it("queryArc at exact video boundary returns an event", () => {
    const p = vp("a.mp4 b.mp4");
    const evs = p.queryArc(0.5, 0.501);
    expect(evs.length).toBeGreaterThanOrEqual(1);
    expect(evs[0].value.src).toBe("b.mp4");
  });

  it("all srcs from queryArc match those from probe", () => {
    const srcPattern = mini("a.mp4 b.mp4");
    const pool = new Set(srcPattern.queryArc(0, 1).map(ev => ev.value));
    const p = VideoPattern.fromSrc(srcPattern, mini).speed("0.5 1 -1");
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const evs = p.queryArc(t, t + 0.001);
      for (const ev of evs) {
        expect(pool.has(ev.value.src)).toBe(true);
      }
    }
  });

  // --- start/end with relative (duration-relative) values ---
  const DUR = 30; // fake video duration for resolving

  it("defaults: start=0rel, end=1rel", () => {
    const v = vp("a.mp4").queryArc(0, 1)[0].value;
    expect(resolve(v.start, DUR)).toBe(0);
    expect(resolveEnd(v, DUR)).toBe(DUR); // 1 * 30
  });

  it("start() with bare number is relative to duration", () => {
    const v = vp("a.mp4").start("0.5").queryArc(0, 1)[0].value;
    expect(resolve(v.start, DUR)).toBe(15); // 0.5 * 30
  });

  it("start/end with seconds suffix", () => {
    const v = vp("a.mp4").start("5s").end("10s").queryArc(0, 1)[0].value;
    expect(resolve(v.start, DUR)).toBe(5);
    expect(resolveEnd(v, DUR)).toBe(10);
  });

  it("start/end with milliseconds suffix", () => {
    const v = vp("a.mp4").start("500ms").end("1500ms").queryArc(0, 1)[0].value;
    expect(resolve(v.start, DUR)).toBe(0.5);
    expect(resolveEnd(v, DUR)).toBe(1.5);
  });

  it("mixed units in pattern", () => {
    // 3 values split cycle into thirds: [0, 1/3), [1/3, 2/3), [2/3, 1)
    const p = vp("a.mp4").start("5s 500ms 0.5");
    const at0 = p.queryArc(0, 0.001)[0].value;
    const at1 = p.queryArc(1/3 + 0.001, 1/3 + 0.002)[0].value;
    const at2 = p.queryArc(2/3 + 0.001, 2/3 + 0.002)[0].value;
    expect(resolve(at0.start, DUR)).toBe(5);      // 5s
    expect(resolve(at1.start, DUR)).toBe(0.5);    // 500ms
    expect(resolve(at2.start, DUR)).toBe(15);      // 0.5 * 30
  });

  it("sec and millis suffixes work", () => {
    const v = vp("a.mp4").start("3sec").end("1500millis").queryArc(0, 1)[0].value;
    expect(resolve(v.start, DUR)).toBe(3);
    expect(resolveEnd(v, DUR)).toBe(1.5);
  });

  it("start/end with speed", () => {
    const v = vp("a.mp4").start("2s").end("8s").speed("-1").queryArc(0, 1)[0].value;
    expect(resolve(v.start, DUR)).toBe(2);
    expect(resolveEnd(v, DUR)).toBe(8);
    expect(v.speed).toBe(-1);
  });

  it("start/end patterns vary across cycle", () => {
    const p = vp("a.mp4").start("0s 5s").end("10s 20s");
    const first = p.queryArc(0, 0.001)[0].value;
    const second = p.queryArc(0.5, 0.501)[0].value;
    expect(resolve(first.start, DUR)).toBe(0);
    expect(resolveEnd(first, DUR)).toBe(10);
    expect(resolve(second.start, DUR)).toBe(5);
    expect(resolveEnd(second, DUR)).toBe(20);
  });

  it("start/end patterns with two videos", () => {
    const p = vp("a.mp4 b.mp4").start("1s 2s").end("5s 10s");
    const first = p.queryArc(0, 0.001)[0].value;
    const second = p.queryArc(0.5, 0.501)[0].value;
    expect(first.src).toBe("a.mp4");
    expect(resolve(first.start, DUR)).toBe(1);
    expect(resolveEnd(first, DUR)).toBe(5);
    expect(second.src).toBe("b.mp4");
    expect(resolve(second.start, DUR)).toBe(2);
    expect(resolveEnd(second, DUR)).toBe(10);
  });

  it("three speeds with start/end: every point has valid values", () => {
    const p = vp("a.mp4 b.mp4").speed("0.5 1 -1").start("5s").end("15s");
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const evs = p.queryArc(t, t + 0.001);
      expect(evs.length).toBeGreaterThanOrEqual(1);
      const v = evs[0].value;
      expect(v.src).toMatch(/\.mp4$/);
      expect(resolve(v.start, DUR)).toBe(5);
      expect(resolveEnd(v, DUR)).toBe(15);
      expect(typeof v.speed).toBe("number");
    }
  });

  it("start/end chaining is immutable", () => {
    const p1 = vp("a.mp4");
    const p2 = p1.start("5s").end("10s");
    const v1 = p1.queryArc(0, 1)[0].value;
    const v2 = p2.queryArc(0, 1)[0].value;
    expect(resolve(v1.start, DUR)).toBe(0);
    expect(resolveEnd(v1, DUR)).toBe(DUR);
    expect(resolve(v2.start, DUR)).toBe(5);
    expect(resolveEnd(v2, DUR)).toBe(10);
  });

  it("mini subdivision works for start/end", () => {
    const p = vp("a.mp4").start("[1s 2s] 3s").end("[10s 20s] 30s");
    const v = p.queryArc(0, 0.001)[0].value;
    expect(resolve(v.start, DUR)).toBe(1);
    expect(resolveEnd(v, DUR)).toBe(10);
  });

  // --- duration ---

  it("duration() with seconds", () => {
    const v = vp("a.mp4").start("5s").duration("10s").queryArc(0, 1)[0].value;
    expect(v.endIsDuration).toBe(true);
    expect(resolve(v.start, DUR)).toBe(5);
    expect(resolveEnd(v, DUR)).toBe(15); // 5 + 10
  });

  it("duration() with default start", () => {
    const v = vp("a.mp4").duration("10s").queryArc(0, 1)[0].value;
    expect(resolveEnd(v, DUR)).toBe(10); // 0 + 10
  });

  it("duration() with relative values", () => {
    const v = vp("a.mp4").start("0.5").duration("0.25").queryArc(0, 1)[0].value;
    // start = 0.5 * 30 = 15, dur = 0.25 * 30 = 7.5, end = 22.5
    expect(resolveEnd(v, DUR)).toBe(22.5);
  });

  it("duration() pattern varies with start pattern", () => {
    const p = vp("a.mp4").start("0s 5s").duration("10s");
    const first = p.queryArc(0, 0.001)[0].value;
    const second = p.queryArc(0.5, 0.501)[0].value;
    expect(resolveEnd(first, DUR)).toBe(10);  // 0 + 10
    expect(resolveEnd(second, DUR)).toBe(15); // 5 + 10
  });

  it("duration() mixed units with start", () => {
    const v = vp("a.mp4").start("5s").duration("500ms").queryArc(0, 1)[0].value;
    expect(resolveEnd(v, DUR)).toBe(5.5); // 5 + 0.5
  });

  it("end() after duration() uses absolute end", () => {
    const v = vp("a.mp4").start("5s").duration("10s").end("20s").queryArc(0, 1)[0].value;
    expect(v.endIsDuration).toBe(false);
    expect(resolveEnd(v, DUR)).toBe(20);
  });

  it("duration() after end() uses relative duration", () => {
    const v = vp("a.mp4").start("5s").end("20s").duration("3s").queryArc(0, 1)[0].value;
    expect(v.endIsDuration).toBe(true);
    expect(resolveEnd(v, DUR)).toBe(8); // 5 + 3
  });

  it("duration() chaining is immutable", () => {
    const p1 = vp("a.mp4").start("5s");
    const p2 = p1.duration("10s");
    const p3 = p1.end("30s");
    expect(resolveEnd(p2.queryArc(0, 1)[0].value, DUR)).toBe(15); // 5+10
    expect(resolveEnd(p3.queryArc(0, 1)[0].value, DUR)).toBe(30); // absolute
  });

  // --- parse-time validation ---

  it("throws on invalid time value at chain time", () => {
    expect(() => vp("a.mp4").start("bad")).toThrow(/Invalid/);
  });

  it("throws on invalid end value at chain time", () => {
    expect(() => vp("a.mp4").end("nope")).toThrow(/Invalid/);
  });

  it("accepts negative values", () => {
    const v = vp("a.mp4").start("-1s").queryArc(0, 1)[0].value;
    expect(resolve(v.start, DUR)).toBe(-1);
  });

  // --- fit mode ---

  it("fit() defaults to cover", () => {
    expect(vp("a.mp4").fitMode).toBe("cover");
  });

  it("fit() sets mode", () => {
    expect(vp("a.mp4").fit("contain").fitMode).toBe("contain");
    expect(vp("a.mp4").fit("fill").fitMode).toBe("fill");
    expect(vp("a.mp4").fit("none").fitMode).toBe("none");
  });

  it("fit() chaining is immutable", () => {
    const p1 = vp("a.mp4");
    const p2 = p1.fit("contain");
    expect(p1.fitMode).toBe("cover");
    expect(p2.fitMode).toBe("contain");
  });

  it("fit() preserves speed and start/end", () => {
    const p = vp("a.mp4").speed("2").start("5s").fit("none");
    const v = p.queryArc(0, 1)[0].value;
    expect(v.speed).toBe(2);
    expect(resolve(v.start, DUR)).toBe(5);
    expect(p.fitMode).toBe("none");
  });

  // --- alpha ---

  it("alpha() merges into events", () => {
    const evs = vp("a.mp4").alpha("0.5").queryArc(0, 1);
    expect(evs[0].value.alpha).toBe(0.5);
  });

  it("alpha() chaining is immutable", () => {
    const p1 = vp("a.mp4");
    const p2 = p1.alpha("0.5");
    expect(p1.queryArc(0, 1)[0].value.alpha).toBeUndefined();
    expect(p2.queryArc(0, 1)[0].value.alpha).toBe(0.5);
  });

  it("alpha() preserves speed and fit", () => {
    const p = vp("a.mp4").speed("2").fit("contain").alpha("0.5");
    expect(p.queryArc(0, 1)[0].value.speed).toBe(2);
    expect(p.fitMode).toBe("contain");
    expect(p.queryArc(0, 1)[0].value.alpha).toBe(0.5);
  });
});

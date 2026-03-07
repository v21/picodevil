import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { VideoPattern } from "./video-pattern";

function vp(src: string) {
  return new VideoPattern(mini(src), {}, mini);
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

  // tests for the two-video switching bug
  it("two videos with three speeds: every point in cycle has a valid src", () => {
    const p = vp("a.mp4 b.mp4").speed("0.5 1 -1");
    // sample 20 points across the cycle
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
    // right at the boundary between a and b
    const evs = p.queryArc(0.5, 0.501);
    expect(evs.length).toBeGreaterThanOrEqual(1);
    expect(evs[0].value.src).toBe("b.mp4");
  });

  it("all srcs from queryArc match those from probe", () => {
    // simulates what video() + render loop does
    const srcPattern = mini("a.mp4 b.mp4");
    const pool = new Set(srcPattern.queryArc(0, 1).map(ev => ev.value));
    const p = new VideoPattern(srcPattern, {}, mini).speed("0.5 1 -1");
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const evs = p.queryArc(t, t + 0.001);
      for (const ev of evs) {
        expect(pool.has(ev.value.src)).toBe(true);
      }
    }
  });

  // --- start/end props ---

  it("defaults: start=0, end=Infinity", () => {
    const evs = vp("a.mp4").queryArc(0, 1);
    expect(evs[0].value.start).toBe(0);
    expect(evs[0].value.end).toBe(Infinity);
  });

  it("start() sets start prop", () => {
    const evs = vp("a.mp4").start("5").queryArc(0, 1);
    expect(evs[0].value.start).toBe(5);
    expect(evs[0].value.end).toBe(Infinity);
  });

  it("end() sets end prop", () => {
    const evs = vp("a.mp4").end("10").queryArc(0, 1);
    expect(evs[0].value.start).toBe(0);
    expect(evs[0].value.end).toBe(10);
  });

  it("start and end together", () => {
    const evs = vp("a.mp4").start("5").end("10").queryArc(0, 1);
    expect(evs[0].value.start).toBe(5);
    expect(evs[0].value.end).toBe(10);
  });

  it("start/end with speed", () => {
    const evs = vp("a.mp4").start("2").end("8").speed("-1").queryArc(0, 1);
    expect(evs[0].value.start).toBe(2);
    expect(evs[0].value.end).toBe(8);
    expect(evs[0].value.speed).toBe(-1);
  });

  it("start/end patterns vary across cycle", () => {
    const p = vp("a.mp4").start("0 5").end("10 20");
    const first = p.queryArc(0, 0.001);
    const second = p.queryArc(0.5, 0.501);
    expect(first[0].value.start).toBe(0);
    expect(first[0].value.end).toBe(10);
    expect(second[0].value.start).toBe(5);
    expect(second[0].value.end).toBe(20);
  });

  it("start/end patterns with two videos", () => {
    const p = vp("a.mp4 b.mp4").start("1 2").end("5 10");
    const first = p.queryArc(0, 0.001);
    const second = p.queryArc(0.5, 0.501);
    expect(first[0].value.src).toBe("a.mp4");
    expect(first[0].value.start).toBe(1);
    expect(first[0].value.end).toBe(5);
    expect(second[0].value.src).toBe("b.mp4");
    expect(second[0].value.start).toBe(2);
    expect(second[0].value.end).toBe(10);
  });

  it("three speeds with start/end: every point has valid values", () => {
    const p = vp("a.mp4 b.mp4").speed("0.5 1 -1").start("5").end("15");
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const evs = p.queryArc(t, t + 0.001);
      expect(evs.length).toBeGreaterThanOrEqual(1);
      const v = evs[0].value;
      expect(v.src).toMatch(/\.mp4$/);
      expect(v.start).toBe(5);
      expect(v.end).toBe(15);
      expect(typeof v.speed).toBe("number");
    }
  });

  it("start/end chaining is immutable", () => {
    const p1 = vp("a.mp4");
    const p2 = p1.start("5").end("10");
    expect(p1.queryArc(0, 1)[0].value.start).toBe(0);
    expect(p1.queryArc(0, 1)[0].value.end).toBe(Infinity);
    expect(p2.queryArc(0, 1)[0].value.start).toBe(5);
    expect(p2.queryArc(0, 1)[0].value.end).toBe(10);
  });

  it("mini subdivision works for start/end", () => {
    const p = vp("a.mp4").start("[1 2] 3").end("[10 20] 30");
    const evs = p.queryArc(0, 0.001);
    expect(evs[0].value.start).toBe(1);
    expect(evs[0].value.end).toBe(10);
  });

  // --- duration ---

  it("duration() sets end = start + duration", () => {
    const evs = vp("a.mp4").start("5").duration("10").queryArc(0, 1);
    expect(evs[0].value.start).toBe(5);
    expect(evs[0].value.end).toBe(15);
  });

  it("duration() with default start", () => {
    const evs = vp("a.mp4").duration("10").queryArc(0, 1);
    expect(evs[0].value.start).toBe(0);
    expect(evs[0].value.end).toBe(10);
  });

  it("duration() pattern varies with start pattern", () => {
    const p = vp("a.mp4").start("0 5").duration("10");
    const first = p.queryArc(0, 0.001);
    const second = p.queryArc(0.5, 0.501);
    expect(first[0].value.end).toBe(10);  // 0 + 10
    expect(second[0].value.end).toBe(15); // 5 + 10
  });

  it("duration() pattern varies independently", () => {
    const p = vp("a.mp4").start("0 1").duration("10 20 30");
    // cycle: start=[0, 1], dur=[10, 20, 30]
    // at t=0: start=0, dur=10 → end=10
    const at0 = p.queryArc(0, 0.001);
    expect(at0[0].value.start).toBe(0);
    expect(at0[0].value.end).toBe(10);
    // at t=0.5: start=1, dur=20 → end=21
    const at05 = p.queryArc(0.5, 0.501);
    expect(at05[0].value.start).toBe(1);
    expect(at05[0].value.end).toBe(21);
  });

  it("end() after duration() uses absolute end", () => {
    const evs = vp("a.mp4").start("5").duration("10").end("20").queryArc(0, 1);
    expect(evs[0].value.end).toBe(20); // absolute, not 5+20
  });

  it("duration() after end() uses relative duration", () => {
    const evs = vp("a.mp4").start("5").end("20").duration("3").queryArc(0, 1);
    expect(evs[0].value.end).toBe(8); // 5+3
  });

  it("duration() chaining is immutable", () => {
    const p1 = vp("a.mp4").start("5");
    const p2 = p1.duration("10");
    const p3 = p1.end("30");
    expect(p2.queryArc(0, 1)[0].value.end).toBe(15); // 5+10
    expect(p3.queryArc(0, 1)[0].value.end).toBe(30); // absolute
  });
});

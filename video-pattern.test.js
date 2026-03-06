import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { VideoPattern } from "./video-pattern.js";

function vp(src) {
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
});

import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { video } from "./video-pattern";
import "./visual-controls";

describe("video()", () => {
  it("returns src events with _type", () => {
    const evs = video("a.mp4").queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.src).toBe("a.mp4");
    expect(evs[0].value._type).toBe("video");
  });

  it("multiple src events in one cycle", () => {
    const evs = video("a.mp4 b.mp4 c.mp4").queryArc(0, 1);
    expect(evs).toHaveLength(3);
    expect(evs.map((e: any) => e.value.src)).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
  });

  it("speed() merges into events", () => {
    const evs = video("a.mp4").speed(2).queryArc(0, 1);
    expect(evs[0].value.speed).toBe(2);
  });

  it("speed pattern aligns with src", () => {
    const p = video("a.mp4 b.mp4").speed(mini("1 2"));
    const first = p.queryArc(0, 0.001);
    const second = p.queryArc(0.5, 0.501);
    expect(first[0].value.src).toBe("a.mp4");
    expect(first[0].value.speed).toBe(1);
    expect(second[0].value.src).toBe("b.mp4");
    expect(second[0].value.speed).toBe(2);
  });

  it("chaining is immutable", () => {
    const p1 = video("a.mp4");
    const p2 = p1.speed(3);
    expect(p1.queryArc(0, 1)[0].value.speed).toBeUndefined();
    expect(p2.queryArc(0, 1)[0].value.speed).toBe(3);
  });

  it("start() merges into events", () => {
    const evs = video("a.mp4").start("5s").queryArc(0, 1);
    expect(evs[0].value.start).toBe("5s");
  });

  it("end() merges into events", () => {
    const evs = video("a.mp4").end("10s").queryArc(0, 1);
    expect(evs[0].value.end).toBe("10s");
  });

  it("duration() sets end and endIsDuration flag", () => {
    const evs = video("a.mp4").duration("10s").queryArc(0, 1);
    expect(evs[0].value.end).toBe("10s");
    expect(evs[0].value.endIsDuration).toBe(true);
  });

  it("end() after duration() clears endIsDuration", () => {
    const evs = video("a.mp4").duration("10s").end("20s").queryArc(0, 1);
    expect(evs[0].value.end).toBe("20s");
    expect(evs[0].value.endIsDuration).toBe(false);
  });

  it("scrub() sets start and duration(0)", () => {
    const evs = video("a.mp4").scrub("5s").queryArc(0, 1);
    expect(evs[0].value.start).toBe("5s");
    expect(evs[0].value.end).toBe(0);
    expect(evs[0].value.endIsDuration).toBe(true);
  });

  it("sync() defaults to 0", () => {
    const evs = video("a.mp4").sync().queryArc(0, 1);
    expect(evs[0].value.sync).toBe(0);
  });

  it("sync() accepts a value", () => {
    const evs = video("a.mp4").sync(5).queryArc(0, 1);
    expect(evs[0].value.sync).toBe(5);
  });

  it("urlBase() merges into events", () => {
    const evs = video("a.mp4").urlBase("https://x.com/").queryArc(0, 1);
    expect(evs[0].value.urlBase).toBe("https://x.com/");
  });

  it("alpha() merges into events", () => {
    const evs = video("a.mp4").alpha(0.5).queryArc(0, 1);
    expect(evs[0].value.alpha).toBe(0.5);
  });

  it("fit() merges into events", () => {
    const evs = video("a.mp4").fit("contain").queryArc(0, 1);
    expect(evs[0].value.fit).toBe("contain");
  });

  it("bakes _onset into each event value", () => {
    // _onset must survive set.mix (appBoth) calls like .speed() so that
    // eventBeginFromHap returns the original event onset rather than the
    // clipped hap.whole.begin after the intersection.
    const evs = video("a.mp4").queryArc(0, 0.001);
    expect(evs[0].value._onset).toBe(0);

    // video("a.mp4/5") spans 5 cycles — onset stays 0 across all cycles
    const slow = video("a.mp4").slow(5);
    expect(slow.queryArc(0, 0.001)[0].value._onset).toBe(0);
    expect(slow.queryArc(1, 1.001)[0].value._onset).toBe(0);
    expect(slow.queryArc(4, 4.001)[0].value._onset).toBe(0);
  });

  it("_onset survives .speed() (appBoth whole-clipping)", () => {
    // .speed(2) uses appBoth which intersects whole spans, clipping to per-cycle.
    // _onset in the value must still reflect the original event onset.
    const slow = video("a.mp4").slow(5).speed(2);
    // At cycle 1, appBoth would produce whole=[1,2], but _onset should still be 0
    expect(slow.queryArc(1, 1.001)[0].value._onset).toBe(0);
    expect(slow.queryArc(3, 3.001)[0].value._onset).toBe(0);
  });

  it("chaining preserves all controls", () => {
    const evs = video("a.mp4").speed(2).start("5s").end("10s").alpha(0.5).queryArc(0, 1);
    const v = evs[0].value;
    expect(v._type).toBe("video");
    expect(v.src).toBe("a.mp4");
    expect(v.speed).toBe(2);
    expect(v.start).toBe("5s");
    expect(v.end).toBe("10s");
    expect(v.alpha).toBe(0.5);
  });
});

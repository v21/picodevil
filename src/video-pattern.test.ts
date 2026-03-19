import { describe, it, expect, beforeEach } from "vitest";
import { mini } from "@strudel/mini";
import { sine } from "@strudel/core";
import { video } from "./video-pattern";
import "./visual-controls";
import "./pattern-extensions";
import { addMedia, updateEntry, clearAll } from "./media-registry";
import { setRuntimeCps } from "./config";

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
    const first = p.queryArc(0, 0);
    const second = p.queryArc(0.5, 0.5);
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

  it("begin() merges into events", () => {
    const evs = video("a.mp4").begin(0.5).queryArc(0, 1);
    expect(evs[0].value.begin).toBe(0.5);
  });

  it("end() merges into events", () => {
    const evs = video("a.mp4").end(0.8).queryArc(0, 1);
    expect(evs[0].value.end).toBe(0.8);
  });

  it("duration() computes end from begin + value", () => {
    const evs = video("a.mp4").begin(0.2).duration(0.3).queryArc(0, 1);
    expect(evs[0].value.begin).toBe(0.2);
    expect(evs[0].value.end).toBeCloseTo(0.5);
  });

  it("end() after duration() overrides computed end", () => {
    const evs = video("a.mp4").duration(0.3).end(0.8).queryArc(0, 1);
    expect(evs[0].value.end).toBe(0.8);
  });

  it("scrub() freezes at position within default 0-1 range", () => {
    const evs = video("a.mp4").scrub(0.5).queryArc(0, 1);
    expect(evs[0].value.begin).toBeCloseTo(0.5);
    expect(evs[0].value.end).toBeCloseTo(0.5);
  });

  it("scrub() interpolates within existing begin/end range", () => {
    const evs = video("a.mp4").begin(0.2).end(0.8).scrub(0.5).queryArc(0, 1);
    // 0.5 of the 0.2–0.8 range = 0.2 + 0.5 * 0.6 = 0.5
    expect(evs[0].value.begin).toBeCloseTo(0.5);
    expect(evs[0].value.end).toBeCloseTo(0.5);
  });

  it("scrub(0) within begin/end goes to begin", () => {
    const evs = video("a.mp4").begin(0.2).end(0.8).scrub(0).queryArc(0, 1);
    expect(evs[0].value.begin).toBeCloseTo(0.2);
    expect(evs[0].value.end).toBeCloseTo(0.2);
  });

  it("scrub(1) within begin/end goes to end", () => {
    const evs = video("a.mp4").begin(0.2).end(0.8).scrub(1).queryArc(0, 1);
    expect(evs[0].value.begin).toBeCloseTo(0.8);
    expect(evs[0].value.end).toBeCloseTo(0.8);
  });


  it("sync() defaults to true (boolean flag)", () => {
    const evs = video("a.mp4").sync().queryArc(0, 1);
    expect(evs[0].value.sync).toBe(true);
  });

  it("sync() accepts a phase offset (fraction of video duration)", () => {
    const evs = video("a.mp4").sync(0.3).queryArc(0, 1);
    expect(evs[0].value.sync).toBe(0.3);
  });

  it("urlBase() merges into events", () => {
    const evs = video("a.mp4").urlBase("https://x.com/").queryArc(0, 1);
    expect(evs[0].value.urlBase).toBe("https://x.com/");
  });

  it("alpha() merges into events", () => {
    const evs = video("a.mp4").alpha(0.5).queryArc(0, 1);
    expect(evs[0].value.alpha).toBe(0.5);
  });

  it("objectfit() merges into events", () => {
    const evs = video("a.mp4").objectfit("contain").queryArc(0, 1);
    expect(evs[0].value.objectfit).toBe("contain");
  });

  it("fit() with args warns about objectfit", () => {
    // fit("contain") should warn, not silently set objectfit
    const evs = video("a.mp4").fit("contain").queryArc(0, 1);
    expect(evs[0].value.objectfit).toBeUndefined();
    expect(evs[0].value._type).toBe("video");
  });

  it("does not bake _onset into event values", () => {
    const evs = video("a.mp4").queryArc(0, 0);
    expect(evs[0].value._onset).toBeUndefined();
  });

  it("chaining preserves all controls", () => {
    const evs = video("a.mp4").speed(2).begin(0.2).end(0.8).alpha(0.5).queryArc(0, 1);
    const v = evs[0].value;
    expect(v._type).toBe("video");
    expect(v.src).toBe("a.mp4");
    expect(v.speed).toBe(2);
    expect(v.begin).toBe(0.2);
    expect(v.end).toBe(0.8);
    expect(v.alpha).toBe(0.5);
  });
});

describe("chop integration", () => {
  it("chop(4) produces 4 sub-events with correct begin/end", () => {
    const evs = video("a.mp4").chop(4).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    // Each slice should have begin and end spanning 1/4 of the video
    const sorted = [...evs].sort((a: any, b: any) => Number(a.part.begin) - Number(b.part.begin));
    expect(sorted[0].value.begin).toBeCloseTo(0);
    expect(sorted[0].value.end).toBeCloseTo(0.25);
    expect(sorted[1].value.begin).toBeCloseTo(0.25);
    expect(sorted[1].value.end).toBeCloseTo(0.5);
    expect(sorted[2].value.begin).toBeCloseTo(0.5);
    expect(sorted[2].value.end).toBeCloseTo(0.75);
    expect(sorted[3].value.begin).toBeCloseTo(0.75);
    expect(sorted[3].value.end).toBeCloseTo(1);
  });

  it("chop(4) does not stamp _chopOnset on sub-events", () => {
    const evs = video("a.mp4").chop(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value._chopOnset).toBeUndefined();
    }
  });

  it("chop(8).rev() reverses temporal order but preserves begin/end", () => {
    const evs = video("a.mp4").chop(8).rev().queryArc(0, 1);
    expect(evs).toHaveLength(8);
    const sorted = [...evs].sort((a: any, b: any) => Number(a.part.begin) - Number(b.part.begin));
    // First temporal event (0-1/8 of cycle) should have the LAST slice's begin/end
    expect(sorted[0].value.begin).toBeCloseTo(0.875);
    expect(sorted[0].value.end).toBeCloseTo(1.0);
    // Last temporal event should have the first slice's begin/end
    expect(sorted[7].value.begin).toBeCloseTo(0);
    expect(sorted[7].value.end).toBeCloseTo(0.125);
  });


  it("begin(0.2).end(0.8).chop(4) composes correctly", () => {
    const evs = video("a.mp4").begin(0.2).end(0.8).chop(4).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    const sorted = [...evs].sort((a: any, b: any) => Number(a.part.begin) - Number(b.part.begin));
    // Slices should be within the 0.2-0.8 range
    expect(sorted[0].value.begin).toBeCloseTo(0.2);
    expect(sorted[0].value.end).toBeCloseTo(0.35);
    expect(sorted[1].value.begin).toBeCloseTo(0.35);
    expect(sorted[1].value.end).toBeCloseTo(0.5);
    expect(sorted[2].value.begin).toBeCloseTo(0.5);
    expect(sorted[2].value.end).toBeCloseTo(0.65);
    expect(sorted[3].value.begin).toBeCloseTo(0.65);
    expect(sorted[3].value.end).toBeCloseTo(0.8);
  });

  it("chop(4).chop(2) is equivalent to chop(8)", () => {
    const double = video("a.mp4").chop(4).chop(2).queryArc(0, 1);
    const single = video("a.mp4").chop(8).queryArc(0, 1);
    expect(double).toHaveLength(8);
    const dSorted = [...double].sort((a: any, b: any) => a.value.begin - b.value.begin);
    const sSorted = [...single].sort((a: any, b: any) => a.value.begin - b.value.begin);
    for (let i = 0; i < 8; i++) {
      expect(dSorted[i].value.begin).toBeCloseTo(sSorted[i].value.begin, 5);
      expect(dSorted[i].value.end).toBeCloseTo(sSorted[i].value.end, 5);
    }
  });

  it("chop preserves _type and src on sub-events", () => {
    const evs = video("a.mp4").chop(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value._type).toBe("video");
      expect(ev.value.src).toBe("a.mp4");
    }
  });

  it("chop + controls: alpha survives chop", () => {
    const evs = video("a.mp4").chop(4).alpha(0.5).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    for (const ev of evs) {
      expect(ev.value.alpha).toBe(0.5);
    }
  });
});

describe("slice integration", () => {
  it("slice(8, pat) produces events with correct begin/end", () => {
    const evs = video("a.mp4").slice(8, mini("0 3 5 7")).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    const sorted = [...evs].sort((a: any, b: any) => Number(a.part.begin) - Number(b.part.begin));
    expect(sorted[0].value.begin).toBeCloseTo(0);       // slice 0
    expect(sorted[0].value.end).toBeCloseTo(0.125);
    expect(sorted[1].value.begin).toBeCloseTo(3 / 8);   // slice 3
    expect(sorted[1].value.end).toBeCloseTo(4 / 8);
    expect(sorted[2].value.begin).toBeCloseTo(5 / 8);   // slice 5
    expect(sorted[2].value.end).toBeCloseTo(6 / 8);
    expect(sorted[3].value.begin).toBeCloseTo(7 / 8);   // slice 7
    expect(sorted[3].value.end).toBeCloseTo(1);
  });

  it("slice preserves _type on video events", () => {
    const evs = video("a.mp4").slice(4, mini("0 1 2 3")).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value._type).toBe("video");
    }
  });

  it("slice accepts raw number and string args (reify)", () => {
    // This is the exact call pattern that caused "t.innerBind is not a function"
    const evs = video("a.mp4").slice(8, mini("0 3 5 7")).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    expect(evs[0].value.begin).toBeDefined();
  });

  it("begin(0.2).end(0.8).slice(4, ...) composes within region", () => {
    const evs = video("a.mp4").begin(0.2).end(0.8).slice(4, mini("0 1 2 3")).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    const sorted = [...evs].sort((a: any, b: any) => Number(a.part.begin) - Number(b.part.begin));
    // 4 slices within 0.2-0.8 range (d=0.6, each slice = 0.15)
    expect(sorted[0].value.begin).toBeCloseTo(0.2);
    expect(sorted[0].value.end).toBeCloseTo(0.35);
    expect(sorted[1].value.begin).toBeCloseTo(0.35);
    expect(sorted[1].value.end).toBeCloseTo(0.5);
    expect(sorted[2].value.begin).toBeCloseTo(0.5);
    expect(sorted[2].value.end).toBeCloseTo(0.65);
    expect(sorted[3].value.begin).toBeCloseTo(0.65);
    expect(sorted[3].value.end).toBeCloseTo(0.8);
  });
});

describe("splice integration", () => {
  it("splice(8, pat) produces events with begin/end", () => {
    const evs = video("a.mp4").splice(8, mini("0 3 5 7")).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    for (const ev of evs) {
      expect(ev.value.begin).toBeDefined();
      expect(ev.value.end).toBeDefined();
    }
  });

  it("splice preserves _type on video events", () => {
    const evs = video("a.mp4").splice(4, mini("0 1 2 3")).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value._type).toBe("video");
    }
  });

  it("splice uses video duration for speed when known", () => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: 10, type: "video" });
    setRuntimeCps(0.5);
    // splice(4, "0 1 2 3"): 4 events each 0.25 cycles, each slice = 1/4 of video
    // speed = sliceDur * videoDur * cps / wholeDur = 0.25 * 10 * 0.5 / 0.25 = 5
    const evs = video("test.mp4").splice(4, mini("0 1 2 3")).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    for (const ev of evs) {
      expect(ev.value.speed).toBeCloseTo(5);
    }
  });

  it("splice falls back to Strudel formula when duration unknown", () => {
    clearAll();
    const evs = video("unknown.mp4").splice(4, mini("0 1 2 3")).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    // Strudel formula: 1 / (4 * 0.25) = 1
    for (const ev of evs) {
      expect(ev.value.speed).toBeCloseTo(1);
    }
  });

});

describe("revv integration", () => {
  it("revv() is available on Pattern.prototype", () => {
    const pat = video("a.mp4");
    expect(typeof pat.revv).toBe("function");
  });

  it("revv() reverses global order of chop slices", () => {
    // chop(4) produces 4 sub-events with begin 0, 0.25, 0.5, 0.75
    // revv() reverses which content plays at which time
    const normal = video("a.mp4").chop(4).queryArc(0, 1);
    const reversed = video("a.mp4").chop(4).revv().queryArc(0, 1);
    // Sort both by temporal position (whole.begin)
    const normalByTime = [...normal].sort((a: any, b: any) => Number(a.whole.begin) - Number(b.whole.begin));
    const reversedByTime = [...reversed].sort((a: any, b: any) => Number(a.whole.begin) - Number(b.whole.begin));
    // The content (begin values) should be in reversed order relative to normal
    const normalContent = normalByTime.map((e: any) => e.value.begin);
    const reversedContent = reversedByTime.map((e: any) => e.value.begin);
    expect(reversedContent).toEqual([...normalContent].reverse());
  });
});

describe("striate integration", () => {
  it("striate(4) preserves _type on video events", () => {
    const evs = video("a.mp4").striate(4).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    for (const ev of evs) {
      expect(ev.value._type).toBe("video");
      expect(ev.value.begin).toBeDefined();
      expect(ev.value.end).toBeDefined();
    }
  });
});

describe("fit()", () => {
  beforeEach(() => {
    clearAll();
    // Register a 10-second video
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: 10, type: "video" });
    setRuntimeCps(0.5);
  });

  it("adjusts speed so video fills one cycle", () => {
    // 1 cycle at 0.5 cps = 2 seconds. 10s video needs speed = 10 * 0.5 / 1 = 5
    const evs = video("test.mp4").fit().queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.speed).toBeCloseTo(5);
  });

  it("adjusts speed for slowed pattern", () => {
    // .slow(2): event spans 2 cycles = 4 seconds. speed = 10 * 0.5 / 2 = 2.5
    const evs = video("test.mp4").slow(2).fit().queryArc(0, 2);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.speed).toBeCloseTo(2.5);
  });

  it("accounts for begin/end slice", () => {
    // begin=0.2, end=0.8 → sliceDur=0.6. speed = 0.6 * 10 * 0.5 / 1 = 3
    const evs = video("test.mp4").begin(0.2).end(0.8).fit().queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.speed).toBeCloseTo(3);
  });

  it("slow(8).begin(.4).end(.8).fit() fills 8 cycles with 40% slice", () => {
    // Event spans 8 cycles (whole=0-8). sliceDur=0.4. speed = 0.4 * 10 * 0.5 / 8 = 0.25
    const evs = video("test.mp4").slow(8).begin(0.4).end(0.8).fit().queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.begin).toBeCloseTo(0.4);
    expect(evs[0].value.end).toBeCloseTo(0.8);
    expect(evs[0].value.speed).toBeCloseTo(0.25);
  });

  it("is a no-op when duration is unknown", () => {
    clearAll();
    addMedia("unknown.mp4", "unknown.mp4");
    // No duration set
    const evs = video("unknown.mp4").fit().queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.speed).toBeUndefined();
  });

  it("responds to cps changes", () => {
    setRuntimeCps(1);
    // 1 cycle at 1 cps = 1 second. speed = 10 * 1 / 1 = 10
    const evs = video("test.mp4").fit().queryArc(0, 1);
    expect(evs[0].value.speed).toBeCloseTo(10);
  });
});

describe("loopAt()", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: 10, type: "video" });
    setRuntimeCps(0.5);
  });

  it("slows pattern and adjusts speed for n cycles", () => {
    // loopAt(4): slowed by 4, speed = 10 * 0.5 / 4 = 1.25
    const evs = video("test.mp4").loopAt(4).queryArc(0, 4);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.speed).toBeCloseTo(1.25);
    // Event should span 4 cycles
    expect(Number(evs[0].whole.end) - Number(evs[0].whole.begin)).toBeCloseTo(4);
  });

  it("accounts for begin/end slice", () => {
    // begin=0.5, end=1 → sliceDur=0.5. speed = 0.5 * 10 * 0.5 / 2 = 1.25
    const evs = video("test.mp4").begin(0.5).end(1).loopAt(2).queryArc(0, 2);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.speed).toBeCloseTo(1.25);
  });

  it("is a no-op for speed when duration is unknown", () => {
    clearAll();
    addMedia("unknown.mp4", "unknown.mp4");
    const evs = video("unknown.mp4").loopAt(2).queryArc(0, 2);
    expect(evs).toHaveLength(1);
    // Still slowed (event spans 2 cycles) but no speed adjustment
    expect(Number(evs[0].whole.end) - Number(evs[0].whole.begin)).toBeCloseTo(2);
    expect(evs[0].value.speed).toBeUndefined();
  });

  it("loopat is an alias for loopAt", () => {
    const evs = video("test.mp4").loopat(4).queryArc(0, 4);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.speed).toBeCloseTo(1.25);
  });
});

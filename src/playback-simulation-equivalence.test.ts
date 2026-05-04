/**
 * Equivalence class tests, addTo/*To operator tests, and mapOn smoothing tests.
 * These run in a separate file so they execute in parallel with the trace
 * invariant files.
 *
 * Basic/sync/rolling cases    → playback-simulation.test.ts
 * Adversarial cases           → playback-simulation-adversarial.test.ts
 */
import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { video } from "./video-pattern";
import { screen } from "./screen-pattern";
import {
  evalPattern, simulateTrace, assertTracesMatch,
  setupSimulation, DUR,
} from "./playback-simulation-helpers";

describe("equivalence class testing", () => {
  setupSimulation();

  it("fit() ≡ fit().alpha(0.5): alpha doesn't change position", () => {
    const base = evalPattern('video("test.mp4").slow(2).begin(.4).end(.8).fit()');
    const withAlpha = evalPattern('video("test.mp4").slow(2).begin(.4).end(.8).fit().alpha(0.5)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withAlpha, 4, DUR), "fit() vs fit().alpha(0.5)");
  });

  it("chop(8) ≡ chop(8).alpha(0.5): alpha doesn't change chop positions", () => {
    const base = evalPattern('video("test.mp4").slow(2).chop(8)');
    const withAlpha = evalPattern('video("test.mp4").slow(2).chop(8).alpha(0.5)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withAlpha, 4, DUR), "chop(8) vs chop(8).alpha(0.5)");
  });

  it("speed(1) is identity for position", () => {
    const base = evalPattern('video("test.mp4").slow(2)');
    const withSpeed = evalPattern('video("test.mp4").slow(2).speed(1)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withSpeed, 4, DUR), "p vs p.speed(1)");
  });

  it("begin(0).end(1) is identity for position", () => {
    const base = evalPattern('video("test.mp4").slow(2)');
    const withBeginEnd = evalPattern('video("test.mp4").slow(2).begin(0).end(1)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withBeginEnd, 4, DUR), "p vs p.begin(0).end(1)");
  });

  it("chop(N).chop(M) ≡ chop(N*M) for begin/end values", () => {
    const double = evalPattern('video("test.mp4").chop(4).chop(2)');
    const single = evalPattern('video("test.mp4").chop(8)');
    assertTracesMatch(simulateTrace(double, 2, DUR), simulateTrace(single, 2, DUR), "chop(4).chop(2) vs chop(8)");
  });

  it("sync() ≡ sync().alpha(0.5): alpha doesn't change position", () => {
    const base = evalPattern('video("test.mp4").sync()');
    const withAlpha = evalPattern('video("test.mp4").sync().alpha(0.5)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withAlpha, 4, DUR), "sync() vs sync().alpha(0.5)");
  });

  it("sync().speed(1) ≡ sync(): speed(1) is identity in sync mode", () => {
    const base = evalPattern('video("test.mp4").sync()');
    const withSpeed = evalPattern('video("test.mp4").sync().speed(1)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withSpeed, 4, DUR), "sync() vs sync().speed(1)");
  });

  it("sync().begin(0).end(1) ≡ sync(): default range is identity", () => {
    const base = evalPattern('video("test.mp4").sync()');
    const withRange = evalPattern('video("test.mp4").sync().begin(0).end(1)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withRange, 4, DUR), "sync() vs sync().begin(0).end(1)");
  });

  it("sync().scale(2) ≡ sync(): scale doesn't affect playback position", () => {
    const base = evalPattern('video("test.mp4").sync()');
    const withScale = evalPattern('video("test.mp4").sync().scale(2)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withScale, 4, DUR), "sync() vs sync().scale(2)");
  });

  it("sync().blend('multiply') ≡ sync(): blend doesn't affect position", () => {
    const base = evalPattern('video("test.mp4").sync()');
    // single-quoted 'multiply' passes through as a literal string (no mini wrapping)
    const withBlend = evalPattern("video('test.mp4').sync().blend('multiply')");
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withBlend, 4, DUR), "sync() vs sync().blend('multiply')");
  });

  it("sync().slow(2) produces same positions as sync() (just longer events)", () => {
    // With sync, eventBegin is always 0. slow(2) just doubles event length,
    // but position depends only on elapsed time from cycle 0, not event span.
    const base = evalPattern('video("test.mp4").sync()');
    const withSlow = evalPattern('video("test.mp4").sync().slow(2)');
    assertTracesMatch(simulateTrace(base, 4, DUR), simulateTrace(withSlow, 4, DUR), "sync() vs sync().slow(2)");
  });

  it("loopAt(4) ≡ slow(4).fit(): same positions", () => {
    const looped = evalPattern('video("test.mp4").loopAt(4)');
    const manual = evalPattern('video("test.mp4").slow(4).fit()');
    assertTracesMatch(simulateTrace(looped, 8, DUR), simulateTrace(manual, 8, DUR), "loopAt(4) vs slow(4).fit()");
  });

  it("duration(0.25) ≡ begin(0).end(0.25): same range", () => {
    const withDur = evalPattern('video("test.mp4").duration(0.25)');
    const withBeginEnd = evalPattern('video("test.mp4").begin(0).end(0.25)');
    assertTracesMatch(simulateTrace(withDur, 4, DUR), simulateTrace(withBeginEnd, 4, DUR), "duration(0.25) vs begin(0).end(0.25)");
  });

  it("begin(.4).duration(.25) ≡ begin(.4).end(.65): same range", () => {
    const withDur = evalPattern('video("test.mp4").begin(.4).duration(.25)');
    const withEnd = evalPattern('video("test.mp4").begin(.4).end(.65)');
    assertTracesMatch(simulateTrace(withDur, 4, DUR), simulateTrace(withEnd, 4, DUR), "begin(.4).dur(.25) vs begin(.4).end(.65)");
  });

  it("loopAt(4).alpha(0.5) ≡ loopAt(4): alpha doesn't affect position", () => {
    const base = evalPattern('video("test.mp4").loopAt(4)');
    const withAlpha = evalPattern('video("test.mp4").loopAt(4).alpha(0.5)');
    assertTracesMatch(simulateTrace(base, 8, DUR), simulateTrace(withAlpha, 8, DUR), "loopAt(4) vs loopAt(4).alpha(0.5)");
  });
});

// ─── addTo position tests ────────────────────────────────────────────────────

function queryAt(pat: any, t: number) {
  const haps = pat.queryArc(t, t + 0.0001);
  return haps.length ? haps[0].value : undefined;
}

describe("addTo / *To operators affect rendered position", () => {
  it("addTo shifts x from base value", () => {
    const pat = (video("test.mp4") as any).x(0.5).addOn("x", 0.2);
    const v = queryAt(pat, 0.1);
    expect(v?.x).toBeCloseTo(0.7);
  });

  it("addTo with mini amount: 2-step x + 2-step amount = correct values at each half", () => {
    const pat = (video("test.mp4") as any).x(mini("0.2 0.8")).addOn("x", mini("0.1 -0.1"));
    expect(queryAt(pat, 0.1)?.x).toBeCloseTo(0.3);
    expect(queryAt(pat, 0.6)?.x).toBeCloseTo(0.7);
  });

  it("addTo preserves other value fields (src, etc.)", () => {
    const pat = (video("test.mp4") as any).x(0.5).addOn("x", 0.1);
    const v = queryAt(pat, 0.1);
    expect(v?.src).toBe("test.mp4");
    expect(v?.x).toBeCloseTo(0.6);
  });

  it("mulTo scales x from base value", () => {
    const pat = (video("test.mp4") as any).x(0.4).mulOn("x", 2);
    expect(queryAt(pat, 0.1)?.x).toBeCloseTo(0.8);
  });

  it("setTo replaces x regardless of base value", () => {
    const pat = (video("test.mp4") as any).x(0.4).setOn("x", 0.9);
    expect(queryAt(pat, 0.1)?.x).toBeCloseTo(0.9);
  });

  it("addTo x with mix: 2-step source + 3-step amount creates finer-grained events", () => {
    const pat = (video("test.mp4") as any).x(mini("0.2 0.8")).addOn("x", mini("0 .1 .2"));
    const evs = pat.queryArc(0, 1);
    expect(evs.length).toBeGreaterThan(2);
    for (const e of evs) expect(e.value?.x).toBeTypeOf("number");
  });
});

// ─── mapOn smoothing tests ───────────────────────────────────────────────────

describe("mapOn simulation: s().x().mapOn() smooths x across time", () => {
  function sampleX(pat: any, cycleOffset: number): number[] {
    const samples: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = cycleOffset + i / 20;
      const haps = pat.queryArc(t, t);
      const x = haps.length ? haps[0].value?.x : undefined;
      if (x !== undefined) samples.push(x);
    }
    return samples;
  }

  it("x values vary continuously within cycle 0", () => {
    const pat = (screen("red") as any).x(mini(".1 -.1")).mapOn("x", (xp: any) => xp.spline());
    const samples = sampleX(pat, 0);
    const unique = new Set(samples.map(v => Math.round(v * 1000)));
    expect(unique.size).toBeGreaterThan(2);
    expect(samples[5]).toBeGreaterThan(-0.1);
    expect(samples[5]).toBeLessThan(0.1);
  });

  it("x values vary continuously within cycle 10 (matches render loop absolute time)", () => {
    // The render loop runs at absolute cycle time (e.g. t=10.35), not t=0.35.
    // This was broken: fieldPat used src.query(state) which doesn't cycle-split,
    // returning no events for absolute-time spans.
    const pat = (screen("red") as any).x(mini(".1 -.1")).mapOn("x", (xp: any) => xp.spline());
    const samples = sampleX(pat, 10);
    const unique = new Set(samples.map(v => Math.round(v * 1000)));
    expect(unique.size).toBeGreaterThan(2);
    expect(samples[5]).toBeGreaterThan(-0.1);
    expect(samples[5]).toBeLessThan(0.1);
  });

  it("srcHaps is non-empty at absolute time in merge step", () => {
    const src = (screen("red") as any).x(mini(".1 -.1"));
    const hapsAt10 = src.queryArc(10.25, 10.25);
    expect(hapsAt10.length).toBeGreaterThan(0);
    expect(hapsAt10[0].value?.x).toBeDefined();
  });

  it("mapOn result matches direct spline application at absolute time", () => {
    // s("red").x(".1 -.1").mapOn("x", x=>x.spline()) should equal s("red").x(".1 -.1".spline())
    const viaMapOn = (screen("red") as any).x(mini(".1 -.1")).mapOn("x", (xp: any) => xp.spline());
    const direct   = (screen("red") as any).x(mini(".1 -.1").spline());
    for (const t of [10.1, 10.25, 10.4, 10.6, 10.75, 10.9]) {
      const mapOnX = viaMapOn.queryArc(t, t)[0]?.value?.x;
      const directX = direct.queryArc(t, t)[0]?.value?.x;
      expect(mapOnX).toBeCloseTo(directX, 3);
    }
  });
});

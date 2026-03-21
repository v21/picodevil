/**
 * Time-stepping simulation tests: step through pattern chains at frame granularity
 * and verify invariants on the resulting traces.
 *
 * These catch stateful interaction bugs that pure-function tests miss by simulating
 * the full render loop's query → eventBegin → expectedTime pipeline.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mini } from "@strudel/mini";
import { video } from "./video-pattern";
import { screen } from "./screen-pattern";
import { eventBeginFromHap } from "./event-begin";
import { computeExpectedTime, computeLoopLen } from "./video-playback";
import { computeSyncDistOffset } from "./sync-continuity";
import { addMedia, updateEntry, clearAll } from "./media-registry";
import { setRuntimeCps } from "./config";
import "./visual-controls";
import "./pattern-extensions";

const DUR = 10; // 10-second video
const CPS = 0.5;

interface TracePoint {
  cycle: number;
  eventBegin: number;
  expected: number;
  speed: number;
  loopStart: number;
  loopEnd: number;
}

/**
 * Step through a pattern at ~60fps, recording the playback trace.
 * Simulates element state tracking (syncDistOffset) to mirror the real
 * render loop's sync continuity behavior.
 */
function simulateTrace(pat: any, cycles: number, duration: number): TracePoint[] {
  const fps = 60;
  const trace: TracePoint[] = [];
  const dt = CPS / fps; // cycle increment per frame

  // Simulate per-element sync continuity state (mirrors video-playback.ts updateVideoPlayback)
  let lastSyncSpeed: number | undefined;
  let lastSyncBegin: number | undefined;
  let lastSyncEnd: number | undefined;
  let syncDistOffset = 0;
  let lastEventBegin: number | undefined;

  for (let cycle = 0; cycle < cycles; cycle += dt) {
    const haps = pat.queryArc(cycle, cycle + 0.0001);
    if (haps.length === 0) continue;

    const hap = haps[0];
    const ev = hap.value;
    const eventBegin = eventBeginFromHap(ev, hap, cycle);

    const speed = ev.speed != null ? Number(ev.speed) : 1;
    const beginVal = ev.begin ?? 0;
    const endVal = ev.end ?? 1;
    const loopStart = beginVal * duration;
    const loopEnd = endVal * duration;
    const loopLen = computeLoopLen(loopStart, loopEnd, duration);
    const synced = ev.sync != null;
    const syncOffset = synced && ev.sync !== true ? Number(ev.sync) * duration : 0;

    // Reset state on new event (mirrors updateVideoPlayback isNewEvent logic)
    if (lastEventBegin !== eventBegin) {
      lastEventBegin = eventBegin;
      lastSyncSpeed = undefined;
      lastSyncBegin = undefined;
      lastSyncEnd = undefined;
      syncDistOffset = 0;
    }

    // Sync continuity: recompute distOffset when speed/begin/end change
    if (synced && loopLen > 0) {
      const speedChanged = lastSyncSpeed != null && lastSyncSpeed !== speed;
      const beginChanged = lastSyncBegin != null && lastSyncBegin !== beginVal;
      const endChanged = lastSyncEnd != null && lastSyncEnd !== endVal;

      if (speedChanged || beginChanged || endChanged) {
        const elapsedSec = (cycle - eventBegin) / CPS;
        const oldBeginSec = (lastSyncBegin ?? beginVal) * duration;
        const oldEndSec = (lastSyncEnd ?? endVal) * duration;
        syncDistOffset = computeSyncDistOffset({
          elapsedSec,
          oldSpeed: lastSyncSpeed ?? speed,
          newSpeed: speed,
          oldBegin: oldBeginSec,
          newBegin: loopStart,
          oldEnd: oldEndSec,
          newEnd: loopEnd,
          oldLoopLen: computeLoopLen(oldBeginSec, oldEndSec, duration),
          newLoopLen: loopLen,
          syncOffset,
          oldDistOffset: syncDistOffset,
          duration,
        });
      }

      lastSyncSpeed = speed;
      lastSyncBegin = beginVal;
      lastSyncEnd = endVal;
    } else {
      lastSyncSpeed = undefined;
      lastSyncBegin = undefined;
      lastSyncEnd = undefined;
      syncDistOffset = 0;
    }

    const distOffset = synced ? syncDistOffset : 0;
    const expected = computeExpectedTime({
      currentCycle: cycle, eventBegin, cps: CPS,
      speed, loopStart, loopEnd, duration, syncOffset, distOffset,
    });

    trace.push({
      cycle,
      eventBegin,
      expected,
      speed,
      loopStart,
      loopEnd,
    });
  }

  return trace;
}

/** Verify trace invariants. */
function checkTraceInvariants(trace: TracePoint[], label: string) {
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    const loopLen = computeLoopLen(p.loopStart, p.loopEnd, DUR);

    // Invariant 1: no NaN/Infinity
    expect(p.expected, `${label} [${i}] expected is finite`).toSatisfy((v: number) => isFinite(v));
    expect(p.eventBegin, `${label} [${i}] eventBegin is finite`).toSatisfy((v: number) => isFinite(v));

    // Invariant 2: position in range (only for valid non-inverted ranges)
    if (p.loopEnd > p.loopStart) {
      expect(p.expected, `${label} [${i}] expected >= loopStart`).toBeGreaterThanOrEqual(p.loopStart - 1e-6);
      expect(p.expected, `${label} [${i}] expected <= loopEnd`).toBeLessThanOrEqual(p.loopEnd + 1e-6);
    } else if (p.loopStart > p.loopEnd && loopLen > 0) {
      // Inverted range: valid positions are [loopStart, duration) ∪ [0, loopEnd]
      const inUpperRange = p.expected >= p.loopStart - 1e-6;
      const inLowerRange = p.expected <= p.loopEnd + 1e-6;
      expect(inUpperRange || inLowerRange, `${label} [${i}] expected in inverted range: ${p.expected}`).toBe(true);
    }

    // Invariant 3: continuity (between consecutive frames in the same event)
    if (i > 0) {
      const prev = trace[i - 1];
      const sameEvent = Math.abs(p.eventBegin - prev.eventBegin) < 0.001;
      const sameLoop = Math.abs(p.loopStart - prev.loopStart) < 0.001
        && Math.abs(p.loopEnd - prev.loopEnd) < 0.001;

      if (sameEvent && sameLoop && loopLen > 0) {
        let delta: number;
        if (p.loopStart > p.loopEnd) {
          // Inverted range: convert to loop-space offsets and compute circular distance
          const toLoopOffset = (pos: number) => pos >= p.loopStart ? pos - p.loopStart : pos + (DUR - p.loopStart);
          const off1 = toLoopOffset(prev.expected);
          const off2 = toLoopOffset(p.expected);
          const rawOff = Math.abs(off2 - off1);
          delta = Math.min(rawOff, loopLen - rawOff);
        } else {
          const rawDelta = Math.abs(p.expected - prev.expected);
          delta = Math.min(rawDelta, Math.abs(rawDelta - loopLen));
        }
        const cycleDt = p.cycle - prev.cycle;
        // At speed-change boundaries, use the max of old and new speed
        // since the frame straddles both speeds
        const maxSpeed = Math.max(Math.abs(p.speed), Math.abs(prev.speed));
        const maxDelta = cycleDt * maxSpeed / CPS + 0.01;
        expect(delta, `${label} [${i}] continuity: delta=${delta.toFixed(4)} > max=${maxDelta.toFixed(4)}`).toBeLessThanOrEqual(maxDelta);
      }
    }
  }
}

describe("playback simulation", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    addMedia("other.mp4", "other.mp4");
    updateEntry("other.mp4", { duration: 8, type: "video" });
    setRuntimeCps(CPS);
  });

  const patterns: [string, () => any][] = [
    ["video(\"test.mp4\")", () => video("test.mp4")],
    ["video(\"test.mp4\").slow(4)", () => video("test.mp4").slow(4)],
    ["video(\"test.mp4\").slow(2).begin(.4).end(.8)", () => video("test.mp4").slow(2).begin(0.4).end(0.8)],
    ["video(\"test.mp4\").slow(2).begin(.4).end(.8).fit()", () => video("test.mp4").slow(2).begin(0.4).end(0.8).fit()],
    ["video(\"test.mp4\").slow(2).begin(.4).end(.8).fit().chop(8)", () => video("test.mp4").slow(2).begin(0.4).end(0.8).fit().chop(8)],
    ["video(\"test.mp4\").speed(2)", () => video("test.mp4").speed(2)],
    ["video(\"test.mp4\").speed(-1)", () => video("test.mp4").speed(-1)],
    ["video(\"test.mp4\").speed(0.5).slow(4)", () => video("test.mp4").speed(0.5).slow(4)],
    ["video(\"test.mp4\").chop(4)", () => video("test.mp4").chop(4)],
    ["video(\"test.mp4\").chop(4).speed(2)", () => video("test.mp4").chop(4).speed(2)],
    // Sync mode: basic
    ["video(\"test.mp4\").sync()", () => video("test.mp4").sync()],
    ["video(\"test.mp4\").sync().speed(2)", () => video("test.mp4").sync().speed(2)],
    ["video(\"test.mp4\").sync().speed(-1)", () => video("test.mp4").sync().speed(-1)],
    ["video(\"test.mp4\").sync().slow(4)", () => video("test.mp4").sync().slow(4)],
    ["video(\"test.mp4\").sync().begin(.2).end(.6)", () => video("test.mp4").sync().begin(0.2).end(0.6)],
    ["video(\"test.mp4\").sync(0.3)", () => video("test.mp4").sync(0.3)],
    ["video(\"test.mp4\").sync(0.5).speed(2)", () => video("test.mp4").sync(0.5).speed(2)],
    // Sync mode: operator combinations
    ['video("test.mp4").sync().speed(mini("1 2"))', () => video("test.mp4").sync().speed(mini("1 2"))],
    ["video(\"test.mp4\").slow(2).sync().fit()", () => video("test.mp4").slow(2).sync().fit()],
    ["video(\"test.mp4\").sync().chop(4)", () => video("test.mp4").sync().chop(4)],
    ["video(\"test.mp4\").sync().chop(4).speed(2)", () => video("test.mp4").sync().chop(4).speed(2)],
    ["video(\"test.mp4\").sync().begin(.2).end(.6).speed(2)", () => video("test.mp4").sync().begin(0.2).end(0.6).speed(2)],
    ["video(\"test.mp4\").sync().speed(-1).begin(.3).end(.7)", () => video("test.mp4").sync().speed(-1).begin(0.3).end(0.7)],
    ['screen("<test.mp4 other.mp4>").sync()', () => screen("<test.mp4 other.mp4>").sync()],
    ['screen("<test.mp4 other.mp4>").sync().speed(mini("1 2 3"))', () => screen("<test.mp4 other.mp4>").sync().speed(mini("1 2 3"))],
    ["video(\"test.mp4\").sync().scrub(0.5)", () => video("test.mp4").sync().scrub(0.5)],
    // loopAt combinations
    ["video(\"test.mp4\").loopAt(4)", () => video("test.mp4").loopAt(4)],
    ["video(\"test.mp4\").loopAt(4).speed(2)", () => video("test.mp4").loopAt(4).speed(2)],
    ["video(\"test.mp4\").loopAt(4).sync()", () => video("test.mp4").loopAt(4).sync()],
    ["video(\"test.mp4\").loopAt(4).begin(.2).end(.8)", () => video("test.mp4").loopAt(4).begin(0.2).end(0.8)],
    ["video(\"test.mp4\").loopAt(4).chop(2)", () => video("test.mp4").loopAt(4).chop(2)],
    // duration combinations
    ["video(\"test.mp4\").duration(0.25)", () => video("test.mp4").duration(0.25)],
    ["video(\"test.mp4\").begin(.4).duration(.25)", () => video("test.mp4").begin(0.4).duration(0.25)],
    ["video(\"test.mp4\").duration(.25).speed(2)", () => video("test.mp4").duration(0.25).speed(2)],
    ["video(\"test.mp4\").duration(.25).sync()", () => video("test.mp4").duration(0.25).sync()],
    // Reverse speed + constrained range (no sync)
    ["video(\"test.mp4\").speed(-1).begin(.3).end(.7)", () => video("test.mp4").speed(-1).begin(0.3).end(0.7)],
    ["video(\"test.mp4\").speed(-1).slow(2)", () => video("test.mp4").speed(-1).slow(2)],
    // fit + speed
    ["video(\"test.mp4\").slow(2).fit().speed(2)", () => video("test.mp4").slow(2).fit().speed(2)],
    // Pattern-valued begin/end with sync
    ['video("test.mp4").sync().begin(mini("0.2 0.4")).end(mini("0.6 0.8"))', () => video("test.mp4").sync().begin(mini("0.2 0.4")).end(mini("0.6 0.8"))],
    // Multi-operator chains
    ["video(\"test.mp4\").slow(2).chop(4).speed(0.5)", () => video("test.mp4").slow(2).chop(4).speed(0.5)],
    ["video(\"test.mp4\").begin(.2).end(.8).chop(4).speed(2)", () => video("test.mp4").begin(0.2).end(0.8).chop(4).speed(2)],
    // scrub with pattern
    ['video("test.mp4").scrub(mini("0 0.5 1"))', () => video("test.mp4").scrub(mini("0 0.5 1"))],
    // Adversarial: degenerate arguments
    ["video(\"test.mp4\").speed(0)", () => video("test.mp4").speed(0)],
    ["video(\"test.mp4\").speed(16)", () => video("test.mp4").speed(16)],
    ["video(\"test.mp4\").speed(-16)", () => video("test.mp4").speed(-16)],
    ["video(\"test.mp4\").speed(0.001)", () => video("test.mp4").speed(0.001)],
    ["video(\"test.mp4\").begin(.8).end(.2)", () => video("test.mp4").begin(0.8).end(0.2)],
    ["video(\"test.mp4\").begin(.5).end(.5)", () => video("test.mp4").begin(0.5).end(0.5)],
    ["video(\"test.mp4\").begin(0).end(0)", () => video("test.mp4").begin(0).end(0)],
    ["video(\"test.mp4\").begin(1.5).end(2.0)", () => video("test.mp4").begin(1.5).end(2.0)],
    ["video(\"test.mp4\").begin(-0.5).end(0.5)", () => video("test.mp4").begin(-0.5).end(0.5)],
    ["video(\"test.mp4\").duration(0)", () => video("test.mp4").duration(0)],
    ["video(\"test.mp4\").duration(-0.5)", () => video("test.mp4").duration(-0.5)],
    ["video(\"test.mp4\").duration(5)", () => video("test.mp4").duration(5)],
    ["video(\"test.mp4\").loopAt(0.001)", () => video("test.mp4").loopAt(0.001)],
    ["video(\"test.mp4\").loopAt(100)", () => video("test.mp4").loopAt(100)],
    ["video(\"test.mp4\").chop(1)", () => video("test.mp4").chop(1)],
    ["video(\"test.mp4\").chop(1000)", () => video("test.mp4").chop(1000)],
    ["video(\"test.mp4\").sync(-0.5)", () => video("test.mp4").sync(-0.5)],
    ["video(\"test.mp4\").sync(100)", () => video("test.mp4").sync(100)],
    // Adversarial: conflicting operator combinations
    ["video(\"test.mp4\").slow(2).fit().fit()", () => video("test.mp4").slow(2).fit().fit()],
    ["video(\"test.mp4\").scrub(0.5).speed(2)", () => video("test.mp4").scrub(0.5).speed(2)],
    ["video(\"test.mp4\").scrub(0.5).fit()", () => video("test.mp4").slow(2).scrub(0.5).fit()],
    ["video(\"test.mp4\").loopAt(4).fit()", () => video("test.mp4").loopAt(4).fit()],
    ["video(\"test.mp4\").loopAt(4).loopAt(2)", () => video("test.mp4").loopAt(4).loopAt(2)],
    ["video(\"test.mp4\").sync().sync(0.5)", () => video("test.mp4").sync().sync(0.5)],
    ["video(\"test.mp4\").speed(0).sync()", () => video("test.mp4").speed(0).sync()],
    ["video(\"test.mp4\").speed(0).fit()", () => video("test.mp4").slow(2).speed(0).fit()],
    ["video(\"test.mp4\").begin(.8).end(.2).speed(-1)", () => video("test.mp4").begin(0.8).end(0.2).speed(-1)],
    ["video(\"test.mp4\").begin(.8).end(.2).sync()", () => video("test.mp4").begin(0.8).end(0.2).sync()],
    // Sync with dynamically changing end creating inverted ranges (slider/sine scenario)
    ['video("test.mp4").sync().begin(1).end(mini("0.2 0.5 0.8"))', () => video("test.mp4").sync().begin(1).end(mini("0.2 0.5 0.8"))],
    ['video("test.mp4").sync().begin(mini("0.8 0.9 1")).end(mini("0.2 0.4"))', () => video("test.mp4").sync().begin(mini("0.8 0.9 1")).end(mini("0.2 0.4"))],
    ["video(\"test.mp4\").chop(4).begin(.5).end(.6)", () => video("test.mp4").chop(4).begin(0.5).end(0.6)],
    ["video(\"test.mp4\").fit().begin(.5).end(.8)", () => video("test.mp4").slow(2).fit().begin(0.5).end(0.8)],
  ];

  for (const [label, makePat] of patterns) {
    it(`trace invariants hold for: ${label}`, () => {
      const pat = makePat();
      const trace = simulateTrace(pat, 4, DUR);
      expect(trace.length).toBeGreaterThan(0);
      checkTraceInvariants(trace, label);
    });
  }
});

describe("equivalence class testing", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    setRuntimeCps(CPS);
  });

  /** Compare two traces point by point, allowing position tolerance. */
  function assertTracesMatch(a: TracePoint[], b: TracePoint[], label: string, tolerance = 0.05) {
    // Traces may differ in length (chop produces more events per frame in wide queries)
    // Compare at matching cycle points
    const bMap = new Map<string, TracePoint>();
    for (const p of b) bMap.set(p.cycle.toFixed(6), p);

    let matched = 0;
    for (const pa of a) {
      const key = pa.cycle.toFixed(6);
      const pb = bMap.get(key);
      if (!pb) continue;
      matched++;

      const loopLen = Math.abs(pa.loopEnd - pa.loopStart);
      const rawDiff = Math.abs(pa.expected - pb.expected);
      const diff = loopLen > 0 ? Math.min(rawDiff, Math.abs(rawDiff - loopLen)) : rawDiff;
      expect(diff, `${label} at cycle=${pa.cycle.toFixed(4)}: ${pa.expected.toFixed(3)} vs ${pb.expected.toFixed(3)}`).toBeLessThanOrEqual(tolerance);
    }
    expect(matched, `${label}: should have matched points`).toBeGreaterThan(10);
  }

  it("fit() ≡ fit().alpha(0.5): alpha doesn't change position", () => {
    const base = video("test.mp4").slow(2).begin(0.4).end(0.8).fit();
    const withAlpha = video("test.mp4").slow(2).begin(0.4).end(0.8).fit().alpha(0.5);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceAlpha = simulateTrace(withAlpha, 4, DUR);

    assertTracesMatch(traceBase, traceAlpha, "fit() vs fit().alpha(0.5)");
  });

  it("chop(8) ≡ chop(8).alpha(0.5): alpha doesn't change chop positions", () => {
    const base = video("test.mp4").slow(2).chop(8);
    const withAlpha = video("test.mp4").slow(2).chop(8).alpha(0.5);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceAlpha = simulateTrace(withAlpha, 4, DUR);

    assertTracesMatch(traceBase, traceAlpha, "chop(8) vs chop(8).alpha(0.5)");
  });

  it("speed(1) is identity for position", () => {
    const base = video("test.mp4").slow(2);
    const withSpeed = video("test.mp4").slow(2).speed(1);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceSpeed = simulateTrace(withSpeed, 4, DUR);

    assertTracesMatch(traceBase, traceSpeed, "p vs p.speed(1)");
  });

  it("begin(0).end(1) is identity for position", () => {
    const base = video("test.mp4").slow(2);
    const withBeginEnd = video("test.mp4").slow(2).begin(0).end(1);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceBeginEnd = simulateTrace(withBeginEnd, 4, DUR);

    assertTracesMatch(traceBase, traceBeginEnd, "p vs p.begin(0).end(1)");
  });

  it("chop(N).chop(M) ≡ chop(N*M) for begin/end values", () => {
    const double = video("test.mp4").chop(4).chop(2);
    const single = video("test.mp4").chop(8);

    // Compare begin/end values at matching timepoints
    const traceDouble = simulateTrace(double, 2, DUR);
    const traceSingle = simulateTrace(single, 2, DUR);

    assertTracesMatch(traceDouble, traceSingle, "chop(4).chop(2) vs chop(8)");
  });

  it("sync() ≡ sync().alpha(0.5): alpha doesn't change position", () => {
    const base = video("test.mp4").sync();
    const withAlpha = video("test.mp4").sync().alpha(0.5);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceAlpha = simulateTrace(withAlpha, 4, DUR);

    assertTracesMatch(traceBase, traceAlpha, "sync() vs sync().alpha(0.5)");
  });

  it("sync().speed(1) ≡ sync(): speed(1) is identity in sync mode", () => {
    const base = video("test.mp4").sync();
    const withSpeed = video("test.mp4").sync().speed(1);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceSpeed = simulateTrace(withSpeed, 4, DUR);

    assertTracesMatch(traceBase, traceSpeed, "sync() vs sync().speed(1)");
  });

  it("sync().begin(0).end(1) ≡ sync(): default range is identity", () => {
    const base = video("test.mp4").sync();
    const withRange = video("test.mp4").sync().begin(0).end(1);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceRange = simulateTrace(withRange, 4, DUR);

    assertTracesMatch(traceBase, traceRange, "sync() vs sync().begin(0).end(1)");
  });

  it("sync().scale(2) ≡ sync(): scale doesn't affect playback position", () => {
    const base = video("test.mp4").sync();
    const withScale = video("test.mp4").sync().scale(2);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceScale = simulateTrace(withScale, 4, DUR);

    assertTracesMatch(traceBase, traceScale, "sync() vs sync().scale(2)");
  });

  it("sync().blend('multiply') ≡ sync(): blend doesn't affect position", () => {
    const base = video("test.mp4").sync();
    const withBlend = (video("test.mp4").sync() as any).blend("multiply");

    const traceBase = simulateTrace(base, 4, DUR);
    const traceBlend = simulateTrace(withBlend, 4, DUR);

    assertTracesMatch(traceBase, traceBlend, "sync() vs sync().blend('multiply')");
  });

  it("sync().slow(2) produces same positions as sync() (just longer events)", () => {
    // With sync, eventBegin is always 0. slow(2) just doubles event length,
    // but position depends only on elapsed time from cycle 0, not event span.
    const base = video("test.mp4").sync();
    const withSlow = video("test.mp4").sync().slow(2);

    const traceBase = simulateTrace(base, 4, DUR);
    const traceSlow = simulateTrace(withSlow, 4, DUR);

    assertTracesMatch(traceBase, traceSlow, "sync() vs sync().slow(2)");
  });

  it("loopAt(4) ≡ slow(4).fit(): same positions", () => {
    const looped = video("test.mp4").loopAt(4);
    const manual = video("test.mp4").slow(4).fit();

    const traceLoop = simulateTrace(looped, 8, DUR);
    const traceManual = simulateTrace(manual, 8, DUR);

    assertTracesMatch(traceLoop, traceManual, "loopAt(4) vs slow(4).fit()");
  });

  it("duration(0.25) ≡ begin(0).end(0.25): same range", () => {
    const withDur = video("test.mp4").duration(0.25);
    const withBeginEnd = video("test.mp4").begin(0).end(0.25);

    const traceDur = simulateTrace(withDur, 4, DUR);
    const traceBeginEnd = simulateTrace(withBeginEnd, 4, DUR);

    assertTracesMatch(traceDur, traceBeginEnd, "duration(0.25) vs begin(0).end(0.25)");
  });

  it("begin(.4).duration(.25) ≡ begin(.4).end(.65): same range", () => {
    const withDur = video("test.mp4").begin(0.4).duration(0.25);
    const withEnd = video("test.mp4").begin(0.4).end(0.65);

    const traceDur = simulateTrace(withDur, 4, DUR);
    const traceEnd = simulateTrace(withEnd, 4, DUR);

    assertTracesMatch(traceDur, traceEnd, "begin(.4).dur(.25) vs begin(.4).end(.65)");
  });

  it("loopAt(4).alpha(0.5) ≡ loopAt(4): alpha doesn't affect position", () => {
    const base = video("test.mp4").loopAt(4);
    const withAlpha = video("test.mp4").loopAt(4).alpha(0.5);

    const traceBase = simulateTrace(base, 8, DUR);
    const traceAlpha = simulateTrace(withAlpha, 8, DUR);

    assertTracesMatch(traceBase, traceAlpha, "loopAt(4) vs loopAt(4).alpha(0.5)");
  });
});

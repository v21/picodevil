/**
 * Time-stepping simulation tests: step through pattern chains at frame granularity
 * and verify invariants on the resulting traces.
 *
 * These catch stateful interaction bugs that pure-function tests miss by simulating
 * the full render loop's query → eventBegin → expectedTime pipeline.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { video } from "./video-pattern";
import { eventBeginFromHap } from "./event-begin";
import { computeExpectedFromEvent } from "./video-pool";
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

/** Step through a pattern at ~60fps, recording the playback trace. */
function simulateTrace(pat: any, cycles: number, duration: number): TracePoint[] {
  const fps = 60;
  const trace: TracePoint[] = [];
  const dt = CPS / fps; // cycle increment per frame

  for (let cycle = 0; cycle < cycles; cycle += dt) {
    const haps = pat.queryArc(cycle, cycle + 0.0001);
    if (haps.length === 0) continue;

    const hap = haps[0];
    const ev = hap.value;
    const eventBegin = eventBeginFromHap(ev, hap, cycle);
    const expected = computeExpectedFromEvent(ev, cycle, eventBegin, CPS, duration);
    if (expected == null) continue;

    const speed = ev.speed != null ? Number(ev.speed) : 1;
    const begin = ev.begin ?? 0;
    const end = ev.end ?? 1;

    trace.push({
      cycle,
      eventBegin,
      expected,
      speed,
      loopStart: begin * duration,
      loopEnd: end * duration,
    });
  }

  return trace;
}

/** Verify trace invariants. */
function checkTraceInvariants(trace: TracePoint[], label: string) {
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    const loopLen = Math.abs(p.loopEnd - p.loopStart);

    // Invariant 1: no NaN/Infinity
    expect(p.expected, `${label} [${i}] expected is finite`).toSatisfy((v: number) => isFinite(v));
    expect(p.eventBegin, `${label} [${i}] eventBegin is finite`).toSatisfy((v: number) => isFinite(v));

    // Invariant 2: position in range
    if (loopLen > 0) {
      expect(p.expected, `${label} [${i}] expected >= loopStart`).toBeGreaterThanOrEqual(p.loopStart - 1e-6);
      expect(p.expected, `${label} [${i}] expected <= loopEnd`).toBeLessThanOrEqual(p.loopEnd + 1e-6);
    }

    // Invariant 3: continuity (between consecutive frames in the same event)
    if (i > 0) {
      const prev = trace[i - 1];
      const sameEvent = Math.abs(p.eventBegin - prev.eventBegin) < 0.001;
      const sameLoop = Math.abs(p.loopStart - prev.loopStart) < 0.001
        && Math.abs(p.loopEnd - prev.loopEnd) < 0.001;

      if (sameEvent && sameLoop && loopLen > 0) {
        const rawDelta = Math.abs(p.expected - prev.expected);
        const delta = Math.min(rawDelta, Math.abs(rawDelta - loopLen));
        const cycleDt = p.cycle - prev.cycle;
        const maxDelta = cycleDt * Math.abs(p.speed) / CPS + 0.01;
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
});

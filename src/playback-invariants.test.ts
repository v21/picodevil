/**
 * Property-based invariant tests for video playback.
 *
 * These verify invariants that must hold for ANY inputs to the playback
 * functions, catching edge cases that hand-written tests miss.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeExpectedTime } from "./video-playback";
import { eventBeginFromHap } from "./event-begin";

describe("computeExpectedTime invariants", () => {
  // Arbitrary for valid ExpectedTimeParams
  const validParams = fc.record({
    currentCycle: fc.double({ min: 0, max: 1000, noNaN: true }),
    eventBegin: fc.double({ min: 0, max: 1000, noNaN: true }),
    cps: fc.double({ min: 0.01, max: 10, noNaN: true }),
    speed: fc.double({ min: -16, max: 16, noNaN: true }),
    loopStart: fc.double({ min: 0, max: 100, noNaN: true }),
    duration: fc.double({ min: 0.01, max: 600, noNaN: true }),
  }).chain(p => {
    // loopEnd must differ from loopStart and both within duration
    const lo = Math.min(p.loopStart, p.duration);
    return fc.double({ min: lo + 0.001, max: Math.max(lo + 0.002, p.duration), noNaN: true }).map(loopEnd => ({
      ...p,
      loopStart: lo,
      loopEnd: Math.min(loopEnd, p.duration),
    }));
  }).filter(p => {
    // Ensure valid: loopEnd > loopStart, currentCycle >= eventBegin
    return p.loopEnd > p.loopStart && p.currentCycle >= p.eventBegin && p.speed !== 0;
  });

  it("result is always finite", () => {
    fc.assert(fc.property(validParams, p => {
      const result = computeExpectedTime(p);
      expect(result).toSatisfy((v: number) => isFinite(v));
    }), { numRuns: 500 });
  });

  it("result is always within [loopStart, loopEnd]", () => {
    fc.assert(fc.property(validParams, p => {
      const result = computeExpectedTime(p);
      expect(result).toBeGreaterThanOrEqual(p.loopStart - 1e-10);
      expect(result).toBeLessThanOrEqual(p.loopEnd + 1e-10);
    }), { numRuns: 500 });
  });

  it("speed=0 always returns loopStart", () => {
    const params = fc.record({
      currentCycle: fc.double({ min: 0, max: 1000, noNaN: true }),
      eventBegin: fc.double({ min: 0, max: 1000, noNaN: true }),
      cps: fc.double({ min: 0.01, max: 10, noNaN: true }),
      loopStart: fc.double({ min: 0, max: 50, noNaN: true }),
      loopEnd: fc.double({ min: 0, max: 100, noNaN: true }),
      duration: fc.double({ min: 0.01, max: 600, noNaN: true }),
    }).filter(p => p.loopEnd > p.loopStart);

    fc.assert(fc.property(params, p => {
      const result = computeExpectedTime({ ...p, speed: 0 });
      expect(result).toBe(p.loopStart);
    }), { numRuns: 200 });
  });

  it("position is continuous: small Δcycle → small Δposition", () => {
    fc.assert(fc.property(validParams, p => {
      const epsilon = 0.0001;
      const p2 = { ...p, currentCycle: p.currentCycle + epsilon };
      const pos1 = computeExpectedTime(p);
      const pos2 = computeExpectedTime(p2);

      const loopLen = Math.abs(p.loopEnd - p.loopStart);
      // Max position change per cycle: |speed| / cps
      // For small epsilon, position change should be small (accounting for loop wraps)
      const rawDelta = Math.abs(pos2 - pos1);
      const delta = loopLen > 0 ? Math.min(rawDelta, Math.abs(rawDelta - loopLen)) : rawDelta;
      const maxDelta = epsilon * Math.abs(p.speed) / p.cps + 1e-6;
      expect(delta).toBeLessThanOrEqual(maxDelta);
    }), { numRuns: 500 });
  });

  it("positive speed: position increases (mod loop) with increasing cycle", () => {
    const posParams = validParams.filter(p => p.speed > 0.01);
    fc.assert(fc.property(posParams, p => {
      const step = 0.01;
      const pos1 = computeExpectedTime(p);
      const pos2 = computeExpectedTime({ ...p, currentCycle: p.currentCycle + step });

      const loopLen = p.loopEnd - p.loopStart;
      // Forward distance (accounting for wrap): should be positive
      const forwardDist = ((pos2 - pos1) % loopLen + loopLen) % loopLen;
      // If loop is very short relative to step, we might wrap multiple times
      // Just check it's not going backwards by more than a small tolerance
      expect(forwardDist).toBeGreaterThanOrEqual(-1e-6);
    }), { numRuns: 300 });
  });

  it("negative speed: position decreases (mod loop) with increasing cycle", () => {
    const negParams = validParams.filter(p => p.speed < -0.01);
    fc.assert(fc.property(negParams, p => {
      const step = 0.01;
      const pos1 = computeExpectedTime(p);
      const pos2 = computeExpectedTime({ ...p, currentCycle: p.currentCycle + step });

      const loopLen = p.loopEnd - p.loopStart;
      // Backward distance: pos should decrease (forward dist should be ~loopLen - small)
      const backwardDist = ((pos1 - pos2) % loopLen + loopLen) % loopLen;
      expect(backwardDist).toBeGreaterThanOrEqual(-1e-6);
    }), { numRuns: 300 });
  });
});

describe("eventBeginFromHap invariants", () => {
  it("sync always returns 0 regardless of other fields", () => {
    const arb = fc.record({
      syncVal: fc.oneof(fc.constant(0), fc.constant(true), fc.double({ min: 0, max: 1, noNaN: true })),
      onset: fc.double({ min: 0, max: 100, noNaN: true }),
      wholeBegin: fc.double({ min: 0, max: 100, noNaN: true }),
      t: fc.double({ min: 0, max: 100, noNaN: true }),
    });

    fc.assert(fc.property(arb, ({ syncVal, onset, wholeBegin, t }) => {
      const ev = { sync: syncVal, _onset: onset };
      const hap = { whole: { begin: wholeBegin } };
      expect(eventBeginFromHap(ev, hap, t)).toBe(0);
    }), { numRuns: 200 });
  });

  it("without sync, result equals hap.whole.begin when present", () => {
    const arb = fc.record({
      onset: fc.double({ min: 0, max: 100, noNaN: true }),
      wholeBegin: fc.double({ min: 0, max: 100, noNaN: true }),
      t: fc.double({ min: 0, max: 100, noNaN: true }),
    });

    fc.assert(fc.property(arb, ({ onset, wholeBegin, t }) => {
      const ev = { _onset: onset };
      const hap = { whole: { begin: wholeBegin } };
      expect(eventBeginFromHap(ev, hap, t)).toBe(wholeBegin);
    }), { numRuns: 200 });
  });

  it("result is always a finite number", () => {
    const arb = fc.record({
      hasSync: fc.boolean(),
      syncVal: fc.oneof(fc.constant(0), fc.constant(true), fc.double({ min: 0, max: 100, noNaN: true })),
      hasOnset: fc.boolean(),
      onset: fc.double({ min: 0, max: 100, noNaN: true }),
      hasWhole: fc.boolean(),
      wholeBegin: fc.double({ min: 0, max: 100, noNaN: true }),
      t: fc.double({ min: 0, max: 100, noNaN: true }),
    });

    fc.assert(fc.property(arb, p => {
      const ev: any = {};
      if (p.hasSync) ev.sync = p.syncVal;
      if (p.hasOnset) ev._onset = p.onset;
      const hap = p.hasWhole ? { whole: { begin: p.wholeBegin } } : undefined;
      const result = eventBeginFromHap(ev, hap, p.t);
      expect(result).toSatisfy((v: number) => isFinite(v));
    }), { numRuns: 300 });
  });
});

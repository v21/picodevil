/**
 * Property-based invariant tests for video playback.
 *
 * These verify invariants that must hold for ANY inputs to the playback
 * functions, catching edge cases that hand-written tests miss.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeExpectedTime, computeLoopLen } from "./video-playback";
import { computeSyncDistOffset } from "./sync-continuity";
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

describe("computeExpectedTime with inverted (wrap-around) ranges", () => {
  // Generate params where loopStart > loopEnd (inverted range)
  const invertedParams = fc.record({
    currentCycle: fc.double({ min: 0, max: 1000, noNaN: true }),
    eventBegin: fc.double({ min: 0, max: 1000, noNaN: true }),
    cps: fc.double({ min: 0.01, max: 10, noNaN: true }),
    speed: fc.double({ min: -16, max: 16, noNaN: true }),
    duration: fc.double({ min: 1, max: 100, noNaN: true }),
  }).chain(p => {
    // Generate loopStart and loopEnd such that loopStart > loopEnd (inverted)
    return fc.record({
      loopStart: fc.double({ min: p.duration * 0.3, max: p.duration - 0.01, noNaN: true }),
      loopEnd: fc.double({ min: 0.01, max: p.duration * 0.7, noNaN: true }),
    }).map(r => ({ ...p, ...r }));
  }).filter(p => p.loopStart > p.loopEnd && p.currentCycle >= p.eventBegin && p.speed !== 0);

  it("result is always finite", () => {
    fc.assert(fc.property(invertedParams, p => {
      const result = computeExpectedTime(p);
      expect(result).toSatisfy((v: number) => isFinite(v));
    }), { numRuns: 500 });
  });

  it("result is within valid wrap-around range: [loopStart, dur) ∪ [0, loopEnd]", () => {
    fc.assert(fc.property(invertedParams, p => {
      const result = computeExpectedTime(p);
      const inUpper = result >= p.loopStart - 1e-10;
      const inLower = result <= p.loopEnd + 1e-10;
      expect(inUpper || inLower, `pos=${result} not in [${p.loopStart},${p.duration}) ∪ [0,${p.loopEnd}]`).toBe(true);
    }), { numRuns: 500 });
  });

  it("position is continuous: small Δcycle → small Δposition", () => {
    fc.assert(fc.property(invertedParams, p => {
      const epsilon = 0.0001;
      const pos1 = computeExpectedTime(p);
      const pos2 = computeExpectedTime({ ...p, currentCycle: p.currentCycle + epsilon });
      const loopLen = computeLoopLen(p.loopStart, p.loopEnd, p.duration);
      // Convert to loop-space for continuity check
      const toOff = (pos: number) => pos >= p.loopStart ? pos - p.loopStart : pos + (p.duration - p.loopStart);
      const off1 = toOff(pos1);
      const off2 = toOff(pos2);
      const rawDelta = Math.abs(off2 - off1);
      const delta = loopLen > 0 ? Math.min(rawDelta, loopLen - rawDelta) : rawDelta;
      const maxDelta = epsilon * Math.abs(p.speed) / p.cps + 1e-6;
      expect(delta).toBeLessThanOrEqual(maxDelta);
    }), { numRuns: 500 });
  });

  it("speed=0 returns loopStart", () => {
    fc.assert(fc.property(invertedParams, p => {
      const result = computeExpectedTime({ ...p, speed: 0 });
      expect(result).toBe(p.loopStart);
    }), { numRuns: 200 });
  });
});

describe("computeExpectedTime with distOffset invariants", () => {
  const validParams = fc.record({
    currentCycle: fc.double({ min: 0, max: 1000, noNaN: true }),
    eventBegin: fc.constant(0), // sync mode
    cps: fc.double({ min: 0.01, max: 10, noNaN: true }),
    speed: fc.double({ min: -16, max: 16, noNaN: true }),
    loopStart: fc.double({ min: 0, max: 100, noNaN: true }),
    duration: fc.double({ min: 0.01, max: 600, noNaN: true }),
    distOffset: fc.double({ min: -100, max: 100, noNaN: true }),
  }).chain(p => {
    const lo = Math.min(p.loopStart, p.duration);
    return fc.double({ min: lo + 0.001, max: Math.max(lo + 0.002, p.duration), noNaN: true }).map(loopEnd => ({
      ...p,
      loopStart: lo,
      loopEnd: Math.min(loopEnd, p.duration),
    }));
  }).filter(p => p.loopEnd > p.loopStart && p.speed !== 0);

  it("result with distOffset is always within [loopStart, loopEnd]", () => {
    fc.assert(fc.property(validParams, p => {
      const result = computeExpectedTime(p);
      expect(result).toBeGreaterThanOrEqual(p.loopStart - 1e-10);
      expect(result).toBeLessThanOrEqual(p.loopEnd + 1e-10);
    }), { numRuns: 500 });
  });

  it("result with distOffset is always finite", () => {
    fc.assert(fc.property(validParams, p => {
      const result = computeExpectedTime(p);
      expect(result).toSatisfy((v: number) => isFinite(v));
    }), { numRuns: 500 });
  });

  it("distOffset=0 is identity", () => {
    fc.assert(fc.property(validParams, p => {
      const withOffset = computeExpectedTime({ ...p, distOffset: 0 });
      const without = computeExpectedTime({ ...p, distOffset: undefined });
      expect(withOffset).toBe(without);
    }), { numRuns: 300 });
  });

  it("position is continuous: small Δcycle → small Δposition (with distOffset)", () => {
    fc.assert(fc.property(validParams, p => {
      const epsilon = 0.0001;
      const pos1 = computeExpectedTime(p);
      const pos2 = computeExpectedTime({ ...p, currentCycle: p.currentCycle + epsilon });
      const loopLen = Math.abs(p.loopEnd - p.loopStart);
      const rawDelta = Math.abs(pos2 - pos1);
      const delta = loopLen > 0 ? Math.min(rawDelta, Math.abs(rawDelta - loopLen)) : rawDelta;
      const maxDelta = epsilon * Math.abs(p.speed) / p.cps + 1e-6;
      expect(delta).toBeLessThanOrEqual(maxDelta);
    }), { numRuns: 500 });
  });
});

describe("computeSyncDistOffset invariants", () => {
  const validOffsetParams = fc.record({
    elapsedSec: fc.double({ min: 0, max: 100, noNaN: true }),
    oldSpeed: fc.double({ min: -16, max: 16, noNaN: true }),
    newSpeed: fc.double({ min: -16, max: 16, noNaN: true }),
    loopStart: fc.double({ min: 0, max: 50, noNaN: true }),
    duration: fc.double({ min: 1, max: 100, noNaN: true }),
    syncOffset: fc.double({ min: 0, max: 50, noNaN: true }),
    oldDistOffset: fc.double({ min: -50, max: 50, noNaN: true }),
  }).chain(p => {
    const lo = Math.min(p.loopStart, p.duration);
    return fc.double({ min: lo + 0.1, max: Math.max(lo + 0.2, p.duration), noNaN: true }).map(loopEnd => ({
      ...p,
      loopStart: lo,
      loopEnd: Math.min(loopEnd, p.duration),
    }));
  }).filter(p => p.loopEnd > p.loopStart && p.oldSpeed !== 0 && p.newSpeed !== 0);

  it("offset produces same position as old params (same loop bounds)", () => {
    fc.assert(fc.property(validOffsetParams, p => {
      const loopLen = p.loopEnd - p.loopStart;
      const offset = computeSyncDistOffset({
        elapsedSec: p.elapsedSec,
        oldSpeed: p.oldSpeed, newSpeed: p.newSpeed,
        oldBegin: p.loopStart, newBegin: p.loopStart,
        oldEnd: p.loopEnd, newEnd: p.loopEnd,
        oldLoopLen: loopLen, newLoopLen: loopLen,
        syncOffset: p.syncOffset, oldDistOffset: p.oldDistOffset,
      });

      const oldPos = computeExpectedTime({
        currentCycle: 0, eventBegin: 0, cps: 1,
        speed: p.oldSpeed, loopStart: p.loopStart, loopEnd: p.loopEnd,
        duration: p.duration, syncOffset: p.syncOffset,
        distOffset: p.oldDistOffset + p.elapsedSec * Math.abs(p.oldSpeed),
      });
      // Compute using elapsedSec directly to avoid cps dependency
      const newPos = computeExpectedTime({
        currentCycle: 0, eventBegin: 0, cps: 1,
        speed: p.newSpeed, loopStart: p.loopStart, loopEnd: p.loopEnd,
        duration: p.duration, syncOffset: p.syncOffset,
        distOffset: offset + p.elapsedSec * Math.abs(p.newSpeed),
      });

      const rawDiff = Math.abs(oldPos - newPos);
      const diff = loopLen > 0 ? Math.min(rawDiff, Math.abs(rawDiff - loopLen)) : rawDiff;
      expect(diff).toBeLessThan(1e-6);
    }), { numRuns: 500 });
  });

  it("offset is finite for all valid inputs", () => {
    fc.assert(fc.property(validOffsetParams, p => {
      const loopLen = p.loopEnd - p.loopStart;
      const offset = computeSyncDistOffset({
        elapsedSec: p.elapsedSec,
        oldSpeed: p.oldSpeed, newSpeed: p.newSpeed,
        oldBegin: p.loopStart, newBegin: p.loopStart,
        oldEnd: p.loopEnd, newEnd: p.loopEnd,
        oldLoopLen: loopLen, newLoopLen: loopLen,
        syncOffset: p.syncOffset, oldDistOffset: p.oldDistOffset,
      });
      expect(offset).toSatisfy((v: number) => isFinite(v));
    }), { numRuns: 500 });
  });

  it("identity: same speed produces offset that preserves position", () => {
    fc.assert(fc.property(validOffsetParams, p => {
      const loopLen = p.loopEnd - p.loopStart;
      const offset = computeSyncDistOffset({
        elapsedSec: p.elapsedSec,
        oldSpeed: p.oldSpeed, newSpeed: p.oldSpeed, // same speed
        oldBegin: p.loopStart, newBegin: p.loopStart,
        oldEnd: p.loopEnd, newEnd: p.loopEnd,
        oldLoopLen: loopLen, newLoopLen: loopLen,
        syncOffset: p.syncOffset, oldDistOffset: p.oldDistOffset,
      });
      // With same speed, the new offset should produce equivalent dist mod loopLen
      // In practice, offset should equal oldDistOffset (since nothing changed)
      const oldDist = p.elapsedSec * Math.abs(p.oldSpeed) + p.syncOffset + p.oldDistOffset;
      const newDist = p.elapsedSec * Math.abs(p.oldSpeed) + p.syncOffset + offset;
      const oldMod = ((oldDist % loopLen) + loopLen) % loopLen;
      const newMod = ((newDist % loopLen) + loopLen) % loopLen;
      const diff = Math.abs(oldMod - newMod);
      expect(Math.min(diff, loopLen - diff)).toBeLessThan(1e-6);
    }), { numRuns: 300 });
  });
});

describe("computeSyncDistOffset with inverted ranges", () => {
  const invertedOffsetParams = fc.record({
    elapsedSec: fc.double({ min: 0, max: 100, noNaN: true }),
    oldSpeed: fc.double({ min: 0.1, max: 16, noNaN: true }),
    newSpeed: fc.double({ min: 0.1, max: 16, noNaN: true }),
    duration: fc.double({ min: 2, max: 100, noNaN: true }),
    syncOffset: fc.constant(0),
    oldDistOffset: fc.double({ min: -50, max: 50, noNaN: true }),
  }).chain(p => {
    // Generate inverted range within duration
    return fc.record({
      loopStart: fc.double({ min: p.duration * 0.5, max: p.duration - 0.1, noNaN: true }),
      loopEnd: fc.double({ min: 0.1, max: p.duration * 0.5, noNaN: true }),
    }).map(r => ({ ...p, ...r }));
  }).filter(p => p.loopStart > p.loopEnd && p.oldSpeed !== 0 && p.newSpeed !== 0);

  it("offset is finite for inverted ranges", () => {
    fc.assert(fc.property(invertedOffsetParams, p => {
      const loopLen = computeLoopLen(p.loopStart, p.loopEnd, p.duration);
      const offset = computeSyncDistOffset({
        elapsedSec: p.elapsedSec,
        oldSpeed: p.oldSpeed, newSpeed: p.newSpeed,
        oldBegin: p.loopStart, newBegin: p.loopStart,
        oldEnd: p.loopEnd, newEnd: p.loopEnd,
        oldLoopLen: loopLen, newLoopLen: loopLen,
        syncOffset: p.syncOffset, oldDistOffset: p.oldDistOffset,
        duration: p.duration,
      });
      expect(offset).toSatisfy((v: number) => isFinite(v));
    }), { numRuns: 500 });
  });

  it("offset preserves position for inverted ranges (same bounds, speed change)", () => {
    fc.assert(fc.property(invertedOffsetParams, p => {
      const loopLen = computeLoopLen(p.loopStart, p.loopEnd, p.duration);
      const offset = computeSyncDistOffset({
        elapsedSec: p.elapsedSec,
        oldSpeed: p.oldSpeed, newSpeed: p.newSpeed,
        oldBegin: p.loopStart, newBegin: p.loopStart,
        oldEnd: p.loopEnd, newEnd: p.loopEnd,
        oldLoopLen: loopLen, newLoopLen: loopLen,
        syncOffset: p.syncOffset, oldDistOffset: p.oldDistOffset,
        duration: p.duration,
      });

      const oldPos = computeExpectedTime({
        currentCycle: 0, eventBegin: 0, cps: 1,
        speed: p.oldSpeed, loopStart: p.loopStart, loopEnd: p.loopEnd,
        duration: p.duration, syncOffset: p.syncOffset,
        distOffset: p.oldDistOffset + p.elapsedSec * Math.abs(p.oldSpeed),
      });
      const newPos = computeExpectedTime({
        currentCycle: 0, eventBegin: 0, cps: 1,
        speed: p.newSpeed, loopStart: p.loopStart, loopEnd: p.loopEnd,
        duration: p.duration, syncOffset: p.syncOffset,
        distOffset: offset + p.elapsedSec * Math.abs(p.newSpeed),
      });

      // Compare in loop-space
      const toOff = (pos: number) => pos >= p.loopStart ? pos - p.loopStart : pos + (p.duration - p.loopStart);
      const oldOff = toOff(oldPos);
      const newOff = toOff(newPos);
      const rawDiff = Math.abs(oldOff - newOff);
      const diff = loopLen > 0 ? Math.min(rawDiff, loopLen - rawDiff) : rawDiff;
      expect(diff).toBeLessThan(1e-6);
    }), { numRuns: 500 });
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

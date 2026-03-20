/**
 * Tests for sync mode playhead continuity when speed/begin/end change.
 *
 * The core idea: in sync mode, changing speed (or loop bounds) should continue
 * from the current playhead position rather than jumping. The `computeSyncDistOffset`
 * helper computes a correction offset that makes `computeExpectedTime` produce
 * the same position at the transition point.
 */
import { describe, it, expect } from "vitest";
import { computeExpectedTime } from "./video-playback";
import { computeSyncDistOffset } from "./sync-continuity";

const DUR = 10;
const CPS = 0.5;

/** Helper: compute position with given params + offset. */
function posAt(p: {
  currentCycle: number;
  cps: number;
  speed: number;
  loopStart: number;
  loopEnd: number;
  syncOffset?: number;
  distOffset?: number;
}): number {
  return computeExpectedTime({
    currentCycle: p.currentCycle,
    eventBegin: 0, // sync mode
    cps: p.cps,
    speed: p.speed,
    loopStart: p.loopStart,
    loopEnd: p.loopEnd,
    duration: Math.abs(p.loopEnd - p.loopStart),
    syncOffset: p.syncOffset ?? 0,
    distOffset: p.distOffset ?? 0,
  });
}

describe("computeSyncDistOffset", () => {
  describe("speed changes", () => {
    it("speed 1→2: position is continuous", () => {
      const cycle = 5; // elapsed = 5/0.5 = 10s
      const oldPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR });

      const offset = computeSyncDistOffset({
        elapsedSec: (cycle - 0) / CPS,
        oldSpeed: 1, newSpeed: 2,
        oldBegin: 0, newBegin: 0,
        oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR,
        syncOffset: 0,
        oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 2, loopStart: 0, loopEnd: DUR, distOffset: offset });
      expect(newPos).toBeCloseTo(oldPos, 6);
    });

    it("speed 2→0.5: position is continuous", () => {
      const cycle = 3;
      const oldPos = posAt({ currentCycle: cycle, cps: CPS, speed: 2, loopStart: 0, loopEnd: DUR });

      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 2, newSpeed: 0.5,
        oldBegin: 0, newBegin: 0,
        oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR,
        syncOffset: 0,
        oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 0.5, loopStart: 0, loopEnd: DUR, distOffset: offset });
      expect(newPos).toBeCloseTo(oldPos, 6);
    });

    it("speed sign reversal +1→-1: position is continuous", () => {
      const cycle = 3.7;
      const oldPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR });

      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 1, newSpeed: -1,
        oldBegin: 0, newBegin: 0,
        oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR,
        syncOffset: 0,
        oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: -1, loopStart: 0, loopEnd: DUR, distOffset: offset });
      expect(newPos).toBeCloseTo(oldPos, 6);
    });

    it("multiple speed changes: no drift", () => {
      const cycle = 4;
      const elapsedSec = cycle / CPS;

      // Start at speed 1
      const pos0 = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR });

      // Change to speed 3
      const offset1 = computeSyncDistOffset({
        elapsedSec, oldSpeed: 1, newSpeed: 3,
        oldBegin: 0, newBegin: 0, oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR, syncOffset: 0, oldDistOffset: 0,
      });
      const pos1 = posAt({ currentCycle: cycle, cps: CPS, speed: 3, loopStart: 0, loopEnd: DUR, distOffset: offset1 });
      expect(pos1).toBeCloseTo(pos0, 6);

      // Change to speed 0.25 (using offset1 as oldDistOffset)
      const offset2 = computeSyncDistOffset({
        elapsedSec, oldSpeed: 3, newSpeed: 0.25,
        oldBegin: 0, newBegin: 0, oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR, syncOffset: 0, oldDistOffset: offset1,
      });
      const pos2 = posAt({ currentCycle: cycle, cps: CPS, speed: 0.25, loopStart: 0, loopEnd: DUR, distOffset: offset2 });
      expect(pos2).toBeCloseTo(pos0, 6);
    });

    it("after speed change, position advances at new rate", () => {
      const cycle = 4;
      const elapsedSec = cycle / CPS;

      const offset = computeSyncDistOffset({
        elapsedSec, oldSpeed: 1, newSpeed: 2,
        oldBegin: 0, newBegin: 0, oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR, syncOffset: 0, oldDistOffset: 0,
      });

      const pos0 = posAt({ currentCycle: cycle, cps: CPS, speed: 2, loopStart: 0, loopEnd: DUR, distOffset: offset });
      // Advance 1 cycle = 2s wall time, at speed 2 = 4s of video
      const pos1 = posAt({ currentCycle: cycle + 1, cps: CPS, speed: 2, loopStart: 0, loopEnd: DUR, distOffset: offset });
      const advance = ((pos1 - pos0) % DUR + DUR) % DUR;
      expect(advance).toBeCloseTo(4, 5);
    });
  });

  describe("begin/end changes", () => {
    it("range shrinks, position in new range: position preserved", () => {
      const cycle = 1.5; // elapsed = 3s, at speed 1 → pos = 3s
      const oldPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR });
      expect(oldPos).toBeCloseTo(3); // sanity

      // Shrink to [0, 5] — pos 3 is still in range
      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 1, newSpeed: 1,
        oldBegin: 0, newBegin: 0,
        oldEnd: DUR, newEnd: 5,
        oldLoopLen: DUR, newLoopLen: 5,
        syncOffset: 0, oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: 5, distOffset: offset });
      expect(newPos).toBeCloseTo(3, 6);
    });

    it("range shrinks, position outside new range: clamps to edge", () => {
      const cycle = 3.5; // elapsed = 7s → pos = 7s
      const oldPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR });
      expect(oldPos).toBeCloseTo(7); // sanity

      // Shrink to [0, 5) — pos 7 is outside, clamps to just under 5
      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 1, newSpeed: 1,
        oldBegin: 0, newBegin: 0,
        oldEnd: DUR, newEnd: 5,
        oldLoopLen: DUR, newLoopLen: 5,
        syncOffset: 0, oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: 5, distOffset: offset });
      // Clamped to just under loopEnd (5 - epsilon)
      expect(newPos).toBeGreaterThan(4.99);
      expect(newPos).toBeLessThan(5);
    });

    it("range shifts, position outside: clamps to nearest edge", () => {
      const cycle = 1; // elapsed = 2s → pos = 2s in [0, 10]

      // Shift to [5, 10] — pos 2 is below range, clamp to 5
      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 1, newSpeed: 1,
        oldBegin: 0, newBegin: 5,
        oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: 5,
        syncOffset: 0, oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 5, loopEnd: DUR, distOffset: offset });
      expect(newPos).toBeCloseTo(5, 6);
    });
  });

  describe("combined changes", () => {
    it("speed + range change together: continuous and clamped", () => {
      const cycle = 2; // elapsed = 4s, speed=1 → pos = 4s in [0, 10]

      // Change speed to 2 AND range to [0, 5] — pos 4 is in new range
      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 1, newSpeed: 2,
        oldBegin: 0, newBegin: 0,
        oldEnd: DUR, newEnd: 5,
        oldLoopLen: DUR, newLoopLen: 5,
        syncOffset: 0, oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 2, loopStart: 0, loopEnd: 5, distOffset: offset });
      expect(newPos).toBeCloseTo(4, 6);
    });
  });

  describe("edge cases", () => {
    it("speed 0→1: starts from loopStart", () => {
      const cycle = 5;

      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 0, newSpeed: 1,
        oldBegin: 0, newBegin: 0,
        oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR,
        syncOffset: 0, oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR, distOffset: offset });
      expect(newPos).toBeCloseTo(0, 6);
    });

    it("speed 1→0→1: resumes from where speed=0 started", () => {
      const cycle = 3; // elapsed = 6s, speed=1 → pos = 6s
      const posBeforeStop = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR });

      // Change to speed 0
      const offset1 = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 1, newSpeed: 0,
        oldBegin: 0, newBegin: 0, oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR, syncOffset: 0, oldDistOffset: 0,
      });
      // speed=0 always returns loopStart — that's the position at speed=0

      // Later, change back to speed 1 — should resume from loopStart (where speed=0 left it)
      const laterCycle = 10;
      const offset2 = computeSyncDistOffset({
        elapsedSec: laterCycle / CPS,
        oldSpeed: 0, newSpeed: 1,
        oldBegin: 0, newBegin: 0, oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR, syncOffset: 0, oldDistOffset: offset1,
      });

      const resumePos = posAt({ currentCycle: laterCycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR, distOffset: offset2 });
      expect(resumePos).toBeCloseTo(0, 6); // resumes from loopStart
    });

    it("with syncOffset: offset is preserved across speed change", () => {
      const cycle = 3;
      const syncOffset = 2; // 2s phase offset

      const oldPos = posAt({ currentCycle: cycle, cps: CPS, speed: 1, loopStart: 0, loopEnd: DUR, syncOffset });

      const offset = computeSyncDistOffset({
        elapsedSec: cycle / CPS,
        oldSpeed: 1, newSpeed: 2,
        oldBegin: 0, newBegin: 0, oldEnd: DUR, newEnd: DUR,
        oldLoopLen: DUR, newLoopLen: DUR,
        syncOffset, oldDistOffset: 0,
      });

      const newPos = posAt({ currentCycle: cycle, cps: CPS, speed: 2, loopStart: 0, loopEnd: DUR, syncOffset, distOffset: offset });
      expect(newPos).toBeCloseTo(oldPos, 6);
    });
  });
});

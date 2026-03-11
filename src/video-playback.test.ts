import { describe, it, expect } from "vitest";
import { computeExpectedTime } from "./video-playback";

describe("computeExpectedTime", () => {
  const dur = 10; // 10s video
  const defaults = { cps: 0.5, speed: 1, loopStart: 0, loopEnd: dur, duration: dur };

  it("starts at loopStart when currentCycle equals eventBegin", () => {
    expect(computeExpectedTime({ ...defaults, currentCycle: 0, eventBegin: 0 })).toBeCloseTo(0);
  });

  it("advances by elapsed seconds × speed", () => {
    // 1 cycle at 0.5 cps = 2 seconds elapsed
    expect(computeExpectedTime({ ...defaults, currentCycle: 1, eventBegin: 0 })).toBeCloseTo(2);
  });

  it("restarts each cycle for per-cycle events", () => {
    // video("a.mp4") produces one event per cycle. Each event has eventBegin at the cycle start.
    // At cycle 0.5: eventBegin=0, elapsed=0.5 cycles = 1s
    expect(computeExpectedTime({ ...defaults, currentCycle: 0.5, eventBegin: 0 })).toBeCloseTo(1);
    // At cycle 1.5: eventBegin=1, elapsed=0.5 cycles = 1s (restarted!)
    expect(computeExpectedTime({ ...defaults, currentCycle: 1.5, eventBegin: 1 })).toBeCloseTo(1);
    // At cycle 2.5: eventBegin=2, elapsed=0.5 cycles = 1s (restarted again!)
    expect(computeExpectedTime({ ...defaults, currentCycle: 2.5, eventBegin: 2 })).toBeCloseTo(1);
  });

  it("plays continuously for slow events spanning many cycles", () => {
    // video("a.mp4").slow(100) — one event with eventBegin=0, spanning 100 cycles
    // At cycle 0.5: 1s into video
    expect(computeExpectedTime({ ...defaults, currentCycle: 0.5, eventBegin: 0 })).toBeCloseTo(1);
    // At cycle 1.5: 3s into video (continuous, not reset)
    expect(computeExpectedTime({ ...defaults, currentCycle: 1.5, eventBegin: 0 })).toBeCloseTo(3);
    // At cycle 2.5: 5s into video
    expect(computeExpectedTime({ ...defaults, currentCycle: 2.5, eventBegin: 0 })).toBeCloseTo(5);
  });

  it("respects speed multiplier", () => {
    expect(computeExpectedTime({ ...defaults, currentCycle: 1, eventBegin: 0, speed: 2 })).toBeCloseTo(4);
  });

  it("wraps around when exceeding loopEnd", () => {
    // 10 cycles at 0.5 cps = 20 seconds, 10s video → wraps to 0
    expect(computeExpectedTime({ ...defaults, currentCycle: 10, eventBegin: 0 })).toBeCloseTo(0);
  });

  it("wraps within sub-range", () => {
    // loopStart=2, loopEnd=6 → 4s range. 5 cycles at 0.5cps = 10s → 10 % 4 = 2 → 2 + 2 = 4
    expect(computeExpectedTime({ ...defaults, currentCycle: 5, eventBegin: 0, loopStart: 2, loopEnd: 6 })).toBeCloseTo(4);
  });

  it("handles negative speed (reverse)", () => {
    // 1 cycle at 0.5 cps = 2s, speed -1 → starts at loopEnd, goes back 2s
    expect(computeExpectedTime({ ...defaults, currentCycle: 1, eventBegin: 0, speed: -1 })).toBeCloseTo(8);
  });

  it("reverse wraps around", () => {
    // 6 cycles at 0.5 cps = 12s backwards from 10 → wraps: 10 - (12 % 10) = 8
    expect(computeExpectedTime({ ...defaults, currentCycle: 6, eventBegin: 0, speed: -1 })).toBeCloseTo(8);
  });

  it("respects eventBegin offset", () => {
    // Event started at cycle 5, now at cycle 6 → 1 cycle elapsed = 2s
    expect(computeExpectedTime({ ...defaults, currentCycle: 6, eventBegin: 5 })).toBeCloseTo(2);
  });

  it("speed 0 stays at loopStart", () => {
    expect(computeExpectedTime({ ...defaults, currentCycle: 100, eventBegin: 0, speed: 0, loopStart: 3 })).toBeCloseTo(3);
  });
});

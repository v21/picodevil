import { describe, it, expect } from "vitest";
import { computeExpectedTime, detectWindowMoving } from "./video-playback";

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

describe("detectWindowMoving", () => {
  const dt = 1 / 60; // one frame at 60fps

  it("returns false on first call (no previous expected)", () => {
    expect(detectWindowMoving({ expected: 2, prevExpected: undefined, wallDt: dt, speed: 1, loopLen: 10 })).toBe(false);
  });

  it("returns false when expected advances at native speed", () => {
    // speed=1, dt=1/60, expected advanced by exactly 1/60s → effective rate = 1
    expect(detectWindowMoving({ expected: 1 + dt, prevExpected: 1, wallDt: dt, speed: 1, loopLen: 10 })).toBe(false);
  });

  it("returns false when expected advances at native speed 2x", () => {
    expect(detectWindowMoving({ expected: 1 + 2 * dt, prevExpected: 1, wallDt: dt, speed: 2, loopLen: 10 })).toBe(false);
  });

  it("returns true when loopStart is sweeping (effective rate differs from speed)", () => {
    // loopStart moves by 0.01s per frame (0.6s/s), speed=1 → effective rate ≈ 1.6
    const loopStartDelta = 0.01;
    expect(detectWindowMoving({ expected: 1 + dt + loopStartDelta, prevExpected: 1, wallDt: dt, speed: 1, loopLen: 10 })).toBe(true);
  });

  it("returns false for loop-boundary wrap (false spike suppression)", () => {
    // loopLen=2, expected jumps from 1.99 to 0.01 — delta≈-1.98, which is >= loopLen/2
    expect(detectWindowMoving({ expected: 0.01, prevExpected: 1.99, wallDt: dt, speed: 1, loopLen: 2 })).toBe(false);
  });

  it("returns false when wallDt is too small to be reliable", () => {
    expect(detectWindowMoving({ expected: 1.5, prevExpected: 1, wallDt: 0.001, speed: 1, loopLen: 10 })).toBe(false);
  });
});

  it("with short video matching cycle duration, wraps at cycle boundary", () => {
    // video("clip/5") with 2s video at cps=0.5: event spans 5 cycles, eventBegin=0
    // At cycle 1 (2s elapsed), 2s video → expected wraps to 0
    // This is the scenario where loop-boundary drift logic matters: el.currentTime≈2
    // but expected=0. The loop-adjusted drift should be 0 (2 mod 2 = 0), not 2.
    const shortDefaults = { cps: 0.5, speed: 1, loopStart: 0, loopEnd: 2, duration: 2 };
    expect(computeExpectedTime({ ...shortDefaults, currentCycle: 1, eventBegin: 0 })).toBeCloseTo(0);
    expect(computeExpectedTime({ ...shortDefaults, currentCycle: 0.5, eventBegin: 0 })).toBeCloseTo(1);
    expect(computeExpectedTime({ ...shortDefaults, currentCycle: 1.5, eventBegin: 0 })).toBeCloseTo(1);
    expect(computeExpectedTime({ ...shortDefaults, currentCycle: 2, eventBegin: 0 })).toBeCloseTo(0);
  });
});

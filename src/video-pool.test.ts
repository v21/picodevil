import { describe, it, expect } from "vitest";
import { scoreFreeElement, computeExpectedFromEvent } from "./video-pool";

describe("scoreFreeElement", () => {
  const dur = 10;

  it("exact match scores 0", () => {
    expect(scoreFreeElement(5, 5, dur)).toBe(0);
  });

  it("element needing forward seek scores lower than one needing backward seek", () => {
    // currentTime=4.9 → needs forward seek of 0.1 to reach target 5
    const needsForward = scoreFreeElement(4.9, 5, dur);
    // currentTime=5.1 → needs backward seek of 0.1 to reach target 5
    const needsBackward = scoreFreeElement(5.1, 5, dur);
    expect(needsForward).toBeLessThan(needsBackward);
  });

  it("closer elements score lower than farther ones", () => {
    const close = scoreFreeElement(4.9, 5, dur);
    const far = scoreFreeElement(3, 5, dur);
    expect(close).toBeLessThan(far);
  });

  it("wrapping: element near end scores well for target near start", () => {
    // currentTime=9.5, target=0.5, dur=10 → forward seek of 1.0 (wrapping)
    const wrapScore = scoreFreeElement(9.5, 0.5, dur);
    // currentTime=5, target=0.5 → backward seek of 4.5
    const farScore = scoreFreeElement(5, 0.5, dur);
    expect(wrapScore).toBeLessThan(farScore);
  });

  it("forward seek of 3s scores better than backward seek of 3s", () => {
    // currentTime=2, target=5 → forward seek 3s
    const forward = scoreFreeElement(2, 5, dur);
    // currentTime=8, target=5 → backward seek 3s
    const backward = scoreFreeElement(8, 5, dur);
    expect(forward).toBeLessThan(backward);
  });
});

describe("computeExpectedFromEvent", () => {
  const cps = 0.5;
  const dur = 10;

  it("returns null when no cached duration", () => {
    expect(computeExpectedFromEvent({}, 0, 0, cps, undefined)).toBeNull();
  });

  it("basic: full video, speed 1, cycle 1 from begin 0", () => {
    // 1 cycle at 0.5 cps = 2s elapsed
    const t = computeExpectedFromEvent({}, 1, 0, cps, dur);
    expect(t).toBeCloseTo(2);
  });

  it("respects begin/end loop region", () => {
    // begin=0.2 → 2s, end=0.6 → 6s on a 10s video → 4s range
    // 5 cycles at 0.5cps = 10s → 10 % 4 = 2 → 2 + 2 = 4
    const ev = { begin: 0.2, end: 0.6 };
    const t = computeExpectedFromEvent(ev, 5, 0, cps, dur);
    expect(t).toBeCloseTo(4);
  });

  it("respects speed", () => {
    const ev = { speed: 2 };
    const t = computeExpectedFromEvent(ev, 1, 0, cps, dur);
    expect(t).toBeCloseTo(4); // 2s * speed 2 = 4s
  });
});

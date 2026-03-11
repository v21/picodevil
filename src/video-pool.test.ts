import { describe, it, expect } from "vitest";
import { scoreFreeElement } from "./video-pool";

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

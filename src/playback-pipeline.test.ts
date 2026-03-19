/**
 * Pipeline tests: verify that pattern chains produce correct video positions
 * through the full eventBeginFromHap → computeExpectedTime pipeline.
 *
 * These tests caught Bug 3 (_onset pre-slow divergence) and would catch
 * any future regression where the wrong eventBegin is derived from a hap.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { video } from "./video-pattern";
import { eventBeginFromHap } from "./event-begin";
import { computeExpectedTime } from "./video-playback";
import { computeExpectedFromEvent } from "./video-pool";
import { addMedia, updateEntry, clearAll } from "./media-registry";
import { setRuntimeCps } from "./config";
import "./visual-controls";
import "./pattern-extensions";

const DUR = 10; // 10-second video
const CPS = 0.5;

/** Query a pattern at a narrow arc around cycle t, return first hap. */
function queryAt(pat: any, t: number) {
  const haps = pat.queryArc(t, t + 0.0001);
  expect(haps.length).toBeGreaterThan(0);
  return haps[0];
}

/** Full pipeline: pattern → hap → eventBegin → expectedTime */
function expectedPosition(pat: any, t: number, duration: number): number {
  const hap = queryAt(pat, t);
  const ev = hap.value;
  const eventBegin = eventBeginFromHap(ev, hap, t);
  const result = computeExpectedFromEvent(ev, t, eventBegin, CPS, duration);
  expect(result).not.toBeNull();
  return result!;
}

describe("playback pipeline: pattern → eventBegin → expectedTime", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    setRuntimeCps(CPS);
  });

  it("simple video: position advances linearly", () => {
    const pat = video("test.mp4");
    // cycle 0.5, eventBegin=0 → elapsed=1s → position=1
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1);
  });

  it("slow(2): continuous across first event", () => {
    const pat = video("test.mp4").slow(2);
    // Event spans 0-2. At cycle 1.5: elapsed = 1.5/0.5 = 3s
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1);
    expect(expectedPosition(pat, 1.0, DUR)).toBeCloseTo(2);
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(3);
  });

  it("slow(2): second event uses correct eventBegin", () => {
    const pat = video("test.mp4").slow(2);
    // Second event spans 2-4. eventBegin should be 2 (not 1 from _onset).
    const hap = queryAt(pat, 2.5);
    const eventBegin = eventBeginFromHap(hap.value, hap, 2.5);
    // This is the Bug 3 regression test: eventBegin must be 2
    expect(eventBegin).toBe(2);
    // Position: elapsed = (2.5-2)/0.5 = 1s
    expect(expectedPosition(pat, 2.5, DUR)).toBeCloseTo(1);
  });

  it("slow(4): eventBegin correct for events 0-3", () => {
    const pat = video("test.mp4").slow(4);
    for (let event = 0; event < 3; event++) {
      const t = event * 4 + 0.5; // mid-event
      const hap = queryAt(pat, t);
      const eventBegin = eventBeginFromHap(hap.value, hap, t);
      expect(eventBegin).toBe(event * 4);
    }
  });

  it("fit() produces correct speed and position", () => {
    // slow(2).fit(): 10s video over 2 cycles (4s). speed = 10*0.5/2 = 2.5
    const pat = video("test.mp4").slow(2).fit();
    const hap = queryAt(pat, 0.5);
    expect(hap.value.speed).toBeCloseTo(2.5);
    // At cycle 0.5: elapsed=1s, speed=2.5 → position=2.5
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(2.5);
  });

  it("fit() ≡ fit().chop(N): same positions at every sample point", () => {
    const base = video("test.mp4").slow(2).begin(0.4).end(0.8).fit();
    const chopped = video("test.mp4").slow(2).begin(0.4).end(0.8).fit().chop(8);

    // Sample across the FIRST event (0-2) and verify positions match
    const points = [0.01, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 1.99];
    for (const t of points) {
      const posBase = expectedPosition(base, t, DUR);
      const posChop = expectedPosition(chopped, t, DUR);
      expect({ t, base: posBase, chopped: posChop, diff: Math.abs(posBase - posChop) })
        .toEqual(expect.objectContaining({
          diff: expect.closeTo(0, 1),
        }));
    }
  });

  it("fit() ≡ fit().chop(N): positions match across event boundary", () => {
    const base = video("test.mp4").slow(2).begin(0.4).end(0.8).fit();
    const chopped = video("test.mp4").slow(2).begin(0.4).end(0.8).fit().chop(8);

    // Sample across the SECOND event boundary (cycle 2+)
    // This is where Bug 3 manifested: _onset=1 (pre-slow) vs hap.whole.begin=2 (post-slow)
    const points = [2.01, 2.25, 2.5, 2.75, 3.0, 3.5, 3.99];
    for (const t of points) {
      const posBase = expectedPosition(base, t, DUR);
      const posChop = expectedPosition(chopped, t, DUR);
      expect({ t, base: posBase, chopped: posChop, diff: Math.abs(posBase - posChop) })
        .toEqual(expect.objectContaining({
          diff: expect.closeTo(0, 1),
        }));
    }
  });

  it("chop(N) sub-events have correct eventBegin from hap.whole.begin", () => {
    const pat = video("test.mp4").chop(4);
    // 4 sub-events per cycle: wholes at 0, 0.25, 0.5, 0.75
    const quarters = [0.1, 0.3, 0.6, 0.8];
    const expectedBegins = [0, 0.25, 0.5, 0.75];
    for (let i = 0; i < quarters.length; i++) {
      const hap = queryAt(pat, quarters[i]);
      const eventBegin = eventBeginFromHap(hap.value, hap, quarters[i]);
      expect(eventBegin).toBeCloseTo(expectedBegins[i]);
    }
  });

  it("slow(2).begin(.4).end(.8).fit(): position is continuous within event", () => {
    const pat = video("test.mp4").slow(2).begin(0.4).end(0.8).fit();
    // Fitted speed: sliceDur=0.4, speed = 0.4*10*0.5/2 = 1.0
    // loopStart=4, loopEnd=8, loopLen=4
    // Position should advance continuously from 4 to 8 over 2 cycles
    let prev = expectedPosition(pat, 0.01, DUR);
    for (let t = 0.1; t < 1.9; t += 0.1) {
      const pos = expectedPosition(pat, t, DUR);
      expect(pos).toBeGreaterThanOrEqual(prev - 0.01); // monotonically increasing (within tolerance)
      prev = pos;
    }
  });

  it("speed(2): position advances at double rate", () => {
    const pat = video("test.mp4").speed(2);
    // At cycle 0.5: elapsed=1s, speed=2 → position=2
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(2);
    // At cycle 1.5 (second event): elapsed=1s, speed=2 → position=2
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(2);
  });
});

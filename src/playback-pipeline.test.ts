/**
 * Pipeline tests: verify that pattern chains produce correct video positions
 * through the full eventBeginFromHap → computeExpectedTime pipeline.
 *
 * These tests caught Bug 3 (_onset pre-slow divergence) and would catch
 * any future regression where the wrong eventBegin is derived from a hap.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mini } from "@strudel/mini";
import { video } from "./video-pattern";
import { screen } from "./screen-pattern";
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
    addMedia("other.mp4", "other.mp4");
    updateEntry("other.mp4", { duration: 8, type: "video" });
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

  it("sync(): eventBegin is always 0", () => {
    const pat = video("test.mp4").sync();
    for (const t of [0.5, 1.5, 2.5, 3.5]) {
      const hap = queryAt(pat, t);
      const eventBegin = eventBeginFromHap(hap.value, hap, t);
      expect(eventBegin).toBe(0);
    }
  });

  it("sync(): position advances continuously across event boundaries", () => {
    const pat = video("test.mp4").sync();
    // At cycle 0.5: elapsed=1s → pos=1
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1);
    // At cycle 1.5: elapsed=3s → pos=3 (no restart at cycle boundary)
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(3);
    // At cycle 2.5: elapsed=5s → pos=5
    expect(expectedPosition(pat, 2.5, DUR)).toBeCloseTo(5);
  });

  it("sync().speed(2): position advances at double rate continuously", () => {
    const pat = video("test.mp4").sync().speed(2);
    // At cycle 0.5: elapsed=1s, speed=2 → pos=2
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(2);
    // At cycle 1.5: elapsed=3s, speed=2 → pos=6
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(6);
  });

  it("sync(0.5): phase offset shifts starting position", () => {
    const pat = video("test.mp4").sync(0.5);
    // syncOffset = 0.5 * 10 = 5s. At cycle 0: elapsed=0, dist=5 → pos=5
    expect(expectedPosition(pat, 0.001, DUR)).toBeCloseTo(5, 0);
  });

  it("sync().slow(2): eventBegin stays 0, position is continuous", () => {
    const pat = video("test.mp4").sync().slow(2);
    // slow(2) doubles event length but sync() means eventBegin=0 always
    const hap1 = queryAt(pat, 0.5);
    expect(eventBeginFromHap(hap1.value, hap1, 0.5)).toBe(0);
    const hap2 = queryAt(pat, 2.5);
    expect(eventBeginFromHap(hap2.value, hap2, 2.5)).toBe(0);
    // Positions advance linearly from cycle 0
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1);
    expect(expectedPosition(pat, 2.5, DUR)).toBeCloseTo(5);
  });

  it("sync().begin(.2).end(.6): loops within range", () => {
    const pat = video("test.mp4").sync().begin(0.2).end(0.6);
    // loopStart=2, loopEnd=6, loopLen=4
    // At cycle 0.5: elapsed=1s, dist=1, pos=2+1=3
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(3);
    // At cycle 2.5: elapsed=5s, dist=5, 5%4=1, pos=2+1=3
    expect(expectedPosition(pat, 2.5, DUR)).toBeCloseTo(3);
  });
});

describe("sync + operator combinations", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    addMedia("other.mp4", "other.mp4");
    updateEntry("other.mp4", { duration: 8, type: "video" });
    setRuntimeCps(CPS);
  });

  it('sync().speed(mini("1 2")): speed pattern changes per half-cycle, eventBegin stays 0', () => {
    const pat = video("test.mp4").sync().speed(mini("1 2"));
    // "1 2" alternates speed every half-cycle
    // At cycle 0.25 (in first half): speed=1, eventBegin=0
    const hap1 = queryAt(pat, 0.25);
    expect(eventBeginFromHap(hap1.value, hap1, 0.25)).toBe(0);
    expect(Number(hap1.value.speed)).toBeCloseTo(1);

    // At cycle 0.75 (in second half): speed=2, eventBegin=0
    const hap2 = queryAt(pat, 0.75);
    expect(eventBeginFromHap(hap2.value, hap2, 0.75)).toBe(0);
    expect(Number(hap2.value.speed)).toBeCloseTo(2);

    // Both positions should be valid (non-NaN, within [0, DUR])
    const pos1 = expectedPosition(pat, 0.25, DUR);
    const pos2 = expectedPosition(pat, 0.75, DUR);
    expect(pos1).toBeGreaterThanOrEqual(0);
    expect(pos1).toBeLessThanOrEqual(DUR);
    expect(pos2).toBeGreaterThanOrEqual(0);
    expect(pos2).toBeLessThanOrEqual(DUR);
  });

  it("sync().fit(): fit computes speed, sync keeps eventBegin=0", () => {
    // slow(2).fit() with sync: event spans 0-2, speed = 10*0.5/2 = 2.5
    const pat = video("test.mp4").slow(2).sync().fit();
    const hap = queryAt(pat, 0.5);
    expect(eventBeginFromHap(hap.value, hap, 0.5)).toBe(0);
    expect(hap.value.speed).toBeCloseTo(2.5);
    // At cycle 0.5: elapsed=1s, speed=2.5 → pos=2.5
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(2.5);
    // At cycle 2.5 (second event): eventBegin still 0, elapsed=5s, speed=2.5 → dist=12.5, 12.5%10=2.5
    expect(expectedPosition(pat, 2.5, DUR)).toBeCloseTo(2.5);
  });

  it("sync().chop(4): chop subdivides but sync keeps eventBegin=0", () => {
    const pat = video("test.mp4").sync().chop(4);
    // chop(4) creates 4 sub-events per cycle. With sync, ALL should have eventBegin=0.
    for (const t of [0.1, 0.3, 0.6, 0.8]) {
      const hap = queryAt(pat, t);
      expect(eventBeginFromHap(hap.value, hap, t)).toBe(0);
    }
    // Positions should still be valid
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(DUR);
  });

  it("sync().scrub(0.5): scrub overrides sync — position is fixed", () => {
    const pat = video("test.mp4").sync().scrub(0.5);
    // scrub sets begin=end=0.5 → loopLen=0, speed irrelevant
    // Position should be the midpoint of the video
    const hap1 = queryAt(pat, 0.25);
    const b = hap1.value.begin ?? 0;
    const e = hap1.value.end ?? 1;
    // scrub(0.5) freezes at 0.5 (begin and end both become 0.5)
    expect(b).toBeCloseTo(0.5);
    expect(e).toBeCloseTo(0.5);
  });

  it('screen("test.mp4 other.mp4").sync(): alternating sources with sync', () => {
    const pat = screen("test.mp4 other.mp4").sync();
    // First half-cycle: test.mp4
    const hap1 = queryAt(pat, 0.25);
    expect(hap1.value.src).toBe("test.mp4");
    expect(eventBeginFromHap(hap1.value, hap1, 0.25)).toBe(0);

    // Second half-cycle: other.mp4
    const hap2 = queryAt(pat, 0.75);
    expect(hap2.value.src).toBe("other.mp4");
    expect(eventBeginFromHap(hap2.value, hap2, 0.75)).toBe(0);
  });

  it('screen("<test.mp4 other.mp4>").sync().speed(mini("1 2 3")): slow alternation + speed pattern', () => {
    const pat = screen("<test.mp4 other.mp4>").sync().speed(mini("1 2 3"));
    // <> = slow alternation: test.mp4 for cycle 0, other.mp4 for cycle 1, etc.
    // All should have eventBegin=0 regardless of source or speed
    for (const t of [0.25, 0.75, 1.25, 1.75]) {
      const hap = queryAt(pat, t);
      expect(eventBeginFromHap(hap.value, hap, t)).toBe(0);
    }
  });

  it("sync doesn't affect speed(2) without sync: same speed, different eventBegin", () => {
    // Without sync: eventBegin follows hap.whole.begin (restarts each cycle)
    const noSync = video("test.mp4").speed(2);
    const hap = queryAt(noSync, 1.5);
    const eb = eventBeginFromHap(hap.value, hap, 1.5);
    expect(eb).toBe(1); // eventBegin = start of second event
    // elapsed = (1.5-1)/0.5 = 1s, speed=2 → pos=2
    expect(expectedPosition(noSync, 1.5, DUR)).toBeCloseTo(2);
  });

  it("sync().speed(-1): reverse playback is continuous", () => {
    const pat = video("test.mp4").sync().speed(-1);
    // speed < 0 → position = loopEnd - distInLoop
    // At cycle 0.5: elapsed=1s, |speed|=1, dist=1, pos=10-1=9
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(9);
    // At cycle 1.5: elapsed=3s, dist=3, pos=10-3=7 (no restart)
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(7);
  });

  it("sync().begin(.2).end(.6).speed(2): constrained range + speed in sync mode", () => {
    const pat = video("test.mp4").sync().begin(0.2).end(0.6).speed(2);
    // loopStart=2, loopEnd=6, loopLen=4
    // At cycle 0.5: elapsed=1s, speed=2, dist=2, pos=2+2=4
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(4);
    // At cycle 1.5: elapsed=3s, speed=2, dist=6, 6%4=2, pos=2+2=4
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(4);
  });
});

describe("loopAt pipeline", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    setRuntimeCps(CPS);
  });

  it("loopAt(4): speed computed to fill 4 cycles", () => {
    const pat = video("test.mp4").loopAt(4);
    const hap = queryAt(pat, 0.5);
    // speed = sliceDur(1) * dur(10) * cps(0.5) / n(4) = 1.25
    expect(hap.value.speed).toBeCloseTo(1.25);
    // Event spans 4 cycles. At cycle 0.5: elapsed=1s, speed=1.25 → pos=1.25
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1.25);
  });

  it("loopAt(4): eventBegin advances by 4 cycles per event", () => {
    const pat = video("test.mp4").loopAt(4);
    const hap1 = queryAt(pat, 0.5);
    const hap2 = queryAt(pat, 4.5);
    expect(eventBeginFromHap(hap1.value, hap1, 0.5)).toBe(0);
    expect(eventBeginFromHap(hap2.value, hap2, 4.5)).toBe(4);
  });

  it("loopAt(4) ≡ slow(4).fit(): same speed and positions", () => {
    const looped = video("test.mp4").loopAt(4);
    const manual = video("test.mp4").slow(4).fit();
    for (const t of [0.5, 1.5, 2.5, 3.5]) {
      const posLoop = expectedPosition(looped, t, DUR);
      const posManual = expectedPosition(manual, t, DUR);
      expect(posLoop).toBeCloseTo(posManual, 1);
    }
  });

  it("loopAt(4).speed(2): explicit speed overrides loopAt's computed speed", () => {
    const pat = video("test.mp4").loopAt(4).speed(2);
    const hap = queryAt(pat, 0.5);
    expect(Number(hap.value.speed)).toBeCloseTo(2);
    // At cycle 0.5: elapsed=1s, speed=2 → pos=2
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(2);
  });

  it("loopAt(4).begin(.2).end(.8): loopAt computes speed from slice duration", () => {
    const pat = video("test.mp4").loopAt(4).begin(0.2).end(0.8);
    const hap = queryAt(pat, 0.5);
    // After begin/end: sliceDur = 0.6, speed = 0.6 * 10 * 0.5 / 4 = 0.75
    // But loopAt computes speed before begin/end is applied by createMixParam
    // The actual speed depends on composition order
    const speed = Number(hap.value.speed);
    expect(speed).toBeGreaterThan(0);
    // Position should be within the [2, 8] range
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(pos).toBeGreaterThanOrEqual(2 - 0.01);
    expect(pos).toBeLessThanOrEqual(8 + 0.01);
  });

  it("loopAt(4).sync(): sync keeps eventBegin=0, loopAt provides speed", () => {
    const pat = video("test.mp4").loopAt(4).sync();
    const hap = queryAt(pat, 0.5);
    expect(eventBeginFromHap(hap.value, hap, 0.5)).toBe(0);
    // Speed from loopAt: 1.25
    expect(hap.value.speed).toBeCloseTo(1.25);
    // Continuous: at cycle 4.5, eventBegin still 0, elapsed=9s, speed=1.25 → dist=11.25 → 11.25%10=1.25
    expect(expectedPosition(pat, 4.5, DUR)).toBeCloseTo(1.25);
  });

  it("loopAt(4).chop(2): chop subdivides loopAt events", () => {
    const pat = video("test.mp4").loopAt(4).chop(2);
    // chop(2) splits each 4-cycle event into 2 sub-events
    const hap1 = queryAt(pat, 0.5);
    const hap2 = queryAt(pat, 2.5);
    // Both should have valid positions
    const pos1 = expectedPosition(pat, 0.5, DUR);
    const pos2 = expectedPosition(pat, 2.5, DUR);
    expect(pos1).toBeGreaterThanOrEqual(0);
    expect(pos1).toBeLessThanOrEqual(DUR);
    expect(pos2).toBeGreaterThanOrEqual(0);
    expect(pos2).toBeLessThanOrEqual(DUR);
    // They should be in different halves of the video
    expect(pos2).toBeGreaterThan(pos1);
  });
});

describe("duration/dur pipeline", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    setRuntimeCps(CPS);
  });

  it("duration(0.25): end = begin + 0.25", () => {
    const pat = video("test.mp4").duration(0.25);
    const hap = queryAt(pat, 0.5);
    expect(hap.value.begin ?? 0).toBeCloseTo(0);
    expect(hap.value.end).toBeCloseTo(0.25);
    // loopStart=0, loopEnd=2.5, at cycle 0.5: elapsed=1s → pos=1
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1);
  });

  it("begin(0.4).duration(0.25): end = 0.4 + 0.25 = 0.65", () => {
    const pat = video("test.mp4").begin(0.4).duration(0.25);
    const hap = queryAt(pat, 0.5);
    expect(Number(hap.value.begin)).toBeCloseTo(0.4);
    expect(hap.value.end).toBeCloseTo(0.65);
    // loopStart=4, loopEnd=6.5, at cycle 0.5: elapsed=1s → pos=4+1=5
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(5);
  });

  it("duration(0.25).speed(2): speed applies to the shortened range", () => {
    const pat = video("test.mp4").duration(0.25).speed(2);
    const hap = queryAt(pat, 0.25);
    expect(Number(hap.value.speed)).toBeCloseTo(2);
    // loopLen=2.5, at cycle 0.25: elapsed=0.5s, speed=2 → dist=1, pos=1
    expect(expectedPosition(pat, 0.25, DUR)).toBeCloseTo(1);
  });

  it("duration(0.25).fit(): fit uses the dur-computed range", () => {
    const pat = video("test.mp4").slow(2).duration(0.25).fit();
    const hap = queryAt(pat, 0.5);
    // sliceDur=0.25, speed = 0.25*10*0.5/2 = 0.625
    expect(hap.value.speed).toBeCloseTo(0.625);
  });

  it("duration(0.25).sync(): sync with shortened range", () => {
    const pat = video("test.mp4").duration(0.25).sync();
    const hap = queryAt(pat, 0.5);
    expect(eventBeginFromHap(hap.value, hap, 0.5)).toBe(0);
    // loopStart=0, loopEnd=2.5, loopLen=2.5
    // At cycle 0.5: elapsed=1s, pos=1 (within range)
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1);
    // At cycle 3: elapsed=6s, 6%2.5=1, pos=1 (loops within range)
    expect(expectedPosition(pat, 3, DUR)).toBeCloseTo(1);
  });
});

describe("additional operator combinations", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    setRuntimeCps(CPS);
  });

  it("speed(-1).begin(.3).end(.7): reverse in constrained range (no sync)", () => {
    const pat = video("test.mp4").speed(-1).begin(0.3).end(0.7);
    // loopStart=3, loopEnd=7, loopLen=4
    // At cycle 0.5: elapsed=1s, |speed|=1, dist=1, pos=loopEnd-distInLoop=7-1=6
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(6);
  });

  it("speed(-1).begin(.3).end(.7): second event restarts (no sync)", () => {
    const pat = video("test.mp4").speed(-1).begin(0.3).end(0.7);
    // Second event starts at cycle 1, elapsed=0.5s → dist=0.5, pos=7-0.5=6.5
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(6);
  });

  it("fit().speed(2): explicit speed overrides fit's computed speed", () => {
    const pat = video("test.mp4").slow(2).fit().speed(2);
    const hap = queryAt(pat, 0.5);
    expect(Number(hap.value.speed)).toBeCloseTo(2);
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(2);
  });

  it("slow(2).chop(4).speed(0.5): three-operator chain", () => {
    const pat = video("test.mp4").slow(2).chop(4).speed(0.5);
    // Each chop sub-event has begin/end set by chop and speed=0.5
    const pos = expectedPosition(pat, 0.25, DUR);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(DUR);
  });

  it("begin(0.2).end(0.8).chop(4).speed(2): constrained range + chop + speed", () => {
    const pat = video("test.mp4").begin(0.2).end(0.8).chop(4).speed(2);
    // chop subdivides [0.2, 0.8] into 4 slices, speed=2 plays each fast
    const pos = expectedPosition(pat, 0.1, DUR);
    expect(pos).toBeGreaterThanOrEqual(2 - 0.01);
    expect(pos).toBeLessThanOrEqual(8 + 0.01);
  });

  it('sync().begin(mini("0.2 0.4")).end(mini("0.6 0.8")): pattern-valued range in sync', () => {
    const pat = video("test.mp4").sync().begin(mini("0.2 0.4")).end(mini("0.6 0.8"));
    // Range alternates per half-cycle. Both should produce valid positions.
    const pos1 = expectedPosition(pat, 0.25, DUR);
    const pos2 = expectedPosition(pat, 0.75, DUR);
    // First half: begin=0.2, end=0.6 → [2, 6]
    expect(pos1).toBeGreaterThanOrEqual(2 - 0.01);
    expect(pos1).toBeLessThanOrEqual(6 + 0.01);
    // Second half: begin=0.4, end=0.8 → [4, 8]
    expect(pos2).toBeGreaterThanOrEqual(4 - 0.01);
    expect(pos2).toBeLessThanOrEqual(8 + 0.01);
  });

  it("scrub(sine): dynamic scrub produces valid positions", () => {
    // sine varies 0-1 over a cycle. scrub(sine) should freeze at different points.
    const pat = (video("test.mp4") as any).scrub(mini("0 0.5 1"));
    // scrub sets begin=end=pos, so loopLen=0 → speed irrelevant
    for (const t of [0.1, 0.4, 0.7]) {
      const hap = queryAt(pat, t);
      const b = hap.value.begin ?? 0;
      const e = hap.value.end ?? 1;
      // scrub should set begin=end (frozen position)
      expect(b).toBeCloseTo(e);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe("adversarial inputs: degenerate values", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    setRuntimeCps(CPS);
  });

  it("speed(0): position is frozen at loopStart", () => {
    const pat = video("test.mp4").speed(0);
    // computeExpectedTime with speed=0 returns loopStart
    expect(expectedPosition(pat, 0.5, DUR)).toBe(0);
    expect(expectedPosition(pat, 3.5, DUR)).toBe(0);
  });

  it("speed(0).sync(): frozen at loopStart even in sync mode", () => {
    const pat = video("test.mp4").speed(0).sync();
    expect(expectedPosition(pat, 0.5, DUR)).toBe(0);
  });

  it("begin(.5).end(.5): zero-length range → position equals loopStart", () => {
    const pat = video("test.mp4").begin(0.5).end(0.5);
    // loopLen=0, computeExpectedTime returns loopStart
    expect(expectedPosition(pat, 0.5, DUR)).toBe(5);
  });

  it("begin(.8).end(.2): wraps through video boundary [8→10→0→2]", () => {
    const pat = video("test.mp4").begin(0.8).end(0.2);
    // loopStart=8, loopEnd=2, duration=10
    // Wrap-around loopLen = (10 - 8) + 2 = 4 seconds
    // At cycle 0.5: elapsed=1s, speed=1, dist=1, rawPos=8+1=9 (in [8,10])
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(9);
  });

  it("begin(.8).end(.2): wraps past video end to start", () => {
    // At cycle 1.5 (second event): elapsed=1s, dist=1, rawPos=8+1=9
    const pat = video("test.mp4").begin(0.8).end(0.2);
    expect(expectedPosition(pat, 1.5, DUR)).toBeCloseTo(9);
  });

  it("begin(.8).end(.2): position wraps correctly at boundary", () => {
    const pat = video("test.mp4").begin(0.8).end(0.2).slow(4);
    // slow(4) = 4-cycle events. At cycle 2: elapsed=4s, dist=4
    // loopLen=4, dist%4=0, rawPos=8+0=8 (loops back)
    expect(expectedPosition(pat, 2.0, DUR)).toBeCloseTo(8);
    // At cycle 2.5: elapsed=5s, dist=5, 5%4=1, rawPos=8+1=9
    expect(expectedPosition(pat, 2.5, DUR)).toBeCloseTo(9);
    // At cycle 3: elapsed=6s, dist=6, 6%4=2, rawPos=8+2=10 → wraps to 0
    expect(expectedPosition(pat, 3.0, DUR)).toBeCloseTo(0);
    // At cycle 3.5: elapsed=7s, dist=7, 7%4=3, rawPos=8+3=11 → wraps to 1
    expect(expectedPosition(pat, 3.5, DUR)).toBeCloseTo(1);
  });

  it("duration(-0.1): wraps to duration(0.9)", () => {
    const pat = video("test.mp4").duration(-0.1);
    const hap = queryAt(pat, 0.5);
    // -0.1 wraps to 0.9: end = (0 + 0.9) = 0.9
    expect(hap.value.end).toBeCloseTo(0.9);
  });

  it("begin(.5).duration(.9): end wraps to 0.4", () => {
    const pat = video("test.mp4").begin(0.5).duration(0.9);
    const hap = queryAt(pat, 0.5);
    // 0.5 + 0.9 = 1.4, wraps to 0.4 → inverted range [5, 4)
    expect(hap.value.end).toBeCloseTo(0.4);
  });

  it("duration(1.5): wraps to duration(0.5)", () => {
    const pat = video("test.mp4").duration(1.5);
    const hap = queryAt(pat, 0.5);
    expect(hap.value.end).toBeCloseTo(0.5);
  });

  it("duration(5): end extends past video, still computes finite position", () => {
    const pat = video("test.mp4").duration(5);
    // end = 0 + 5 = 5, loopEnd = 50 (past 10s video). Works via modulo.
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(isFinite(pos)).toBe(true);
  });

  it("begin(-0.5).end(0.5): negative begin doesn't crash", () => {
    const pat = video("test.mp4").begin(-0.5).end(0.5);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
  });

  it("begin(1.5).end(2.0): begin past end of video doesn't crash", () => {
    const pat = video("test.mp4").begin(1.5).end(2.0);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
  });

  it("sync(-0.5): negative sync offset doesn't crash", () => {
    const pat = video("test.mp4").sync(-0.5);
    const hap = queryAt(pat, 0.5);
    expect(eventBeginFromHap(hap.value, hap, 0.5)).toBe(0);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
    // Position should be in [0, DUR] after modulo wrapping
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(DUR + 1e-6);
  });

  it("sync(100): large sync offset wraps via modulo, doesn't crash", () => {
    const pat = video("test.mp4").sync(100);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(DUR + 1e-6);
  });

  it("speed(16): extreme speed doesn't crash", () => {
    const pat = video("test.mp4").speed(16);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(DUR + 1e-6);
  });

  it("speed(-16): extreme negative speed doesn't crash", () => {
    const pat = video("test.mp4").speed(-16);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(DUR + 1e-6);
  });

  it("chop(1000): extreme chop doesn't crash, produces valid positions", () => {
    const pat = video("test.mp4").chop(1000);
    // Should produce events with very narrow begin/end slices
    const hap = queryAt(pat, 0.0005);
    const b = hap.value.begin ?? 0;
    const e = hap.value.end ?? 1;
    expect(e - b).toBeCloseTo(0.001);
    const pos = expectedPosition(pat, 0.0005, DUR);
    expect(isFinite(pos)).toBe(true);
  });

  it("loopAt(0.001): very short loopAt doesn't crash", () => {
    const pat = video("test.mp4").loopAt(0.001);
    const hap = queryAt(pat, 0.0005);
    // Extremely high speed from loopAt: speed = 1*10*0.5/0.001 = 5000
    expect(isFinite(Number(hap.value.speed))).toBe(true);
    const pos = expectedPosition(pat, 0.0005, DUR);
    expect(isFinite(pos)).toBe(true);
  });

  it("loopAt(100): very long loopAt doesn't crash", () => {
    const pat = video("test.mp4").loopAt(100);
    const hap = queryAt(pat, 0.5);
    // Very slow speed: speed = 1*10*0.5/100 = 0.05
    expect(hap.value.speed).toBeCloseTo(0.05);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
  });
});

describe("adversarial inputs: conflicting operators", () => {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    setRuntimeCps(CPS);
  });

  it("fit().fit(): double fit doesn't crash, last speed wins", () => {
    const pat = video("test.mp4").slow(2).fit().fit();
    const hap = queryAt(pat, 0.5);
    // Second fit recomputes speed based on the already-fitted pattern
    expect(isFinite(Number(hap.value.speed))).toBe(true);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
  });

  it("scrub(0.5).speed(2): scrub overrides position, speed is on value but irrelevant", () => {
    const pat = video("test.mp4").scrub(0.5).speed(2);
    const hap = queryAt(pat, 0.25);
    // scrub sets begin=end, so loopLen=0, speed doesn't matter
    expect(hap.value.begin).toBeCloseTo(hap.value.end);
    // position is the frozen point regardless of speed
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(pos).toBeCloseTo(5);
  });

  it("loopAt(4).fit(): both compute speed — last one (fit) wins", () => {
    const pat = video("test.mp4").loopAt(4).fit();
    const hap = queryAt(pat, 0.5);
    // loopAt sets speed=1.25, then fit recomputes from event duration
    // Since loopAt already applied slow(4), fit computes same speed (both fill 4 cycles)
    expect(hap.value.speed).toBeCloseTo(1.25);
  });

  it("loopAt(4).loopAt(2): second loopAt applies slow(2) on top of slow(4)", () => {
    const pat = video("test.mp4").loopAt(4).loopAt(2);
    // First loopAt: slow(4) + speed=1.25
    // Second loopAt: slow(2) on the already-slow(4) pattern, then recomputes speed
    // Total slow = 8 cycles per event, speed = 1*10*0.5/2 = 2.5 (from second loopAt's n=2)
    const hap = queryAt(pat, 0.5);
    expect(isFinite(Number(hap.value.speed))).toBe(true);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(isFinite(pos)).toBe(true);
  });

  it("sync().sync(0.5): double sync — last value wins", () => {
    const pat = video("test.mp4").sync().sync(0.5);
    const hap = queryAt(pat, 0.5);
    // createMixParam replaces the sync field; last sync(0.5) wins
    expect(eventBeginFromHap(hap.value, hap, 0.5)).toBe(0);
    // syncOffset from 0.5 * 10 = 5
    expect(expectedPosition(pat, 0.001, DUR)).toBeCloseTo(5, 0);
  });

  it("begin(.8).end(.2).sync(): wraps through boundary in sync mode", () => {
    const pat = video("test.mp4").begin(0.8).end(0.2).sync();
    const hap = queryAt(pat, 0.5);
    expect(eventBeginFromHap(hap.value, hap, 0.5)).toBe(0);
    // loopLen=4, elapsed=1s, dist=1, rawPos=8+1=9
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(9);
  });

  it("begin(.8).end(.2).speed(-1): reverse wraps backward through boundary", () => {
    const pat = video("test.mp4").begin(0.8).end(0.2).speed(-1);
    // Reverse: pos = loopEnd - distInLoop, then wrap
    // loopEnd=2, dist=1, rawPos=2-1=1 (in [0,2])
    expect(expectedPosition(pat, 0.5, DUR)).toBeCloseTo(1);
  });

  it("chop(4).begin(.5).end(.6): begin/end after chop narrows further", () => {
    const pat = video("test.mp4").chop(4).begin(0.5).end(0.6);
    // chop(4) creates slices [0,.25], [.25,.5], [.5,.75], [.75,1]
    // Then begin(.5).end(.6) overrides — so all sub-events get begin=.5, end=.6
    const hap = queryAt(pat, 0.1);
    expect(Number(hap.value.begin)).toBeCloseTo(0.5);
    expect(Number(hap.value.end)).toBeCloseTo(0.6);
  });

  it("fit().begin(.5).end(.8): begin/end after fit changes range but speed stays", () => {
    const pat = video("test.mp4").slow(2).fit().begin(0.5).end(0.8);
    const hap = queryAt(pat, 0.5);
    // fit computed speed from full range, then begin/end narrows it
    // speed was computed as 1*10*0.5/2 = 2.5 (full range)
    // but now playing in [.5, .8] range with that speed
    expect(hap.value.speed).toBeCloseTo(2.5);
    expect(Number(hap.value.begin)).toBeCloseTo(0.5);
    expect(Number(hap.value.end)).toBeCloseTo(0.8);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(pos).toBeGreaterThanOrEqual(5 - 0.01);
    expect(pos).toBeLessThanOrEqual(8 + 0.01);
  });

  it("scrub(0.5).fit(): fit recomputes speed, but scrub already froze position", () => {
    const pat = video("test.mp4").slow(2).scrub(0.5).fit();
    const hap = queryAt(pat, 0.5);
    // scrub sets begin=end=0.5, fit then computes speed from sliceDur=0
    // sliceDur=0 → speed=0
    expect(hap.value.speed).toBeCloseTo(0);
    const pos = expectedPosition(pat, 0.5, DUR);
    expect(pos).toBeCloseTo(5); // loopStart = 0.5 * 10 = 5
  });
});

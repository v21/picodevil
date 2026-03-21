import { describe, it, expect } from "vitest";
import { computeExpectedTime, computeLoopLen, detectLoopWrap, computeDrift, toLoopOffset, computeEffectiveRate, renderVideoFrame, type VideoEl } from "./video-playback";
import { createVideoState } from "./video-element-state";

/** Create a mock video element for stateful playback tests. */
function mockVideoEl(opts: { duration: number; currentTime?: number }): VideoEl {
  const elState = {
    currentTime: opts.currentTime ?? 0,
    duration: opts.duration,
    paused: true,
    playbackRate: 1,
    src: "test.mp4",
  };
  return {
    _state: createVideoState(),
    get currentTime() { return elState.currentTime; },
    set currentTime(v: number) { elState.currentTime = v; },
    get duration() { return elState.duration; },
    get paused() { return elState.paused; },
    get playbackRate() { return elState.playbackRate; },
    set playbackRate(v: number) { elState.playbackRate = v; },
    get src() { return elState.src; },
    play() { elState.paused = false; return Promise.resolve(); },
    pause() { elState.paused = true; },
  } as unknown as VideoEl;
}

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

  it("syncOffset shifts playback position forward", () => {
    // 10s video, syncOffset = 3s (= 0.3 fraction × 10s duration)
    // At cycle 0 with eventBegin 0: elapsed = 0s, position = 0 + 3 = 3s
    expect(computeExpectedTime({ ...defaults, currentCycle: 0, eventBegin: 0, syncOffset: 3 })).toBeCloseTo(3);
    // At cycle 1: elapsed = 2s, position = 2 + 3 = 5s
    expect(computeExpectedTime({ ...defaults, currentCycle: 1, eventBegin: 0, syncOffset: 3 })).toBeCloseTo(5);
  });

  it("syncOffset wraps around loopEnd", () => {
    // 10s video, syncOffset = 9s, at cycle 1 (2s elapsed): position = (2+9) % 10 = 1s
    expect(computeExpectedTime({ ...defaults, currentCycle: 1, eventBegin: 0, syncOffset: 9 })).toBeCloseTo(1);
  });

  it("syncOffset works with reverse speed", () => {
    // speed = -1, syncOffset = 3s, at cycle 0: position = loopEnd - (0+3)%10 = 10-3 = 7
    expect(computeExpectedTime({ ...defaults, currentCycle: 0, eventBegin: 0, speed: -1, syncOffset: 3 })).toBeCloseTo(7);
  });

describe("computeEffectiveRate (backward delta)", () => {
  const dt = 1 / 60;
  const dur = 10;

  it("returns nominal speed on first frame (no prevExpected)", () => {
    expect(computeEffectiveRate({ expected: 2, prevExpected: undefined, wallDt: dt, duration: dur, nominalSpeed: 1 })).toBe(1);
  });

  it("returns nominal speed when wallDt is too small", () => {
    expect(computeEffectiveRate({ expected: 1.5, prevExpected: 1, wallDt: 0.001, duration: dur, nominalSpeed: 1 })).toBe(1);
  });

  it("returns ~1 when position advances at speed 1", () => {
    const rate = computeEffectiveRate({ expected: 1 + dt, prevExpected: 1, wallDt: dt, duration: dur, nominalSpeed: 1 });
    expect(rate).toBeCloseTo(1, 1);
  });

  it("returns ~2 when position advances at speed 2", () => {
    const rate = computeEffectiveRate({ expected: 1 + 2 * dt, prevExpected: 1, wallDt: dt, duration: dur, nominalSpeed: 2 });
    expect(rate).toBeCloseTo(2, 1);
  });

  it("returns ~5 when begin sweeps forward (begin(saw) scenario)", () => {
    // Position advances by 5 * dt in one frame
    const rate = computeEffectiveRate({ expected: 1 + 5 * dt, prevExpected: 1, wallDt: dt, duration: dur, nominalSpeed: 1 });
    expect(rate).toBeCloseTo(5, 1);
  });

  it("unwraps through video duration boundary", () => {
    // Position wraps from 9.9 to 0.1 (crossed video end) — real delta is 0.2, not -9.8
    const rate = computeEffectiveRate({ expected: 0.1, prevExpected: 9.9, wallDt: dt, duration: dur, nominalSpeed: 1 });
    expect(rate).toBeCloseTo(0.2 / dt, 0);
  });

  it("returns negative rate for reverse playback", () => {
    const rate = computeEffectiveRate({ expected: 1 - dt, prevExpected: 1, wallDt: dt, duration: dur, nominalSpeed: -1 });
    expect(rate).toBeCloseTo(-1, 1);
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

  it("loop wrap: expected jumps back when loop boundary is crossed", () => {
    // Simulates .slow(2).begin(.4).end(.8).fit() — video loops within [0.4*dur, 0.8*dur]
    // dur=10, cps=0.5, speed = 0.4*10*0.5/2 = 1.0
    // loopStart=4, loopEnd=8, loopLen=4
    // At 1x speed, loopLen=4s takes 4 real seconds = 2 cycles at cps=0.5
    const dur = 10;
    const p = { cps: 0.5, speed: 1, loopStart: 4, loopEnd: 8, duration: dur, eventBegin: 0 };

    // Just before wrap: cycle 1.99 → expected near loopEnd
    // elapsed = 1.99/0.5 = 3.98s, dist = 3.98, distInLoop = 3.98 % 4 = 3.98, expected = 4 + 3.98 = 7.98
    const beforeWrap = computeExpectedTime({ ...p, currentCycle: 1.99 });
    expect(beforeWrap).toBeCloseTo(7.98);

    // Just after wrap: cycle 2.01 → expected near loopStart
    const afterWrap = computeExpectedTime({ ...p, currentCycle: 2.01 });
    expect(afterWrap).toBeCloseTo(4.02); // 4 + (2.01/0.5 * 1) % 4 = 4 + 4.02%4 = 4.02

    // The jump from ~8 to ~4 is what the native playback path must detect and seek on.
    // If el.currentTime is still near 8 (browser kept playing), rawDrift ≈ loopLen,
    // and the modular drift check computes drift ≈ 0. Only explicit wrap detection catches this.
    expect(beforeWrap - afterWrap).toBeGreaterThan(3); // jumped backward by ~loopLen
  });

  it("fit() vs fit().chop(8): expected positions match across loop boundary", () => {
    // Simulates: s("snowball").slow(2).begin(.4).end(.8).fit()
    // vs:        s("snowball").slow(2).begin(.4).end(.8).fit().chop(8)
    //
    // dur=10, cps=0.5, fitted speed = 0.4*10*0.5/2 = 1.0
    // Event 1: whole=0-2, _onset=0, begin=0.4, end=0.8
    // Event 2: whole=2-4, _onset=2, begin=0.4, end=0.8
    const dur = 10;
    const cps = 0.5;
    const fittedSpeed = 0.4 * dur * cps / 2; // = 1.0

    // Case 1 (no chop): single event, eventBegin = _onset = 0
    function case1Expected(t: number, eventBegin: number) {
      return computeExpectedTime({
        currentCycle: t, eventBegin, cps,
        speed: fittedSpeed, loopStart: 4, loopEnd: 8, duration: dur,
      });
    }

    // Case 2 (chop 8): sub-events with different begin/end and eventBegin
    // chop(8) on begin=0.4, end=0.8 over whole=0-2:
    //   sub k: whole = k*0.25 to (k+1)*0.25, begin = 0.4 + k*0.05, end = 0.4 + (k+1)*0.05
    // eventBegin = sub-event's whole.begin
    function case2Expected(t: number, eventStartCycle: number) {
      const subIdx = Math.floor((t - eventStartCycle) / 0.25);
      const subStart = eventStartCycle + subIdx * 0.25;
      const subBegin = 0.4 + subIdx * 0.05;
      const subEnd = subBegin + 0.05;
      return computeExpectedTime({
        currentCycle: t, eventBegin: subStart, cps,
        speed: fittedSpeed, loopStart: subBegin * dur, loopEnd: subEnd * dur, duration: dur,
      });
    }

    // Trace several points through the first event (whole=0-2)
    const testPoints = [0.1, 0.5, 0.9, 1.0, 1.5, 1.9];
    for (const t of testPoints) {
      const e1 = case1Expected(t, 0);
      const e2 = case2Expected(t, 0);
      // If this fails, the two cases compute different expected video positions
      expect({ t, case1: e1, case2: e2, diff: e1 - e2 }).toEqual(
        expect.objectContaining({ diff: expect.closeTo(0, 2) })
      );
    }

    // At the loop boundary: new event starts at cycle 2
    // Case 1: eventBegin = 2, full loop [4, 8]
    // Case 2: sub 0 of new event, eventBegin = 2, loop [4, 4.5]
    const resetT = 2.01;
    const e1 = case1Expected(resetT, 2);
    const e2 = case2Expected(resetT, 2);
    expect({ t: resetT, case1: e1, case2: e2, diff: e1 - e2 }).toEqual(
      expect.objectContaining({ diff: expect.closeTo(0, 2) })
    );
  });
});

describe("inverted (wrap-around) ranges", () => {
  const dur = 10;
  // begin=0.8, end=0.2 → loopStart=8, loopEnd=2, plays [8,10)∪[0,2), loopLen=4
  const loopStart = 8, loopEnd = 2;
  const loopLen = computeLoopLen(loopStart, loopEnd, dur); // 4

  it("computeLoopLen returns wrap-around length", () => {
    expect(loopLen).toBe(4);
    // Non-inverted for comparison
    expect(computeLoopLen(2, 8, dur)).toBe(6);
  });

  it("computeExpectedTime wraps position through video boundary", () => {
    const p = { cps: 0.5, speed: 1, loopStart, loopEnd, duration: dur, eventBegin: 0 };
    // At cycle 0: elapsed=0, pos=8 (loopStart)
    expect(computeExpectedTime({ ...p, currentCycle: 0 })).toBeCloseTo(8);
    // At cycle 0.5: elapsed=1s, pos=8+1=9
    expect(computeExpectedTime({ ...p, currentCycle: 0.5 })).toBeCloseTo(9);
    // At cycle 1: elapsed=2s, pos=8+2=10 → wraps to 0
    expect(computeExpectedTime({ ...p, currentCycle: 1 })).toBeCloseTo(0);
    // At cycle 1.5: elapsed=3s, pos=8+3=11 → wraps to 1
    expect(computeExpectedTime({ ...p, currentCycle: 1.5 })).toBeCloseTo(1);
    // At cycle 2: elapsed=4s, 4%4=0, pos=8 → wraps back to loopStart
    expect(computeExpectedTime({ ...p, currentCycle: 2 })).toBeCloseTo(8);
  });

  it("toLoopOffset maps positions to [0, loopLen)", () => {
    // Position 8 (loopStart) → offset 0
    expect(toLoopOffset(8, loopStart, loopEnd, dur)).toBeCloseTo(0);
    // Position 9 → offset 1
    expect(toLoopOffset(9, loopStart, loopEnd, dur)).toBeCloseTo(1);
    // Position 0 (crossed video boundary) → offset 2 (dur - loopStart = 10 - 8 = 2)
    expect(toLoopOffset(0, loopStart, loopEnd, dur)).toBeCloseTo(2);
    // Position 1 → offset 3
    expect(toLoopOffset(1, loopStart, loopEnd, dur)).toBeCloseTo(3);
  });

  it("detectLoopWrap: position crossing video boundary is NOT a loop wrap", () => {
    // Position goes from 9.9 to 0.1 — normal playback crossing video duration
    // In loop-space: 1.9 → 2.1 — advancing forward, not a wrap
    expect(detectLoopWrap({
      expected: 0.1, prevExpected: 9.9, loopStart, loopEnd, loopLen, duration: dur,
    })).toBe(false);
  });

  it("detectLoopWrap: position jumping from near loopEnd to loopStart IS a loop wrap", () => {
    // Position goes from 1.9 (near loopEnd=2) to 8.1 (near loopStart=8)
    // In loop-space: 3.9 → 0.1 — jumped backward by ~loopLen
    expect(detectLoopWrap({
      expected: 8.1, prevExpected: 1.9, loopStart, loopEnd, loopLen, duration: dur,
    })).toBe(true);
  });

  it("computeDrift: small drift near video boundary", () => {
    // el.currentTime=9.95, expected=0.05 — rawDrift=9.9, but actual drift is 0.1
    const drift = computeDrift({
      currentTime: 9.95, expected: 0.05, loopStart, loopEnd, loopLen, duration: dur,
    });
    expect(drift).toBeCloseTo(0.1);
  });

  it("computeDrift: positions on same side of boundary", () => {
    const drift = computeDrift({
      currentTime: 8.5, expected: 8.6, loopStart, loopEnd, loopLen, duration: dur,
    });
    expect(drift).toBeCloseTo(0.1);
  });
});

describe("renderVideoFrame: inverted range stateful behavior", () => {
  const cps = 0.5;

  it("seeks correctly when position wraps through video boundary", () => {
    // begin=0.8, end=0.2, dur=10 → plays [8,10)∪[0,2)
    const el = mockVideoEl({ duration: 10, currentTime: 9.9 });
    const ev = { speed: 1, begin: 0.8, end: 0.2 };

    // Frame near video boundary: cycle ≈ 0.95, expected ≈ 9.9
    renderVideoFrame({ ev, el, currentCycle: 0.95, eventBegin: 0, cps });

    // Frame crossing video boundary: cycle ≈ 1.05, expected ≈ 0.1
    // Browser stalled near end of video while expected crossed to other side
    // rawDrift ≈ 9.7, but through the video boundary, actual drift = |10 - 9.7| = 0.3
    // which exceeds DRIFT_THRESHOLD → must seek to 0.1
    el.currentTime = 9.8;
    renderVideoFrame({ ev, el, currentCycle: 1.05, eventBegin: 0, cps });
    expect(el.currentTime).toBeCloseTo(0.1, 0);
  });

  it("seeks correctly at loop wrap (loopEnd → loopStart)", () => {
    // After playing through [8,10)∪[0,2), should wrap back to 8
    const el = mockVideoEl({ duration: 10, currentTime: 1.9 });
    const ev = { speed: 1, begin: 0.8, end: 0.2 };

    // Prime tracking: frame near loopEnd
    renderVideoFrame({ ev, el, currentCycle: 1.95, eventBegin: 0, cps });

    // Frame after loop wrap: cycle=2.05, expected=8.1
    el.currentTime = 2.0; // browser kept playing past loopEnd
    renderVideoFrame({ ev, el, currentCycle: 2.05, eventBegin: 0, cps });
    expect(el.currentTime).toBeCloseTo(8.1, 0);
  });

  it("does not false-trigger loop wrap when crossing video boundary", () => {
    // Crossing the video duration boundary (9.9→0.1) should NOT be detected
    // as a loop wrap and cause a seek to loopStart
    const el = mockVideoEl({ duration: 10, currentTime: 9.9 });
    const ev = { speed: 1, begin: 0.8, end: 0.2 };

    // Build up tracking state
    renderVideoFrame({ ev, el, currentCycle: 0.9, eventBegin: 0, cps });

    // Cross boundary
    renderVideoFrame({ ev, el, currentCycle: 0.95, eventBegin: 0, cps });
    el.currentTime = 0.05; // browser wrapped correctly
    renderVideoFrame({ ev, el, currentCycle: 1.025, eventBegin: 0, cps });

    // Should be near 0.05, NOT jumped back to 8
    expect(el.currentTime).toBeLessThan(2);
    expect(el.currentTime).toBeGreaterThanOrEqual(0);
  });
});

describe("renderVideoFrame stateful behavior", () => {
  const cps = 0.5;

  it("seeks to correct position on loop wrap", () => {
    // 4s video, loopStart=0, loopEnd=4. At cps=0.5, loop wraps every 2 cycles.
    const el = mockVideoEl({ duration: 4, currentTime: 3.9 });
    const ev = { speed: 1, begin: 0, end: 1 };

    // Frame just before wrap: cycle=1.95, eventBegin=0
    renderVideoFrame({ ev, el, currentCycle: 1.95, eventBegin: 0, cps });

    // Frame just after wrap: cycle=2.05, eventBegin=0
    // expected = (2.05/0.5) % 4 = 4.1 % 4 = 0.1
    // Without loop-wrap detection: if el.currentTime=4.0, rawDrift=3.9,
    // modular drift = min(3.9, |3.9-4|) = 0.1 < 0.15 → missed!
    el.currentTime = 4.0; // simulate browser playing past loopEnd
    renderVideoFrame({ ev, el, currentCycle: 2.05, eventBegin: 0, cps });

    expect(el.currentTime).toBeCloseTo(0.1, 1);
  });

  it("new event boundary resets tracking and seeks", () => {
    const el = mockVideoEl({ duration: 10, currentTime: 5 });
    const ev = { speed: 1, begin: 0, end: 1 };

    // First event
    renderVideoFrame({ ev, el, currentCycle: 2.5, eventBegin: 0, cps });
    expect(el._state.lastEventBegin).toBe(0);

    // New event: eventBegin=3, cycle=3.1 → expected = (3.1-3)/0.5 = 0.2s
    renderVideoFrame({ ev, el, currentCycle: 3.1, eventBegin: 3, cps });
    expect(el._state.lastEventBegin).toBe(3);
    expect(el.currentTime).toBeCloseTo(0.2, 1);
  });

  it("prevExpected captured before overwriting (Bug 2 regression)", () => {
    const el = mockVideoEl({ duration: 4, currentTime: 3.9 });
    const ev = { speed: 1, begin: 0, end: 1 };

    // Prime tracking state: _lastExpected near loopEnd
    renderVideoFrame({ ev, el, currentCycle: 1.9, eventBegin: 0, cps });
    expect(el._state.lastExpected).toBeCloseTo(3.8, 1);

    // Wrap: cycle=2.1, expected≈0.2. prevExpected must be ~3.8 (old value).
    el.currentTime = 3.95;
    renderVideoFrame({ ev, el, currentCycle: 2.1, eventBegin: 0, cps });

    // If prevExpected was correctly captured, wrap detection fires → seek to ~0.2
    expect(el.currentTime).toBeCloseTo(0.2, 0);
    expect(el._state.lastExpected).toBeCloseTo(0.2, 0);
  });

  it("negative speed uses seek mode (not paused, low playbackRate)", () => {
    const el = mockVideoEl({ duration: 10, currentTime: 0 });
    const ev = { speed: -1, begin: 0, end: 1 };

    renderVideoFrame({ ev, el, currentCycle: 0.5, eventBegin: 0, cps });

    expect(el.paused).toBe(false);
    // expected = loopEnd - (1 % 10) = 10 - 1 = 9
    expect(el.currentTime).toBeCloseTo(9, 0);
  });

  it("sync phase offset is applied to playback position", () => {
    // sync(0.3) on a 10s video → syncOffset = 0.3 * 10 = 3s
    // At cycle 0, eventBegin 0: expected = 0 + 3 = 3s
    const el = mockVideoEl({ duration: 10, currentTime: 0 });
    const ev = { speed: 1, begin: 0, end: 1, sync: 0.3 };

    renderVideoFrame({ ev, el, currentCycle: 0, eventBegin: 0, cps });
    expect(el.currentTime).toBeCloseTo(3, 1);
  });

  it("native speed plays and corrects drift", () => {
    const el = mockVideoEl({ duration: 10, currentTime: 0 });
    const ev = { speed: 1, begin: 0, end: 1 };

    // New event at cycle=1, expected=2s, el at 0 → drift > threshold → seek
    renderVideoFrame({ ev, el, currentCycle: 1, eventBegin: 0, cps });
    expect(el.currentTime).toBeCloseTo(2, 1);
    expect(el.paused).toBe(false);
  });
});

/**
 * Multi-frame playback mode tests.
 * Simulate N frames through renderVideoFrame, verify mode selection,
 * effective playback rate, and position continuity.
 */
describe("playback mode selection (multi-frame)", () => {
  const DUR = 10;
  const CPS = 0.5;
  const FPS = 60;
  const dt = CPS / FPS; // cycle increment per frame

  interface FrameResult {
    cycle: number;
    paused: boolean;
    playbackRate: number;
    currentTime: number;
    expected: number; // what computeExpectedTime would give
  }

  /**
   * Run N frames through renderVideoFrame, returning per-frame state.
   * evFn produces the event value for a given cycle (allows dynamic begin/end).
   * The mock element simulates browser behavior: in native mode, currentTime
   * advances by playbackRate * wallDt between frames.
   */
  function runFrames(opts: {
    evFn: (cycle: number) => any;
    frames: number;
    eventBegin?: number;
  }): FrameResult[] {
    const el = mockVideoEl({ duration: DUR, currentTime: 0 });
    const results: FrameResult[] = [];
    const eventBegin = opts.eventBegin ?? 0;
    const wallDt = 1 / FPS;

    for (let i = 0; i < opts.frames; i++) {
      const cycle = i * dt;
      const ev = opts.evFn(cycle);

      renderVideoFrame({ ev, el, currentCycle: cycle, eventBegin, cps: CPS });

      results.push({
        cycle,
        paused: el.paused,
        playbackRate: el.playbackRate,
        currentTime: el.currentTime,
        expected: el.currentTime, // after renderVideoFrame, currentTime ≈ expected
      });

      // Simulate browser advancing between frames (native mode only)
      if (!el.paused) {
        (el as any).currentTime = el.currentTime + el.playbackRate * wallDt;
      }
    }
    return results;
  }

  /** Check that no frame has a position jump > maxJump (in seconds). */
  function assertNoBigJumps(results: FrameResult[], maxJump: number, label: string) {
    for (let i = 1; i < results.length; i++) {
      const delta = Math.abs(results[i].currentTime - results[i - 1].currentTime);
      // Allow jumps near video boundary (wrapping)
      const wrappedDelta = Math.min(delta, Math.abs(delta - DUR));
      expect(wrappedDelta, `${label} frame ${i}: jump=${delta.toFixed(3)}`).toBeLessThan(maxJump);
    }
  }

  /** Check that the element is in native mode (not paused) for most frames. */
  function assertMostlyNative(results: FrameResult[], minNativeFraction: number, label: string) {
    const nativeFrames = results.filter(r => !r.paused).length;
    const fraction = nativeFrames / results.length;
    expect(fraction, `${label}: native fraction=${fraction.toFixed(2)}`).toBeGreaterThanOrEqual(minNativeFraction);
  }

  /** Check that the element is in manual seek mode (paused) for most frames. */
  function assertMostlyManual(results: FrameResult[], minManualFraction: number, label: string) {
    const manualFrames = results.filter(r => r.paused).length;
    const fraction = manualFrames / results.length;
    expect(fraction, `${label}: manual fraction=${fraction.toFixed(2)}`).toBeGreaterThanOrEqual(minManualFraction);
  }

  // --- Basic playback modes ---

  it("speed(2): native mode at 2x", () => {
    const results = runFrames({
      evFn: () => ({ speed: 2, begin: 0, end: 1 }),
      frames: 120,
    });
    assertMostlyNative(results, 0.9, "speed(2)");
    // After warmup, playback rate should be ~2
    const lateRates = results.slice(10).map(r => r.playbackRate);
    expect(lateRates.every(r => Math.abs(r - 2) < 0.5)).toBe(true);
  });

  it("speed(-1): seek mode (not paused)", () => {
    const results = runFrames({
      evFn: () => ({ speed: -1, begin: 0, end: 1 }),
      frames: 120,
    });
    // Seek mode keeps video playing (not paused) at minimum rate
    for (const r of results) {
      expect(r.paused).toBe(false);
    }
  });

  it("speed(0.5): native mode at 0.5x", () => {
    const results = runFrames({
      evFn: () => ({ speed: 0.5, begin: 0, end: 1 }),
      frames: 120,
    });
    assertMostlyNative(results, 0.9, "speed(0.5)");
  });

  it("speed(0): manual seek, frozen frame", () => {
    const results = runFrames({
      evFn: () => ({ speed: 0, begin: 0, end: 1 }),
      frames: 60,
    });
    // speed 0 → effective rate 0 → not native → manual seek
    // All frames should be at loopStart (0)
    for (const r of results) {
      expect(r.currentTime).toBeCloseTo(0, 1);
    }
  });

  // --- Dynamic begin/end (the fixed case) ---

  it("sync().begin(saw).speed(1): seek mode (effective rate differs from speed), positions valid", () => {
    const results = runFrames({
      evFn: (cycle) => ({ speed: 1, begin: cycle % 1, end: 1, sync: true }),
      frames: 240,
    });
    // Effective rate ~5 differs from speed 1 → seek mode (not paused)
    // Check all positions are within valid video range
    for (const r of results) {
      expect(r.paused).toBe(false);
      expect(r.currentTime).toBeGreaterThanOrEqual(-0.1);
      expect(r.currentTime).toBeLessThanOrEqual(DUR + 0.1);
    }
  });

  it("sync().begin(sine): seek mode, positions valid", () => {
    const results = runFrames({
      evFn: (cycle) => ({
        speed: 1,
        begin: 0.5 + 0.4 * Math.sin(Math.PI * 2 * cycle),
        end: 1,
        sync: true,
      }),
      frames: 240,
    });
    for (const r of results) {
      expect(r.currentTime).toBeGreaterThanOrEqual(-0.1);
      expect(r.currentTime).toBeLessThanOrEqual(DUR + 0.1);
    }
  });

  it("sync().end(saw): native mode, smooth", () => {
    const results = runFrames({
      evFn: (cycle) => ({ speed: 1, begin: 0, end: (cycle % 1) || 1, sync: true }),
      frames: 240,
    });
    assertNoBigJumps(results, 2.0, "end(saw).sync()");
  });

  // --- Inverted ranges (wrap-around) ---

  it("begin(.8).end(.2): wraps through video boundary", () => {
    const results = runFrames({
      evFn: () => ({ speed: 1, begin: 0.8, end: 0.2 }),
      frames: 240,
    });
    // Positions should be in [8,10) ∪ [0,2)
    for (const r of results.slice(2)) { // skip first couple frames (setup)
      const inUpper = r.currentTime >= 7.9;
      const inLower = r.currentTime <= 2.1;
      expect(inUpper || inLower, `pos=${r.currentTime.toFixed(2)} not in inverted range`).toBe(true);
    }
  });

  it("begin(.8).end(.2).speed(-1): seek mode, not paused", () => {
    const results = runFrames({
      evFn: () => ({ speed: -1, begin: 0.8, end: 0.2 }),
      frames: 120,
    });
    for (const r of results) {
      expect(r.paused).toBe(false);
    }
  });

  // --- Scrub ---

  it("scrub(sine): smooth scrub, positions are valid", () => {
    const results = runFrames({
      evFn: (cycle) => {
        const scrubVal = 0.5 + 0.5 * Math.sin(Math.PI * 2 * cycle);
        return { speed: 1, begin: scrubVal, end: scrubVal, sync: undefined };
      },
      frames: 120,
    });
    // begin===end → loopLen=0 → speed 0 behavior, positions at loopStart
    for (const r of results) {
      expect(r.currentTime).toBeGreaterThanOrEqual(-0.1);
      expect(r.currentTime).toBeLessThanOrEqual(DUR + 0.1);
    }
  });

  // --- Combined operators ---

  it("sync with speed changes: continuity maintained", () => {
    const results = runFrames({
      evFn: (cycle) => {
        // Alternate speeds every 0.5 cycles (1 second)
        const speeds = [1, 2, 4];
        const idx = Math.floor(cycle * 2) % speeds.length;
        return { speed: speeds[idx], begin: 0, end: 1, sync: true };
      },
      frames: 360,
    });
    assertMostlyNative(results, 0.8, "sync speed changes");
    assertNoBigJumps(results, 2.0, "sync speed changes");
  });

  it("sync().begin(saw).speed(8): high effective rate, stays native if within range", () => {
    const results = runFrames({
      evFn: (cycle) => ({ speed: 8, begin: cycle % 1, end: 1, sync: true }),
      frames: 120,
    });
    // Effective rate ≈ speed(8) + begin sweep ≈ 13, still within native range [0.0625, 16]
    // Should be mostly native
    assertMostlyNative(results, 0.7, "begin(saw).speed(8).sync()");
  });

  it("speed(20): seek mode (not paused)", () => {
    const results = runFrames({
      evFn: () => ({ speed: 20, begin: 0, end: 1 }),
      frames: 60,
    });
    for (const r of results) {
      expect(r.paused).toBe(false);
    }
  });

  // --- Edge cases ---

  it("begin(.5).end(.5): zero-length range, frozen frame at begin", () => {
    const results = runFrames({
      evFn: () => ({ speed: 1, begin: 0.5, end: 0.5 }),
      frames: 60,
    });
    for (const r of results) {
      expect(r.currentTime).toBeCloseTo(5, 0); // loopStart = 0.5 * 10 = 5
    }
  });

  it("begin(.5).duration(.9) wraps to end=0.4, inverted range", () => {
    // begin=0.5, dur=0.9 → end = (0.5+0.9)%1 = 0.4
    // loopStart=5, loopEnd=4, inverted range [5,10)∪[0,4)
    const results = runFrames({
      evFn: () => ({ speed: 1, begin: 0.5, end: 0.4 }),
      frames: 240,
    });
    // Positions should be in [5,10) ∪ [0,4)
    for (const r of results.slice(2)) {
      const inUpper = r.currentTime >= 4.9;
      const inLower = r.currentTime <= 4.1;
      expect(inUpper || inLower, `pos=${r.currentTime.toFixed(2)} not in inverted range [5,10)∪[0,4)`).toBe(true);
    }
  });
});

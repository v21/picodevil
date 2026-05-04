/**
 * Shared setup and helpers for playback simulation test files.
 * Import from this module instead of duplicating setup across files.
 *
 * Call setupSimulation() inside a describe() block to register the standard
 * beforeEach that populates the media registry and sets CPS.
 */
import { beforeEach, expect } from "vitest";
import { eventBeginFromHap } from "./event-begin";
import { computeExpectedTime, computeLoopLen } from "./video-playback";
import { computeSyncDistOffset } from "./sync-continuity";
import { addMedia, updateEntry, clearAll } from "./media-registry";
import { setRuntimeCps } from "./config";
import { transpile } from "./transpiler";
import { getPatternGlobals } from "./eval-sandbox";
import "./visual-controls";
import "./pattern-extensions";

export const DUR = 10; // default test video duration (seconds)
export const CPS = 0.5;

export interface TracePoint {
  cycle: number;
  eventBegin: number;
  expected: number;
  speed: number;
  loopStart: number;
  loopEnd: number;
}

/**
 * Evaluate a pattern expression string exactly as the editor would, using the
 * transpiler (double-quoted strings → mini()) and the same globals as main.ts.
 */
export function evalPattern(expr: string): any {
  const { code } = transpile(`var __pat = (${expr});`);
  const globals = getPatternGlobals();
  const names = Object.keys(globals);
  const values = Object.values(globals);
  const fn = new Function(...names, `${code}\nreturn __pat;`);
  return fn(...values);
}

/**
 * Step through a pattern at ~60fps, recording the playback trace.
 * Simulates per-element sync continuity state to mirror the real render loop.
 */
export function simulateTrace(pat: any, cycles: number, duration: number): TracePoint[] {
  const fps = 60;
  const trace: TracePoint[] = [];
  const dt = CPS / fps;

  let lastSyncSpeed: number | undefined;
  let lastSyncBegin: number | undefined;
  let lastSyncEnd: number | undefined;
  let syncDistOffset = 0;
  let lastEventBegin: number | undefined;

  for (let cycle = 0; cycle < cycles; cycle += dt) {
    const haps = pat.queryArc(cycle, cycle + 0.0001);
    if (haps.length === 0) continue;

    const hap = haps[0];
    const ev = hap.value;
    const eventBegin = eventBeginFromHap(ev, hap, cycle);

    const speed = ev.speed != null ? Number(ev.speed) : 1;
    const beginVal = ev.begin ?? 0;
    const endVal = ev.end ?? 1;
    const loopStart = beginVal * duration;
    const loopEnd = endVal * duration;
    const loopLen = computeLoopLen(loopStart, loopEnd, duration);
    const synced = ev.sync != null;
    const rolling = ev.rolling != null;
    const syncOffset = synced && ev.sync !== true ? Number(ev.sync) * duration : 0;

    if (lastEventBegin !== eventBegin) {
      lastEventBegin = eventBegin;
      if (!rolling) {
        lastSyncSpeed = undefined;
        lastSyncBegin = undefined;
        lastSyncEnd = undefined;
        syncDistOffset = 0;
      }
    }

    if ((synced || rolling) && loopLen > 0) {
      const speedChanged = lastSyncSpeed != null && lastSyncSpeed !== speed;
      const beginChanged = lastSyncBegin != null && lastSyncBegin !== beginVal;
      const endChanged = lastSyncEnd != null && lastSyncEnd !== endVal;

      if (speedChanged || beginChanged || endChanged) {
        const elapsedSec = (cycle - eventBegin) / CPS;
        const oldBeginSec = (lastSyncBegin ?? beginVal) * duration;
        const oldEndSec = (lastSyncEnd ?? endVal) * duration;
        syncDistOffset = computeSyncDistOffset({
          elapsedSec,
          oldSpeed: lastSyncSpeed ?? speed,
          newSpeed: speed,
          oldBegin: oldBeginSec,
          newBegin: loopStart,
          oldEnd: oldEndSec,
          newEnd: loopEnd,
          oldLoopLen: computeLoopLen(oldBeginSec, oldEndSec, duration),
          newLoopLen: loopLen,
          syncOffset,
          oldDistOffset: syncDistOffset,
          duration,
          rolling,
        });
      }

      lastSyncSpeed = speed;
      lastSyncBegin = beginVal;
      lastSyncEnd = endVal;
    } else {
      lastSyncSpeed = undefined;
      lastSyncBegin = undefined;
      lastSyncEnd = undefined;
      syncDistOffset = 0;
    }

    const distOffset = (synced || rolling) ? syncDistOffset : 0;
    const expected = computeExpectedTime({
      currentCycle: cycle, eventBegin, cps: CPS,
      speed, loopStart, loopEnd, duration, syncOffset, distOffset,
    });

    trace.push({ cycle, eventBegin, expected, speed, loopStart, loopEnd });
  }

  return trace;
}

/** Verify trace invariants: no NaN, position in range, frame-to-frame continuity. */
export function checkTraceInvariants(trace: TracePoint[], label: string, duration = DUR) {
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    const loopLen = computeLoopLen(p.loopStart, p.loopEnd, duration);

    expect(p.expected, `${label} [${i}] expected is finite`).toSatisfy((v: number) => isFinite(v));
    expect(p.eventBegin, `${label} [${i}] eventBegin is finite`).toSatisfy((v: number) => isFinite(v));

    if (p.loopEnd > p.loopStart) {
      expect(p.expected, `${label} [${i}] expected >= loopStart`).toBeGreaterThanOrEqual(p.loopStart - 1e-6);
      expect(p.expected, `${label} [${i}] expected <= loopEnd`).toBeLessThanOrEqual(p.loopEnd + 1e-6);
    } else if (p.loopStart > p.loopEnd && loopLen > 0) {
      const inUpperRange = p.expected >= p.loopStart - 1e-6;
      const inLowerRange = p.expected <= p.loopEnd + 1e-6;
      expect(inUpperRange || inLowerRange, `${label} [${i}] expected in inverted range: ${p.expected}`).toBe(true);
    }

    if (i > 0) {
      const prev = trace[i - 1];
      const sameEvent = Math.abs(p.eventBegin - prev.eventBegin) < 0.001;
      const sameLoop = Math.abs(p.loopStart - prev.loopStart) < 0.001
        && Math.abs(p.loopEnd - prev.loopEnd) < 0.001;

      if (sameEvent && sameLoop && loopLen > 0) {
        let delta: number;
        if (p.loopStart > p.loopEnd) {
          const toLoopOffset = (pos: number) =>
            pos >= p.loopStart ? pos - p.loopStart : pos + (duration - p.loopStart);
          const off1 = toLoopOffset(prev.expected);
          const off2 = toLoopOffset(p.expected);
          const rawOff = Math.abs(off2 - off1);
          delta = Math.min(rawOff, loopLen - rawOff);
        } else {
          const rawDelta = Math.abs(p.expected - prev.expected);
          delta = Math.min(rawDelta, Math.abs(rawDelta - loopLen));
        }
        const cycleDt = p.cycle - prev.cycle;
        const maxSpeed = Math.max(Math.abs(p.speed), Math.abs(prev.speed));
        const maxDelta = cycleDt * maxSpeed / CPS + 0.01;
        expect(delta, `${label} [${i}] continuity: delta=${delta.toFixed(4)} > max=${maxDelta.toFixed(4)}`).toBeLessThanOrEqual(maxDelta);
      }
    }
  }
}

/** Compare two traces point by point, allowing position tolerance. */
export function assertTracesMatch(a: TracePoint[], b: TracePoint[], label: string, tolerance = 0.05) {
  const bMap = new Map<string, TracePoint>();
  for (const p of b) bMap.set(p.cycle.toFixed(6), p);

  let matched = 0;
  for (const pa of a) {
    const key = pa.cycle.toFixed(6);
    const pb = bMap.get(key);
    if (!pb) continue;
    matched++;

    const loopLen = Math.abs(pa.loopEnd - pa.loopStart);
    const rawDiff = Math.abs(pa.expected - pb.expected);
    const diff = loopLen > 0 ? Math.min(rawDiff, Math.abs(rawDiff - loopLen)) : rawDiff;
    expect(diff, `${label} at cycle=${pa.cycle.toFixed(4)}: ${pa.expected.toFixed(3)} vs ${pb.expected.toFixed(3)}`).toBeLessThanOrEqual(tolerance);
  }
  expect(matched, `${label}: should have matched points`).toBeGreaterThan(10);
}

/**
 * Call inside a describe() block to register a beforeEach that clears the
 * media registry and registers the standard test videos:
 *   - "test.mp4" with duration 10s
 *   - "other.mp4" with duration 8s
 */
export function setupSimulation() {
  beforeEach(() => {
    clearAll();
    addMedia("test.mp4", "test.mp4");
    updateEntry("test.mp4", { duration: DUR, type: "video" });
    addMedia("other.mp4", "other.mp4");
    updateEntry("other.mp4", { duration: 8, type: "video" });
    setRuntimeCps(CPS);
  });
}

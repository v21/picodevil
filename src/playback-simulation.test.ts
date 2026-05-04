/**
 * Time-stepping simulation tests: basic, sync, rolling, loopAt, duration,
 * and multi-operator pattern chains.
 *
 * Adversarial/degenerate cases → playback-simulation-adversarial.test.ts
 * Equivalence class tests      → playback-simulation-equivalence.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  evalPattern, simulateTrace, checkTraceInvariants,
  setupSimulation, DUR,
} from "./playback-simulation-helpers";

const patterns: string[] = [
  'video("test.mp4")',
  'video("test.mp4").slow(4)',
  'video("test.mp4").slow(2).begin(.4).end(.8)',
  'video("test.mp4").slow(2).begin(.4).end(.8).fit()',
  'video("test.mp4").slow(2).begin(.4).end(.8).fit().chop(8)',
  'video("test.mp4").speed(2)',
  'video("test.mp4").speed(-1)',
  'video("test.mp4").speed(0.5).slow(4)',
  'video("test.mp4").chop(4)',
  'video("test.mp4").chop(4).speed(2)',
  // Sync mode: basic
  'video("test.mp4").sync()',
  'video("test.mp4").sync().speed(2)',
  'video("test.mp4").sync().speed(-1)',
  'video("test.mp4").sync().slow(4)',
  'video("test.mp4").sync().begin(.2).end(.6)',
  'video("test.mp4").sync(0.3)',
  'video("test.mp4").sync(0.5).speed(2)',
  // Sync mode: operator combinations
  'video("test.mp4").sync().speed("1 2")',
  'video("test.mp4").slow(2).sync().fit()',
  'video("test.mp4").sync().chop(4)',
  'video("test.mp4").sync().chop(4).speed(2)',
  'video("test.mp4").sync().begin(.2).end(.6).speed(2)',
  'video("test.mp4").sync().speed(-1).begin(.3).end(.7)',
  'screen("<test.mp4 other.mp4>").sync()',
  'screen("<test.mp4 other.mp4>").sync().speed("1 2 3")',
  'video("test.mp4").sync().scrub(0.5)',
  // Rolling mode
  'video("test.mp4").rolling()',
  'video("test.mp4").speed("0 1").rolling()',
  'video("test.mp4").speed("-1 0").rolling()',
  'video("test.mp4").speed("1 -1 -1 1").rolling()',
  'video("test.mp4").speed("0.5 1 2").rolling()',
  'video("test.mp4").speed("0.005 1000").rolling()',
  'video("test.mp4").speed(sine).rolling()',
  // loopAt combinations
  'video("test.mp4").loopAt(4)',
  'video("test.mp4").loopAt(4).speed(2)',
  'video("test.mp4").loopAt(4).sync()',
  'video("test.mp4").loopAt(4).begin(.2).end(.8)',
  'video("test.mp4").loopAt(4).chop(2)',
  // duration combinations
  'video("test.mp4").duration(0.25)',
  'video("test.mp4").begin(.4).duration(.25)',
  'video("test.mp4").duration(.25).speed(2)',
  'video("test.mp4").duration(.25).sync()',
  // Reverse speed + constrained range (no sync)
  'video("test.mp4").speed(-1).begin(.3).end(.7)',
  'video("test.mp4").speed(-1).slow(2)',
  // fit + speed
  'video("test.mp4").slow(2).fit().speed(2)',
  // Pattern-valued begin/end with sync
  'video("test.mp4").sync().begin("0.2 0.4").end("0.6 0.8")',
  // Multi-operator chains
  'video("test.mp4").slow(2).chop(4).speed(0.5)',
  'video("test.mp4").begin(.2).end(.8).chop(4).speed(2)',
  // scrub with pattern
  'video("test.mp4").scrub("0 0.5 1")',
];

describe("playback simulation", () => {
  setupSimulation();

  for (const expr of patterns) {
    it(`trace invariants hold for: ${expr}`, () => {
      const pat = evalPattern(expr);
      const trace = simulateTrace(pat, 4, DUR);
      expect(trace.length).toBeGreaterThan(0);
      checkTraceInvariants(trace, expr);
    });
  }
});

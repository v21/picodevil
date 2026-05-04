/**
 * Time-stepping simulation tests: degenerate arguments and conflicting
 * operator combinations. These run in a separate file so they execute in
 * parallel with the main playback-simulation.test.ts browser iframe.
 *
 * Basic/sync/rolling cases    → playback-simulation.test.ts
 * Equivalence class tests     → playback-simulation-equivalence.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  evalPattern, simulateTrace, checkTraceInvariants,
  setupSimulation, DUR,
} from "./playback-simulation-helpers";

const patterns: string[] = [
  // Adversarial: degenerate arguments
  'video("test.mp4").speed(0)',
  'video("test.mp4").speed(16)',
  'video("test.mp4").speed(-16)',
  'video("test.mp4").speed(0.001)',
  'video("test.mp4").begin(.8).end(.2)',
  'video("test.mp4").begin(.5).end(.5)',
  'video("test.mp4").begin(0).end(0)',
  'video("test.mp4").begin(1.5).end(2.0)',
  'video("test.mp4").begin(-0.5).end(0.5)',
  'video("test.mp4").duration(0)',
  'video("test.mp4").duration(-0.5)',
  'video("test.mp4").duration(5)',
  'video("test.mp4").loopAt(0.001)',
  'video("test.mp4").loopAt(100)',
  'video("test.mp4").chop(1)',
  'video("test.mp4").chop(1000)',
  'video("test.mp4").sync(-0.5)',
  'video("test.mp4").sync(100)',
  // Adversarial: conflicting operator combinations
  'video("test.mp4").slow(2).fit().fit()',
  'video("test.mp4").scrub(0.5).speed(2)',
  'video("test.mp4").slow(2).scrub(0.5).fit()',
  'video("test.mp4").loopAt(4).fit()',
  'video("test.mp4").loopAt(4).loopAt(2)',
  'video("test.mp4").sync().sync(0.5)',
  'video("test.mp4").speed(0).sync()',
  'video("test.mp4").slow(2).speed(0).fit()',
  'video("test.mp4").begin(.8).end(.2).speed(-1)',
  'video("test.mp4").begin(.8).end(.2).sync()',
  // Sync with dynamically changing end creating inverted ranges (slider/sine scenario)
  'video("test.mp4").sync().begin(1).end("0.2 0.5 0.8")',
  'video("test.mp4").sync().begin("0.8 0.9 1").end("0.2 0.4")',
  'video("test.mp4").chop(4).begin(.5).end(.6)',
  'video("test.mp4").slow(2).fit().begin(.5).end(.8)',
];

describe("playback simulation (adversarial)", () => {
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

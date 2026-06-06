/**
 * Unit tests for the example-benchmark baseline logic (test/baseline.ts).
 *
 * These are browser-free pure-function tests — they encode the core contract
 * the user asked for: editing an example's code must INVALIDATE its baseline
 * (STALE / recapture), not BREAK the run as a regression. A regression is only
 * ever reported when the code is unchanged (hash matches) but got slower.
 */
import { describe, it, expect } from "vitest";
import {
  codeHashHex,
  classify,
  type PerfEntry,
  type PerfMetrics,
  type RegressTolerance,
} from "../test/baseline";

const TOL: RegressTolerance = { pct: 0.25, absMs: 3 };

function metrics(p95: number): PerfMetrics {
  return {
    p50: p95 * 0.5,
    p95,
    p99: p95 * 1.2,
    max: p95 * 2,
    frameCount: 300,
    phases: {
      query: { p50: 0, p95: 0 },
      assign: { p50: 0, p95: 0 },
      draw: { p50: 0, p95: 0 },
      prewarm: { p50: 0, p95: 0 },
    },
  };
}

function entry(codeHash: string, p95: number): PerfEntry {
  return { codeHash, metrics: metrics(p95) };
}

describe("codeHashHex", () => {
  it("is stable for the same code", () => {
    expect(codeHashHex("$: s(\"red\")")).toBe(codeHashHex("$: s(\"red\")"));
  });

  it("an edit flips the hash (the 'edits invalidate' guarantee)", () => {
    const a = "$: s(\"red\")";
    expect(codeHashHex(a)).not.toBe(codeHashHex(a + " "));
    expect(codeHashHex(a)).not.toBe(codeHashHex(a + "\n"));
  });

  it("returns an 8-char hex string", () => {
    const h = codeHashHex("anything");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("classify", () => {
  it("NEW when there is no baseline entry", () => {
    expect(classify(null, "aaaa", metrics(10), TOL).status).toBe("NEW");
    expect(classify(undefined, "aaaa", metrics(10), TOL).status).toBe("NEW");
  });

  it("STALE when the code hash differs — regardless of perf", () => {
    const base = entry("OLDHASH1", 10);
    // Even if the new run is wildly slower, a hash mismatch is STALE, not REGRESSION.
    expect(classify(base, "NEWHASH2", metrics(1000), TOL).status).toBe("STALE");
    // And if it's faster, still STALE.
    expect(classify(base, "NEWHASH2", metrics(1), TOL).status).toBe("STALE");
  });

  it("OK when hash matches and p95 is within tolerance", () => {
    const base = entry("H", 10);
    // +20% < 25% relative budget
    expect(classify(base, "H", metrics(12), TOL).status).toBe("OK");
  });

  it("REGRESSION when hash matches and p95 exceeds tolerance", () => {
    const base = entry("H", 10);
    // +75% blows past both the 25% relative and +3ms absolute budgets
    const c = classify(base, "H", metrics(17.5), TOL);
    expect(c.status).toBe("REGRESSION");
  });

  it("absolute noise floor prevents tiny baselines from flapping", () => {
    const base = entry("H", 2);
    // 2ms -> 4ms is +100% relative, but within the +3ms absolute floor -> OK
    expect(classify(base, "H", metrics(4), TOL).status).toBe("OK");
    // 2ms -> 6ms exceeds the +3ms floor (budget = max(2.5, 5) = 5) -> REGRESSION
    expect(classify(base, "H", metrics(6), TOL).status).toBe("REGRESSION");
  });

  it("hard ceiling flags an absolute regression even within relative budget", () => {
    const base = entry("H", 30);
    const tol: RegressTolerance = { pct: 0.25, absMs: 3, hardCeilingMs: 32 };
    // 33ms is within 30*1.25=37.5 relative budget, but over the 32ms hard ceiling
    expect(classify(base, "H", metrics(33), tol).status).toBe("REGRESSION");
  });

  it("reports deltaPct vs baseline when the hash matches", () => {
    const base = entry("H", 10);
    const c = classify(base, "H", metrics(11), TOL);
    expect(c.deltaPct).toBeCloseTo(0.1, 5);
  });
});

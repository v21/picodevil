/**
 * Pure, browser-safe baseline logic for the example perf benchmark.
 *
 * This module deliberately imports NOTHING node-only (no `fs`) so it can be
 * imported from a vitest browser test (`src/baseline.test.ts`). File IO lives
 * in `test/baseline-io.ts`.
 *
 * The core idea: each baseline entry is keyed by a content hash of the
 * example's code. Editing an example flips its hash, which `classify()` reports
 * as STALE ("recapture") rather than REGRESSION ("you broke perf"). A real
 * regression — code unchanged (hash matches) but measurably slower — is the
 * only status that should fail a run.
 */

import { hashStr } from "../src/layout-counter";

/** FNV-1a 32-bit hash of the code, as a stable 8-char hex string. */
export function codeHashHex(code: string): string {
  return hashStr(code).toString(16).padStart(8, "0");
}

export interface PhaseStat {
  p50: number;
  p95: number;
}

export interface PerfMetrics {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  frameCount: number;
  phases: {
    query: PhaseStat;
    assign: PhaseStat;
    draw: PhaseStat;
    prewarm: PhaseStat;
  };
}

export interface PerfEntry {
  codeHash: string;
  metrics: PerfMetrics;
}

export interface PerfBaseline {
  schemaVersion: number;
  capturedAt: string;
  env: {
    viewport: [number, number];
    durationMs: number;
    headless: boolean;
    mediaSeedSource: string;
  };
  examples: Record<string, PerfEntry>;
}

/** Tolerance for the regression check: p95 may grow by `pct` fraction OR `absMs`, whichever is larger. */
export interface RegressTolerance {
  /** Relative slack, e.g. 0.25 = 25%. */
  pct: number;
  /** Absolute slack in ms (noise floor so tiny baselines don't flap). */
  absMs: number;
  /** Optional absolute ceiling: p95 above this is a regression regardless of baseline. */
  hardCeilingMs?: number;
}

export type Status = "NEW" | "STALE" | "OK" | "REGRESSION";

export interface Classification {
  status: Status;
  /** The p95 budget that `metrics.p95` was checked against (undefined unless OK/REGRESSION). */
  budgetP95?: number;
  /** Fractional delta vs baseline p95 (e.g. +0.12), undefined unless hash matched. */
  deltaPct?: number;
}

/**
 * Classify the current measurement of one example against its stored baseline.
 *
 * - no baseline entry           -> NEW         (capture needed; not a failure)
 * - baseline hash != codeHash    -> STALE       (code edited; recapture; not a failure)
 * - hash matches, within budget  -> OK
 * - hash matches, over budget    -> REGRESSION  (the only failing status)
 *
 * Regression is gated behind a hash match, so a slow-down on *edited* code is
 * always STALE, never REGRESSION — the "edits invalidate, not break" guarantee.
 */
export function classify(
  entry: PerfEntry | null | undefined,
  codeHash: string,
  metrics: PerfMetrics,
  tol: RegressTolerance,
): Classification {
  if (!entry) return { status: "NEW" };
  if (entry.codeHash !== codeHash) return { status: "STALE" };

  const baseP95 = entry.metrics.p95;
  const budgetP95 = Math.max(baseP95 * (1 + tol.pct), baseP95 + tol.absMs);
  const deltaPct = baseP95 > 0 ? (metrics.p95 - baseP95) / baseP95 : 0;

  const overBudget = metrics.p95 > budgetP95;
  const overCeiling = tol.hardCeilingMs !== undefined && metrics.p95 > tol.hardCeilingMs;

  return {
    status: overBudget || overCeiling ? "REGRESSION" : "OK",
    budgetP95,
    deltaPct,
  };
}

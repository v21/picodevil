/**
 * Node-only filesystem IO for the perf baseline. Kept separate from
 * `test/baseline.ts` (which is pure / browser-safe and imported by a vitest
 * browser test) so the `fs` import never reaches the browser bundle.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { PerfBaseline } from "./baseline";

export function readBaseline(path: string): PerfBaseline | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as PerfBaseline;
}

export function writeBaseline(path: string, baseline: PerfBaseline): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n");
}

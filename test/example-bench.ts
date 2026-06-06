/**
 * Example perf benchmark.
 *
 * Runs the built-in examples (src/examples.ts) as a representative,
 * real-world performance corpus and tracks frame-time regressions against a
 * baseline that is KEYED BY A CONTENT HASH OF EACH EXAMPLE'S CODE.
 *
 * The point of the hash: editing an example changes its code hash, so its
 * stored baseline is recognized as STALE ("recapture") rather than failing as
 * a REGRESSION. A regression is only ever reported when the code is unchanged
 * (hash matches) but the example measurably slowed down. Edits invalidate;
 * they don't break. (See test/baseline.ts `classify`.)
 *
 * Media: the examples reference CDN media (canalboat, ducks, issexercise*, …).
 * Those files already exist locally in the sibling `bunnycdn/content/`, so by
 * default we serve them through the harness's /example-media/ mount — fully
 * offline, no network jitter in the numbers. If that directory is absent (bare
 * checkout / CI) or `--cdn` is passed, we fall back to the live CDN URLs.
 *
 * Usage:
 *   npx tsx test/example-bench.ts capture [--headless] [--duration 5000] [--cdn]
 *   npx tsx test/example-bench.ts check   [--headless] [--regress-pct 0.25] [--regress-abs 3]
 *                                         [--hard-ceiling 32] [--strict] [--case <substr>]
 *
 * Output: JSON to stdout, human summary to stderr.
 * Exit codes:
 *   0  all OK / NEW / STALE (lenient — edits don't fail the run)
 *   1  a real REGRESSION (same code hash, p95 over tolerance)
 *   2  harness crash
 *   3  STALE/NEW present AND --strict was passed
 */

import { resolve } from "path";
import { examples } from "../src/examples";
import {
  startHarness, seedMedia, percentile, phaseStats, collectFrameMetrics,
  parseFlags, type RawMetrics,
} from "./harness";
import {
  codeHashHex, classify,
  type PerfBaseline, type PerfEntry, type PerfMetrics, type RegressTolerance, type Status,
} from "./baseline";
import { readBaseline, writeBaseline } from "./baseline-io";
import { resolveExampleMedia } from "./example-media";

const { argv, flag, bool } = parseFlags();
const MODE = argv[0];
const HEADLESS = bool("headless");
const DURATION_MS = parseInt(flag("duration", "5000"), 10);
const VIEWPORT = flag("viewport", "800x600");
const [VPW, VPH] = VIEWPORT.split("x").map(n => parseInt(n, 10));
const FORCE_CDN = bool("cdn");
const STRICT = bool("strict");
const FILTER = flag("case", "").toLowerCase();
const TOL: RegressTolerance = {
  pct: parseFloat(flag("regress-pct", "0.25")),
  absMs: parseFloat(flag("regress-abs", "3")),
  hardCeilingMs: argv.includes("--hard-ceiling") ? parseFloat(flag("hard-ceiling", "32")) : undefined,
};

if (MODE !== "capture" && MODE !== "check") {
  console.error("Usage: example-bench.ts (capture | check) [...flags]");
  process.exit(2);
}

const BASELINE_PATH = resolve(import.meta.dirname ?? ".", "baselines", "example-perf.json");

function computeMetrics(raw: RawMetrics): PerfMetrics {
  const sorted = [...raw.frameTimes].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: raw.maxFrameTime,
    frameCount: sorted.length,
    phases: {
      query:   phaseStats(raw.phaseQuery),
      assign:  phaseStats(raw.phaseAssign),
      draw:    phaseStats(raw.phaseDraw),
      prewarm: phaseStats(raw.phasePrewarm),
    },
  };
}

interface RunResult {
  name: string;
  codeHash: string;
  metrics: PerfMetrics;
  errors: string[];
}

async function main() {
  const media = resolveExampleMedia(FORCE_CDN);
  console.error(`media: ${media.mode}`);

  const activeExamples = FILTER ? examples.filter(e => e.name.toLowerCase().includes(FILTER)) : examples;
  if (activeExamples.length === 0) {
    console.error(`No examples match --case "${FILTER}". Available: ${examples.map(e => e.name).join(", ")}`);
    process.exit(2);
  }

  const harness = await startHarness({
    headless: HEADLESS,
    viewport: { width: VPW, height: VPH },
    mediaDir: media.mediaDir,
  });
  const { page } = harness;
  if (media.mediaDir && !harness.mediaMounted) {
    console.error(`warning: media dir ${media.mediaDir} did not mount; sources may fall back to colour.`);
  }

  const runs: RunResult[] = [];
  for (const ex of activeExamples) {
    const errors: string[] = [];
    const onPageError = (err: any) => errors.push(err.message || String(err));
    page.on("pageerror", onPageError);

    await harness.reload();
    await seedMedia(page, media.entries);
    await page.evaluate(() => (window as any).pdMetrics.reset());

    const evalError = await page.evaluate((code: string) => {
      try { (window as any).pdEval(code); return null; }
      catch (e: any) { return e?.message || String(e); }
    }, ex.code);
    if (evalError) errors.push(`eval: ${evalError}`);

    await page.waitForTimeout(DURATION_MS);

    const raw = await collectFrameMetrics(page);
    page.off("pageerror", onPageError);

    runs.push({ name: ex.name, codeHash: codeHashHex(ex.code), metrics: computeMetrics(raw), errors });
  }

  await harness.close();

  if (MODE === "capture") {
    const examplesOut: Record<string, PerfEntry> = {};
    for (const r of runs) examplesOut[r.name] = { codeHash: r.codeHash, metrics: r.metrics };
    const baseline: PerfBaseline = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      env: { viewport: [VPW, VPH], durationMs: DURATION_MS, headless: HEADLESS, mediaSeedSource: media.mode },
      examples: examplesOut,
    };
    writeBaseline(BASELINE_PATH, baseline);

    console.log(JSON.stringify({ mode: "capture", wrote: BASELINE_PATH, examples: baseline.examples }, null, 2));
    console.error(`\n=== Example Bench: captured ${runs.length} baselines ===`);
    for (const r of runs) {
      console.error(`  ${r.name.padEnd(14)} p50=${r.metrics.p50.toFixed(1)}ms p95=${r.metrics.p95.toFixed(1)}ms p99=${r.metrics.p99.toFixed(1)}ms (${r.metrics.frameCount} frames) hash=${r.codeHash}`);
      for (const e of r.errors) console.error(`    ERROR: ${e}`);
    }
    console.error(`Wrote ${BASELINE_PATH}`);
    process.exit(0);
  }

  // ===== check mode =====
  const baseline = readBaseline(BASELINE_PATH);
  const out = runs.map(r => {
    const c = classify(baseline?.examples[r.name], r.codeHash, r.metrics, TOL);
    return { ...r, status: c.status, budgetP95: c.budgetP95, deltaPct: c.deltaPct };
  });

  const counts: Record<Status, number> = { NEW: 0, STALE: 0, OK: 0, REGRESSION: 0 };
  for (const r of out) counts[r.status]++;

  const hasRegression = counts.REGRESSION > 0;
  const hasStaleOrNew = counts.STALE > 0 || counts.NEW > 0;
  const allOk = !hasRegression && !hasStaleOrNew;

  console.log(JSON.stringify({
    mode: "check", baselineExists: !!baseline, allOk, counts,
    examples: out.map(r => ({
      name: r.name, status: r.status, codeHash: r.codeHash,
      p95: r.metrics.p95, budgetP95: r.budgetP95, deltaPct: r.deltaPct,
      frameCount: r.metrics.frameCount, errors: r.errors,
    })),
  }, null, 2));

  console.error("\n=== Example Bench: check ===");
  if (!baseline) console.error("  (no baseline file — run `npm run bench:examples:capture`)");
  for (const r of out) {
    const base = baseline?.examples[r.name];
    let detail = "";
    if (r.status === "OK" || r.status === "REGRESSION") {
      const dp = r.deltaPct !== undefined ? `${r.deltaPct >= 0 ? "+" : ""}${(r.deltaPct * 100).toFixed(1)}%` : "";
      detail = `(baseline ${base!.metrics.p95.toFixed(1)}ms, ${dp})`;
    } else if (r.status === "STALE") {
      detail = "(code edited — baseline stale, run capture)";
    } else if (r.status === "NEW") {
      detail = "(no baseline — run capture)";
    }
    console.error(`  [${r.status.padEnd(10)}] ${r.name.padEnd(14)} p95=${r.metrics.p95.toFixed(1)}ms ${detail}`);
    for (const e of r.errors) console.error(`    ERROR: ${e}`);
  }
  console.error(`\n${allOk ? "ALL OK" : hasRegression ? "REGRESSIONS DETECTED" : "STALE/NEW (recapture needed)"}` +
    `  [OK=${counts.OK} REGRESSION=${counts.REGRESSION} STALE=${counts.STALE} NEW=${counts.NEW}]`);

  if (hasRegression) process.exit(1);
  if (STRICT && hasStaleOrNew) process.exit(3);
  process.exit(0);
}

main().catch((e) => {
  console.error("Example bench crashed:", e);
  process.exit(2);
});

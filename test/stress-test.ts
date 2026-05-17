/**
 * Performance stress tester for uzuvid.
 *
 * Runs demanding video patterns in a real browser, collects frame timing
 * metrics, and outputs structured JSON results. Designed to be run by
 * LLM agents for regression detection.
 *
 * Usage:
 *   npx tsx test/stress-test.ts [--headless] [--duration 5000] [--threshold 32]
 *
 * Output: JSON to stdout with pass/fail per test case and aggregate stats.
 * Exit code: 0 if all pass, 1 if any regression detected.
 */

import { chromium } from "playwright";
import { createServer } from "vite";

const args = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HEADLESS = args.includes("--headless");
const DURATION_MS = parseInt(flag("duration", "5000"), 10);
const FRAME_THRESHOLD_MS = parseFloat(flag("threshold", "32"));
/** If set, only run the case whose name contains this substring (case-insensitive). */
const FILTER = flag("case", "").toLowerCase();

interface StressCase {
  name: string;
  code: string;
  /** Max acceptable p95 frame time in ms. Defaults to FRAME_THRESHOLD_MS. */
  threshold?: number;
  /**
   * After a warmup period, how many seeks per frame are acceptable on average?
   * E.g. 0 means "no seeks after warmup" (for rolling/sync video).
   * If omitted, seeks are not checked.
   */
  maxAvgSeeksAfterWarmup?: number;
  /** Warmup frames to skip before checking seeks. Default: 5. */
  seekWarmupFrames?: number;
}

const CASES: StressCase[] = [
  {
    name: "single video",
    code: `$: video("red.mp4").urlBase('/test-assets/')`,
  },
  {
    name: "4 videos in grid",
    code: `$: index(
      video("red.mp4").urlBase('/test-assets/'),
      video("blue.mp4").urlBase('/test-assets/'),
      video("red.mp4").urlBase('/test-assets/').speed(2),
      video("blue.mp4").urlBase('/test-assets/').speed(-1),
    ).rowscols(2).gridMod()`,
  },
  {
    name: "fast switching (8 cps)",
    code: `setCps(8)\n$: video("red.mp4 blue.mp4").urlBase('/test-assets/')`,
  },
  {
    name: "many identical videos (sharing test)",
    code: `$: index(
      video("red.mp4").urlBase('/test-assets/'),
      video("red.mp4").urlBase('/test-assets/'),
      video("red.mp4").urlBase('/test-assets/'),
      video("red.mp4").urlBase('/test-assets/'),
    ).rowscols(2).gridMod()`,
  },
  {
    name: "reverse + variable speed",
    code: `setCps(2)\n$: video("red.mp4").urlBase('/test-assets/').speed("-1 2 0.5 -2")`,
  },
  {
    name: "rapid re-eval",
    code: `setCps(4)\n$: video("red.mp4 blue.mp4").urlBase('/test-assets/').speed("1 2")`,
  },
  {
    name: "video with sync across cycles",
    code: `setCps(2)\n$: video("red.mp4").urlBase('/test-assets/').sync()`,
  },
  {
    name: "nested grid with videos",
    code: `$: index(
      index(
        video("red.mp4").urlBase('/test-assets/'),
        video("blue.mp4").urlBase('/test-assets/'),
      ).cols(2).rows(1).gridMod(),
      video("red.mp4").urlBase('/test-assets/').speed(0.5),
    ).cols(1).rows(2).gridMod()`,
  },
  {
    name: "chop + scrub (pool reuse)",
    code: `$: video("red.mp4").urlBase('/test-assets/').chop(8).scrub(sine)`,
  },
  {
    name: "chop + scrub + revv",
    code: `$: video("red.mp4").urlBase('/test-assets/').chop(8).scrub(sine).revv()`,
  },
  {
    name: "dynamic begin (continuous)",
    code: `$: video("red.mp4").urlBase('/test-assets/').begin(sine.slow(2)).end(0.8)`,
  },
  {
    name: "dynamic speed (continuous)",
    code: `$: video("red.mp4").urlBase('/test-assets/').chop(4).speed(sine.range(0.5, 2))`,
  },
  {
    name: "scrub grid (sharing + reuse)",
    code: `$: index(
      video("red.mp4").urlBase('/test-assets/').chop(4).scrub(sine),
      video("red.mp4").urlBase('/test-assets/').chop(4).scrub(sine),
      video("blue.mp4").urlBase('/test-assets/').chop(4).scrub(saw),
      video("blue.mp4").urlBase('/test-assets/').chop(4).scrub(saw),
    ).rowscols(2).gridMod()`,
  },
  {
    name: "rolling: no seeks after first frame",
    code: `$: video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').rolling()`,
    maxAvgSeeksAfterWarmup: 0,
    seekWarmupFrames: 10,
  },
  {
    name: "rolling 4-tile grid: no seeks after warmup",
    code: `$: index(
      video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').rolling(),
      video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').rolling(),
      video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').rolling(),
      video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').rolling(),
    ).rowscols(2).gridMod()`,
    maxAvgSeeksAfterWarmup: 0,
    seekWarmupFrames: 10,
  },
  {
    name: "rolling with begin(.3): settles at loopStart after loadeddata reset",
    code: `$: video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').begin(.3).rolling()`,
    // Allow a couple of drift-correction seeks during initial load, then stable.
    maxAvgSeeksAfterWarmup: 0,
    seekWarmupFrames: 30,
  },
  {
    name: "3-video sync switching + s(prev) feedback",
    code: [
      `$: s("prev").alpha(1).scale(1.01)`,
      `dvsa: s("red.mp4 blue.mp4 hXJaBfcdCKM.mp4").urlBase('/test-assets/').width(0.5).height(0.5).sync()`,
    ].join("\n"),
    maxAvgSeeksAfterWarmup: 1,
    seekWarmupFrames: 30,
  },
];

interface PhaseStats {
  p50: number;
  p95: number;
}

interface CaseResult {
  name: string;
  pass: boolean;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  avgPoolSize: number;
  avgFreePoolSize: number;
  frameCount: number;
  threshold: number;
  avgSeeksAfterWarmup?: number;
  phases: { query: PhaseStats; assign: PhaseStats; draw: PhaseStats; prewarm: PhaseStats };
  errors: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  const server = await createServer({
    server: { port: 0 },
    logLevel: "warn",
  });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : addr.port;
  const url = `http://localhost:${port}`;

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();

  await page.goto(url);
  await page.waitForFunction(() => typeof window.uzuEval === "function", null, { timeout: 10000 });

  const activeCases = FILTER ? CASES.filter(tc => tc.name.toLowerCase().includes(FILTER)) : CASES;
  if (FILTER && activeCases.length === 0) {
    console.error(`No cases match --case "${FILTER}". Available:\n${CASES.map(c => `  ${c.name}`).join("\n")}`);
    process.exit(1);
  }

  const results: CaseResult[] = [];

  for (const tc of activeCases) {
    const errors: string[] = [];
    const onPageError = (err: any) => errors.push(err.message || String(err));
    page.on("pageerror", onPageError);

    // Reset metrics
    await page.evaluate(() => (window as any).uzuMetrics.reset());

    // Run the test case
    const evalError = await page.evaluate((code: string) => {
      try {
        window.uzuEval(code);
        return null;
      } catch (e: any) {
        return e?.message || String(e);
      }
    }, tc.code);

    if (evalError) errors.push(`eval: ${evalError}`);

    // For "rapid re-eval", re-eval multiple times during the run
    if (tc.name === "rapid re-eval") {
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(DURATION_MS / 6);
        await page.evaluate((code: string) => {
          try { window.uzuEval(code); } catch {}
        }, tc.code);
      }
      await page.waitForTimeout(DURATION_MS / 6);
    } else {
      await page.waitForTimeout(DURATION_MS);
    }

    // Collect metrics
    const metrics = await page.evaluate(() => {
      const m = (window as any).uzuMetrics;
      return {
        frameTimes: [...m.frameTimes] as number[],
        seeksHistory: [...m.seeksHistory] as number[],
        poolSize: m.poolSize as number,
        freePoolSize: m.freePoolSize as number,
        maxFrameTime: m.maxFrameTime as number,
        phaseQuery:   [...m.phaseQuery]   as number[],
        phaseAssign:  [...m.phaseAssign]  as number[],
        phaseDraw:    [...m.phaseDraw]    as number[],
        phasePrewarm: [...m.phasePrewarm] as number[],
      };
    });

    page.off("pageerror", onPageError);

    const sorted = [...metrics.frameTimes].sort((a, b) => a - b);
    const threshold = tc.threshold ?? FRAME_THRESHOLD_MS;
    const p95 = percentile(sorted, 95);

    // Seeks check
    let avgSeeksAfterWarmup: number | undefined;
    let seekCheckPass = true;
    if (tc.maxAvgSeeksAfterWarmup !== undefined) {
      const warmup = tc.seekWarmupFrames ?? 5;
      const postWarmup = metrics.seeksHistory.slice(warmup);
      avgSeeksAfterWarmup = postWarmup.length > 0
        ? postWarmup.reduce((a, b) => a + b, 0) / postWarmup.length
        : 0;
      seekCheckPass = avgSeeksAfterWarmup <= tc.maxAvgSeeksAfterWarmup;
      if (!seekCheckPass) errors.push(`seeks: avg=${avgSeeksAfterWarmup.toFixed(3)} after warmup, max=${tc.maxAvgSeeksAfterWarmup}`);
    }

    const phaseStats = (arr: number[]): PhaseStats => {
      const s = [...arr].sort((a, b) => a - b);
      return { p50: percentile(s, 50), p95: percentile(s, 95) };
    };

    const result: CaseResult = {
      name: tc.name,
      pass: p95 <= threshold && seekCheckPass && errors.length === 0,
      avgSeeksAfterWarmup,
      p50: percentile(sorted, 50),
      p95,
      p99: percentile(sorted, 99),
      max: metrics.maxFrameTime,
      avgPoolSize: metrics.poolSize,
      avgFreePoolSize: metrics.freePoolSize,
      frameCount: sorted.length,
      threshold,
      phases: {
        query:   phaseStats(metrics.phaseQuery),
        assign:  phaseStats(metrics.phaseAssign),
        draw:    phaseStats(metrics.phaseDraw),
        prewarm: phaseStats(metrics.phasePrewarm),
      },
      errors,
    };
    results.push(result);

    // Navigate fresh for next case
    await page.goto(url);
    await page.waitForFunction(() => typeof window.uzuEval === "function", null, { timeout: 10000 });
  }

  await browser.close();
  await server.close();

  // Output structured results
  const allPass = results.every(r => r.pass);
  const output = {
    timestamp: new Date().toISOString(),
    durationMs: DURATION_MS,
    headless: HEADLESS,
    defaultThresholdMs: FRAME_THRESHOLD_MS,
    allPass,
    cases: results,
  };

  console.log(JSON.stringify(output, null, 2));

  // Also print human-readable summary to stderr
  console.error("\n=== Stress Test Results ===");
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    const seekStr = r.avgSeeksAfterWarmup !== undefined ? ` seeks/frame=${r.avgSeeksAfterWarmup.toFixed(3)}` : "";
    const ph = r.phases;
    const phaseStr = ` [query=${ph.query.p50.toFixed(2)}ms assign=${ph.assign.p50.toFixed(2)}ms draw=${ph.draw.p50.toFixed(2)}ms prewarm=${ph.prewarm.p50.toFixed(2)}ms p50]`;
    console.error(`  [${status}] ${r.name}: p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms p99=${r.p99.toFixed(1)}ms max=${r.max.toFixed(1)}ms (${r.frameCount} frames, pool=${r.avgPoolSize}+${r.avgFreePoolSize}free${seekStr})${phaseStr}`);
    if (r.errors.length > 0) {
      for (const e of r.errors) console.error(`    ERROR: ${e}`);
    }
  }
  console.error(`\n${allPass ? "ALL PASSED" : "REGRESSIONS DETECTED"}`);

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("Stress test crashed:", e);
  process.exit(2);
});

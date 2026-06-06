/**
 * Warm-determinism golden harness for the built-in examples.
 *
 * The examples are video/feedback/time-varying, so the standard golden harness
 * (test/golden-render.ts) excludes them. But the open question is: once the
 * videos are LOADED AND WARM in the browser, does a render at a fixed cycle
 * actually stabilize? This harness answers that empirically, per example:
 *
 *   1. warm up   — eval the example, let the live loop run so videos decode/
 *                  buffer and the pool settles, wait for fonts.
 *   2. settle    — pause the loop, render repeatedly at a fixed cycle with a
 *                  PINNED wall-clock (so sync()/rolling() position is fixed),
 *                  and watch whether two consecutive renders match.
 *   3. classify  — stable  => capture/compare a real golden PNG.
 *                  unstable => record "non-deterministic when warm" + how much
 *                              it still churns. Informational, never fails.
 *
 * Baselines are keyed by a content hash of each example's code: editing an
 * example marks its golden STALE (recapture), it does not fail as drift.
 *
 * Usage:
 *   npx tsx test/example-golden.ts capture [--headless] [--warmup 3000] [--tolerance 4] [--cdn]
 *   npx tsx test/example-golden.ts compare [--headless] [--tolerance 4]
 *
 * Output:
 *   test/golden-examples/manifest.json   per-example {name, codeHash, stable, churnPct, png?}
 *   test/golden-examples/<name>.png      golden for each STABLE example
 *
 * Exit codes:
 *   0  all good (OK / STALE / NEW / INFO-unstable)
 *   1  a stable example's pixels DRIFTED beyond tolerance (a real visual regression)
 *   2  harness crash
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { examples } from "../src/examples";
import {
  startHarness, seedMedia, renderAndSettle, captureFrame, encodePng, decodePng, diffPixels,
  parseFlags, type Harness, type PixelData,
} from "./harness";
import { codeHashHex } from "./baseline";
import { resolveExampleMedia } from "./example-media";

const { argv, flag, bool } = parseFlags();
const MODE = argv[0];
const HEADLESS = bool("headless");
const WARMUP_MS = parseInt(flag("warmup", "3000"), 10);
const SETTLE_MS = parseInt(flag("settle", "250"), 10);
const MAX_ATTEMPTS = parseInt(flag("max-attempts", "25"), 10);
const TOLERANCE = parseInt(flag("tolerance", "4"), 10);
const VIEWPORT = flag("viewport", "256x256");
const [VPW, VPH] = VIEWPORT.split("x").map(n => parseInt(n, 10));
const CYCLE = parseFloat(flag("cycle", "0.5"));
const CPS = parseFloat(flag("cps", "0.5"));
// A fixed, arbitrary wall-clock (ms) pinned across renders + across capture/
// compare so wall-clock-driven playback is reproducible. Stored in the manifest.
const WALL_MS = parseFloat(flag("wall", "100000"));
const FORCE_CDN = bool("cdn");

if (MODE !== "capture" && MODE !== "compare") {
  console.error("Usage: example-golden.ts (capture | compare) [...flags]");
  process.exit(2);
}

const GOLDEN_DIR = resolve(import.meta.dirname ?? ".", "golden-examples");
const MANIFEST_PATH = resolve(GOLDEN_DIR, "manifest.json");

interface ManifestEntry {
  name: string;
  codeHash: string;
  stable: boolean;
  settleAttempts: number;
  /** Residual % of pixels still changing between consecutive warm renders. */
  churnPct: number;
  /** Golden PNG filename, present iff stable. */
  png?: string;
}

interface Manifest {
  viewport: [number, number];
  cycle: number;
  cps: number;
  wallMs: number;
  warmupMs: number;
  capturedAt: string;
  examples: ManifestEntry[];
}

interface WarmResult {
  pixels: PixelData;
  stable: boolean;
  settleAttempts: number;
  churnPct: number;
}

/** Warm up an example (load + decode + buffer), then settle at a fixed cycle. */
async function warmAndSettle(h: Harness, code: string, media: { name: string; url: string }[]): Promise<WarmResult> {
  await h.reload();
  await seedMedia(h.page, media);

  const evalError = await h.page.evaluate((c: string) => {
    try { (window as any).pdEval(c); return null; }
    catch (e: any) { return e?.message || String(e); }
  }, code);
  if (evalError) throw new Error(`pdEval threw: ${evalError}`);

  // Let the LIVE loop run so videos decode/buffer and the pool settles, then
  // wait for fonts. Only after warmup do we pause and pin the clock.
  await h.page.waitForTimeout(WARMUP_MS);
  await h.page.evaluate(() => (document as any).fonts?.ready);
  await h.page.evaluate(() => (window as any).pdPauseRaf());

  const settle = await renderAndSettle(h.page, {
    cycle: CYCLE, cps: CPS, settleMs: SETTLE_MS, maxAttempts: MAX_ATTEMPTS, wallMs: WALL_MS,
  });

  // Measure residual churn: one more render, diff against the settled frame.
  const extra = await captureFrame(h.page, CYCLE, CPS, WALL_MS);
  const d = diffPixels(settle.pixels, extra, 0);
  const churnPct = d.total > 0 ? (d.drifted / d.total) * 100 : 0;

  return { pixels: settle.pixels, stable: settle.settled, settleAttempts: settle.attempts, churnPct };
}

async function main() {
  const media = resolveExampleMedia(FORCE_CDN);
  console.error(`media: ${media.mode}`);

  // compare uses the manifest's viewport / cycle / cps / wall so renders match.
  let vpw = VPW, vph = VPH;
  let manifest: Manifest | null = null;
  if (MODE === "compare") {
    if (!existsSync(MANIFEST_PATH)) {
      console.error(`No manifest at ${MANIFEST_PATH}. Run capture first.`);
      process.exit(2);
    }
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    vpw = manifest!.viewport[0]; vph = manifest!.viewport[1];
  }

  const harness = await startHarness({
    headless: HEADLESS,
    viewport: { width: vpw, height: vph },
    mediaDir: media.mediaDir,
  });
  const { page } = harness;

  if (MODE === "capture") {
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });

    const entries: ManifestEntry[] = [];
    for (const ex of examples) {
      try {
        const r = await warmAndSettle(harness, ex.code, media.entries);
        const entry: ManifestEntry = {
          name: ex.name,
          codeHash: codeHashHex(ex.code),
          stable: r.stable,
          settleAttempts: r.settleAttempts,
          churnPct: r.churnPct,
        };
        if (r.stable) {
          const png = await encodePng(page, r.pixels);
          const file = `${ex.name}.png`;
          writeFileSync(resolve(GOLDEN_DIR, file), png);
          entry.png = file;
        }
        entries.push(entry);
        const tag = r.stable ? "STABLE" : "unstable";
        console.error(`  [${tag.padEnd(8)}] ${ex.name.padEnd(14)} attempts=${r.settleAttempts} churn=${r.churnPct.toFixed(2)}%`);
      } catch (e: any) {
        console.error(`  [ERROR   ] ${ex.name}: ${e.message}`);
        entries.push({ name: ex.name, codeHash: codeHashHex(ex.code), stable: false, settleAttempts: 0, churnPct: 100 });
      }
    }

    const out: Manifest = {
      viewport: [vpw, vph], cycle: CYCLE, cps: CPS, wallMs: WALL_MS, warmupMs: WARMUP_MS,
      capturedAt: new Date().toISOString(), examples: entries,
    };
    writeFileSync(MANIFEST_PATH, JSON.stringify(out, null, 2) + "\n");

    const stableCount = entries.filter(e => e.stable).length;
    console.log(JSON.stringify({ mode: "capture", stable: stableCount, total: entries.length, examples: entries }, null, 2));
    console.error(`\n=== Example Golden: ${stableCount}/${entries.length} stable when warm ===`);
    console.error(`Wrote ${MANIFEST_PATH}`);
    await harness.close();
    process.exit(0);
  }

  // ===== compare mode =====
  let ok = 0, drifted = 0, stale = 0, info = 0, neu = 0;
  const byName = new Map(manifest!.examples.map(e => [e.name, e]));
  const results: any[] = [];

  for (const ex of examples) {
    const entry = byName.get(ex.name);
    const codeHash = codeHashHex(ex.code);

    if (!entry) {
      neu++;
      results.push({ name: ex.name, status: "NEW" });
      console.error(`  [NEW    ] ${ex.name.padEnd(14)} (no golden — run capture)`);
      continue;
    }
    if (entry.codeHash !== codeHash) {
      stale++;
      results.push({ name: ex.name, status: "STALE" });
      console.error(`  [STALE  ] ${ex.name.padEnd(14)} (code edited — golden stale, run capture)`);
      continue;
    }
    if (!entry.stable || !entry.png) {
      // Was non-deterministic when warm — re-measure and report, never fail.
      const r = await warmAndSettle(harness, ex.code, media.entries);
      info++;
      results.push({ name: ex.name, status: "UNSTABLE", churnPct: r.churnPct, stableNow: r.stable });
      console.error(`  [UNSTABLE] ${ex.name.padEnd(14)} non-deterministic when warm (churn now ${r.churnPct.toFixed(2)}%, stableNow=${r.stable})`);
      continue;
    }

    // Stable golden: render warm + pixel-diff against the PNG.
    try {
      const r = await warmAndSettle(harness, ex.code, media.entries);
      const goldenBytes = readFileSync(resolve(GOLDEN_DIR, entry.png));
      const goldenPixels = await decodePng(page, new Uint8Array(goldenBytes), r.pixels.width, r.pixels.height);
      const diff = diffPixels(goldenPixels, r.pixels, TOLERANCE);
      if (diff.drifted === 0) {
        ok++;
        results.push({ name: ex.name, status: "OK" });
        console.error(`  [OK     ] ${ex.name.padEnd(14)} matches golden`);
      } else {
        drifted++;
        const pct = (diff.drifted / diff.total * 100).toFixed(2);
        results.push({ name: ex.name, status: "DRIFT", driftedPct: pct, maxDelta: diff.maxDelta });
        console.error(`  [DRIFT  ] ${ex.name.padEnd(14)} ${diff.drifted}/${diff.total} px (${pct}%), maxΔ=${diff.maxDelta}`);
      }
    } catch (e: any) {
      drifted++;
      results.push({ name: ex.name, status: "ERROR", error: e.message });
      console.error(`  [ERROR  ] ${ex.name}: ${e.message}`);
    }
  }

  console.log(JSON.stringify({ mode: "compare", ok, drifted, stale, unstable: info, neu, examples: results }, null, 2));
  console.error(`\n=== Example Golden compare: ${ok} ok, ${drifted} drifted, ${stale} stale, ${info} unstable, ${neu} new ===`);
  await harness.close();
  process.exit(drifted > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Example golden crashed:", e);
  process.exit(2);
});

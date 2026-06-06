/**
 * Golden visual reference harness.
 *
 * Two modes:
 *   capture  — generate a corpus of patterns via fast-check, render each one in
 *              a headless browser, save the canvas as PNG + write a manifest
 *   compare  — re-render every pattern from the manifest, decode the saved PNG,
 *              pixel-diff against the new render, report drifts
 *
 * Used as a regression guard around the shader-VM rewrite: capture goldens on
 * `main` before any renderer changes, then run compare after each stage of
 * the rewrite.
 *
 * Corpus is restricted to color and image sources (no video) so renders are
 * deterministic — video frames depend on wall-clock state we can't reproduce.
 *
 * Usage:
 *   npx tsx test/golden-render.ts capture [--count 100] [--seed 42] [--headless] [--viewport 256x256]
 *   npx tsx test/golden-render.ts compare [--tolerance 1] [--headless]
 *
 * Output:
 *   test/golden/manifest.json   { seed, viewport, cycle, cps, count, cases: [{id, code}] }
 *   test/golden/<id>.png        per-case PNG snapshot
 *
 * Exit code: 0 if all pass (compare) / capture succeeded; 1 if any drift.
 *
 * The vite+chromium scaffold and pixel capture/compare helpers live in
 * `test/harness.ts`, shared with the other browser-driven harnesses.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { resolve } from "path";
import fc from "fast-check";
import { topExpr, type GeneratedExpr, REGISTRY_SEED, VIDEO_REGISTRY_NAMES } from "./arbitraries";
import {
  startHarness, seedMedia, renderAndSettle, encodePng, decodePng, diffPixels,
  parseFlags, type Harness, type PixelData,
} from "./harness";

// ============================================================
// CLI args
// ============================================================

const { argv, flag, bool } = parseFlags();
const MODE = argv[0];
const HEADLESS = bool("headless");
const COUNT = parseInt(flag("count", "100"), 10);
const SEED = parseInt(flag("seed", "42"), 10);
const VIEWPORT = flag("viewport", "256x256");
const [VPW, VPH] = VIEWPORT.split("x").map(n => parseInt(n, 10));
const TOLERANCE = parseInt(flag("tolerance", "1"), 10);
const CYCLE = parseFloat(flag("cycle", "0.5"));
const CPS = parseFloat(flag("cps", "0.5"));
const SETTLE_MS = parseInt(flag("settle", "600"), 10);

if (MODE !== "capture" && MODE !== "compare") {
  console.error("Usage: golden-render.ts (capture | compare) [...flags]");
  process.exit(2);
}

const GOLDEN_DIR = resolve(import.meta.dirname ?? ".", "golden");
const MANIFEST_PATH = resolve(GOLDEN_DIR, "manifest.json");

// ============================================================
// Corpus generation
// ============================================================

interface Manifest {
  seed: number;
  viewport: [number, number];
  cycle: number;
  cps: number;
  count: number;
  cases: { id: string; code: string }[];
}

/** Reject patterns that would render non-deterministically. */
function isDeterministic(code: string): boolean {
  if (/video\s*\(/.test(code)) return false;
  if (/\.(mp4|mov|webm|avi|mkv)/i.test(code)) return false;
  // Video registry shorthand names — used as s()/screen() tokens, would
  // resolve to video sources without ever mentioning a file extension.
  for (const name of VIDEO_REGISTRY_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(code)) return false;
  }
  if (/\bfft\./.test(code)) return false;
  if (/\bmouseX\b|\bmouseY\b/.test(code)) return false;
  if (/loadCamera|loadScreen|loadVideo/.test(code)) return false;
  // .gif may use animated frames; skip for v1.
  if (/\.gif/i.test(code)) return false;
  // .scrub uses pattern-time-dependent video state — N/A here but skip just in case
  if (/\.scrub\s*\(/.test(code)) return false;
  // syncStack / chopStack pull video frames — exclude
  if (/\.(chopStack|syncStack)\s*\(/.test(code)) return false;
  return true;
}

/** Generate `n` deterministic patterns via fast-check, using a fixed seed. */
function generateCorpus(n: number, seed: number): { id: string; code: string }[] {
  const cases: { id: string; code: string }[] = [];
  let attempts = 0;
  const maxAttempts = n * 50;
  // fc.sample with a seed gives reproducible output. Pull more than needed,
  // then filter to deterministic patterns.
  while (cases.length < n && attempts < maxAttempts) {
    const batch = fc.sample(topExpr, { numRuns: 200, seed: seed + attempts });
    for (const e of batch) {
      if (cases.length >= n) break;
      const code = e.code;
      if (!isDeterministic(code)) continue;
      const id = `g${cases.length.toString().padStart(4, "0")}`;
      cases.push({ id, code });
    }
    attempts += 200;
  }
  if (cases.length < n) {
    throw new Error(`Could only generate ${cases.length}/${n} deterministic patterns after ${attempts} attempts`);
  }
  return cases;
}

// ============================================================
// Per-case render (warm up + settle)
// ============================================================

/** Render one case in a fresh page and return the settled canvas pixels. */
async function renderCase(h: Harness, code: string): Promise<PixelData> {
  // Fresh navigation per case clears renderer / FBO / video element state.
  await h.reload();

  await h.page.evaluate(() => (window as any).pdPauseRaf());

  // Seed the registry media the corpus patterns reference.
  await seedMedia(h.page, REGISTRY_SEED);

  const evalError = await h.page.evaluate((c: string) => {
    try { (window as any).pdEval(c); return null; }
    catch (e: any) { return e?.message || String(e); }
  }, code);
  if (evalError) throw new Error(`pdEval threw: ${evalError}`);

  // Wait for fonts to finish loading — text() tiles otherwise render with the
  // CSS fallback face for the first few frames after eval.
  await h.page.evaluate(() => (document as any).fonts?.ready);

  // Render → capture → wait, until two consecutive captures match (assets
  // loaded) or max attempts. Beats a fixed timeout for slow-loading images.
  const { pixels } = await renderAndSettle(h.page, { cycle: CYCLE, cps: CPS, settleMs: SETTLE_MS });
  return pixels;
}

/** Render with retry on transient navigation errors. */
async function renderCaseWithRetry(h: Harness, code: string): Promise<PixelData> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await renderCase(h, code);
    } catch (e: any) {
      lastErr = e;
      const msg = e.message || String(e);
      // Retry on "execution context destroyed" and other transient nav races.
      if (!/Execution context|context was destroyed|frame was detached|navigation/i.test(msg)) {
        throw e;
      }
      await new Promise(r => setTimeout(r, 400 + attempt * 400));
    }
  }
  throw lastErr!;
}

// ============================================================
// Main
// ============================================================

async function main() {
  // Decide the viewport up front: compare uses the manifest's viewport so
  // renders match the goldens.
  let vpw = VPW, vph = VPH;
  if (MODE === "compare") {
    if (!existsSync(MANIFEST_PATH)) {
      console.error(`No manifest at ${MANIFEST_PATH}. Run capture first.`);
      process.exit(2);
    }
    const m: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    vpw = m.viewport[0]; vph = m.viewport[1];
  }

  console.log("Starting vite dev server + browser...");
  const harness = await startHarness({ headless: HEADLESS, viewport: { width: vpw, height: vph } });
  const { page } = harness;
  console.log(`Harness ready at ${harness.url}`);

  if (MODE === "capture") {
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
    // Clear any prior PNGs so the snapshot is clean.
    for (const f of readdirSync(GOLDEN_DIR)) {
      if (f.endsWith(".png")) unlinkSync(resolve(GOLDEN_DIR, f));
    }

    console.log(`Generating corpus of ${COUNT} deterministic patterns (seed=${SEED})...`);
    const cases = generateCorpus(COUNT, SEED);
    console.log(`Generated ${cases.length} cases. Capturing renders at ${VPW}x${VPH}, cycle=${CYCLE}, cps=${CPS}.`);

    let captured = 0, failed = 0;
    const successfulCases: typeof cases = [];
    for (const c of cases) {
      try {
        const pixels = await renderCaseWithRetry(harness, c.code);
        const png = await encodePng(page, pixels);
        writeFileSync(resolve(GOLDEN_DIR, `${c.id}.png`), png);
        captured++;
        successfulCases.push(c);
        if (captured % 10 === 0) console.log(`  [${captured}/${cases.length}] captured`);
      } catch (e: any) {
        failed++;
        console.log(`  [${c.id}] FAILED: ${e.message}`);
        console.log(`    code: ${c.code.slice(0, 120)}${c.code.length > 120 ? "..." : ""}`);
      }
    }

    const manifest: Manifest = {
      seed: SEED,
      viewport: [VPW, VPH],
      cycle: CYCLE,
      cps: CPS,
      count: successfulCases.length,
      cases: successfulCases,
    };
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

    console.log(`\nCapture complete: ${captured} succeeded, ${failed} failed.`);
    console.log(`Wrote ${manifest.count} entries to ${MANIFEST_PATH}`);
    await harness.close();
    process.exit(failed > 0 ? 1 : 0);
  }

  // ===== compare mode =====
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  console.log(`Comparing ${manifest.count} cases at ${vpw}x${vph} (tolerance=±${TOLERANCE}/channel)...`);
  let passed = 0, drifted = 0, errored = 0;
  const drifts: { id: string; code: string }[] = [];

  for (const c of manifest.cases) {
    const pngPath = resolve(GOLDEN_DIR, `${c.id}.png`);
    if (!existsSync(pngPath)) {
      console.log(`  [${c.id}] MISSING golden PNG`);
      errored++;
      continue;
    }
    try {
      const newPixels = await renderCase(harness, c.code);
      const goldenBytes = readFileSync(pngPath);
      const goldenPixels = await decodePng(page, new Uint8Array(goldenBytes), newPixels.width, newPixels.height);
      const diff = diffPixels(goldenPixels, newPixels, TOLERANCE);
      if (diff.drifted === 0) {
        passed++;
      } else {
        drifted++;
        drifts.push({ id: c.id, code: c.code });
        const pct = (diff.drifted / diff.total * 100).toFixed(2);
        console.log(`  [${c.id}] DRIFT: ${diff.drifted}/${diff.total} px (${pct}%), maxΔ=${diff.maxDelta}`);
        console.log(`    code: ${c.code.slice(0, 120)}${c.code.length > 120 ? "..." : ""}`);
      }
    } catch (e: any) {
      errored++;
      console.log(`  [${c.id}] ERROR: ${e.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`GOLDEN COMPARE: ${passed} ok, ${drifted} drifted, ${errored} errored / ${manifest.count}`);
  console.log("=".repeat(60));

  await harness.close();
  process.exit(drifted > 0 || errored > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Harness crashed:", e);
  process.exit(2);
});

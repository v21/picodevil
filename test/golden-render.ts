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
 */

import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { resolve } from "path";
import fc from "fast-check";
import { topExpr, type GeneratedExpr, REGISTRY_SEED, VIDEO_REGISTRY_NAMES } from "./arbitraries";

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const MODE = args[0];
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HEADLESS = args.includes("--headless");
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
// Browser harness
// ============================================================

interface PixelData { width: number; height: number; data: Uint8Array }

/** Render one case in the page and return the canvas pixels. */
async function renderCase(page: Page, url: string, code: string): Promise<PixelData> {
  // Fresh navigation per case clears renderer / FBO / video element state.
  // Use 'load' to make sure async resources have started loading before we
  // poke at window state.
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(
    () => typeof (window as any).pdEval === "function"
      && typeof (window as any).pdRenderAt === "function"
      && typeof (window as any).pdPauseRaf === "function",
    null, { timeout: 10000 },
  );

  await page.evaluate(() => (window as any).pdPauseRaf());

  await page.evaluate((entries: typeof REGISTRY_SEED) => {
    const addMedia = (window as any).pdAddMedia;
    if (addMedia) for (const { name, url } of entries) addMedia(url, name);
  }, REGISTRY_SEED);

  const evalError = await page.evaluate((c: string) => {
    try { (window as any).pdEval(c); return null; }
    catch (e: any) { return e?.message || String(e); }
  }, code);
  if (evalError) throw new Error(`pdEval threw: ${evalError}`);

  // Wait for fonts to finish loading — text() tiles otherwise render with the
  // CSS fallback face for the first few frames after eval.
  await page.evaluate(() => (document as any).fonts?.ready);

  // Loop: render → capture → wait → render → capture, until two consecutive
  // captures match (asset loading complete) or we hit max attempts. This
  // beats a fixed timeout for patterns with slow-loading images, and avoids
  // wasting time on patterns that settle immediately.
  let prev: PixelData | null = null;
  let last: PixelData | null = null;
  const MAX_ATTEMPTS = 20;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await page.waitForTimeout(i === 0 ? SETTLE_MS : 100);
    last = await page.evaluate(({ cycle, cps }: { cycle: number; cps: number }) => {
      (window as any).pdRenderAt(cycle, cps);
      const c = document.getElementById("c") as HTMLCanvasElement;
      const w = c.width, h = c.height;
      // Read via a 2D canvas to get post-composited pixels without depending on
      // WebGL alpha mode subtleties.
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      const ctx = tmp.getContext("2d")!;
      ctx.drawImage(c, 0, 0);
      const img = ctx.getImageData(0, 0, w, h);
      return { width: w, height: h, data: Array.from(img.data) };
    }, { cycle: CYCLE, cps: CPS }).then(r => ({ width: r.width, height: r.height, data: new Uint8Array(r.data) }));

    if (prev) {
      // Compare prev and last with zero tolerance. If identical, we've settled.
      let stable = prev.width === last.width && prev.height === last.height;
      if (stable) {
        for (let j = 0; j < prev.data.length; j++) {
          if (prev.data[j] !== last.data[j]) { stable = false; break; }
        }
      }
      if (stable) return last;
    }
    prev = last;
  }
  // Didn't fully settle — return last anyway. The harness logs this case but
  // doesn't fail, since some patterns may have genuinely non-zero variation.
  return last!;
}

/** Render with retry on transient navigation errors. */
async function renderCaseWithRetry(page: Page, url: string, code: string): Promise<PixelData> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await renderCase(page, url, code);
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

/** Encode pixel data as a PNG via the browser. Avoids adding a Node PNG dep. */
async function encodePng(page: Page, pixels: PixelData): Promise<Uint8Array> {
  const dataUrl: string = await page.evaluate(({ width, height, data }) => {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(width, height);
    img.data.set(new Uint8ClampedArray(data));
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }, { width: pixels.width, height: pixels.height, data: Array.from(pixels.data) });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/** Decode a saved PNG back to raw pixels via the browser. */
async function decodePng(page: Page, pngBytes: Uint8Array, expectedW: number, expectedH: number): Promise<PixelData> {
  const result = await page.evaluate(async ({ b64, w, h }) => {
    const img = new Image();
    const url = `data:image/png;base64,${b64}`;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("png decode failed"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    return { width: data.width, height: data.height, data: Array.from(data.data) };
  }, { b64: Buffer.from(pngBytes).toString("base64"), w: expectedW, h: expectedH });
  return { width: result.width, height: result.height, data: new Uint8Array(result.data) };
}

interface DiffResult { drifted: number; maxDelta: number; total: number }

function diffPixels(a: PixelData, b: PixelData, tolerance: number): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    return { drifted: a.width * a.height, maxDelta: 255, total: a.width * a.height };
  }
  let drifted = 0, maxDelta = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelDrifted = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      if (d > maxDelta) maxDelta = d;
      if (d > tolerance) pixelDrifted = true;
    }
    if (pixelDrifted) drifted++;
  }
  return { drifted, maxDelta, total };
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("Starting vite dev server...");
  const server = await createServer({ server: { port: 0 }, logLevel: "warn" });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : addr.port;
  const url = `http://localhost:${port}`;
  console.log(`Vite running at ${url}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
  });

  // In compare mode, use the manifest's viewport so renders match the goldens.
  let vpw = VPW, vph = VPH;
  if (MODE === "compare") {
    if (!existsSync(MANIFEST_PATH)) {
      console.error(`No manifest at ${MANIFEST_PATH}. Run capture first.`);
      await browser.close();
      await server.close();
      process.exit(2);
    }
    const m: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    vpw = m.viewport[0]; vph = m.viewport[1];
  }

  const context = await browser.newContext({ viewport: { width: vpw, height: vph } });
  const page = await context.newPage();

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
        const pixels = await renderCaseWithRetry(page, url, c.code);
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
    await browser.close();
    await server.close();
    process.exit(failed > 0 ? 1 : 0);
  }

  // ===== compare mode =====
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  console.log(`Comparing ${manifest.count} cases at ${vpw}x${vph} (tolerance=±${TOLERANCE}/channel)...`);
  let passed = 0, drifted = 0, errored = 0;
  const drifts: { id: string; code: string; diff: DiffResult }[] = [];

  for (const c of manifest.cases) {
    const pngPath = resolve(GOLDEN_DIR, `${c.id}.png`);
    if (!existsSync(pngPath)) {
      console.log(`  [${c.id}] MISSING golden PNG`);
      errored++;
      continue;
    }
    try {
      const newPixels = await renderCase(page, url, c.code);
      const goldenBytes = readFileSync(pngPath);
      const goldenPixels = await decodePng(page, new Uint8Array(goldenBytes), newPixels.width, newPixels.height);
      const diff = diffPixels(goldenPixels, newPixels, TOLERANCE);
      if (diff.drifted === 0) {
        passed++;
      } else {
        drifted++;
        drifts.push({ id: c.id, code: c.code, diff });
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

  await browser.close();
  await server.close();
  process.exit(drifted > 0 || errored > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Harness crashed:", e);
  process.exit(2);
});

/**
 * Generate looping GIFs for the code blocks in README.md.
 *
 * For each block: boot the runtime, seed example media, eval the code, let the
 * live loop warm up (videos decode/buffer, pool settles), then capture exactly
 * one cycle of real-time playback (frames tied to wall-clock so native-speed
 * video advances naturally) and assemble a palette-optimised GIF via ffmpeg.
 *
 * The Strudel-only block (`s("bd [hh hh]")`) is intentionally omitted — those
 * sample names don't exist in picodevil.
 *
 * Usage:
 *   npx tsx test/gen-readme-gifs.ts [--headless] [--only slug,slug] [--no-text]
 *     [--fps 15] [--frames 30] [--warmup 4000] [--out readme-gifs]
 */

import { writeFileSync, mkdirSync, existsSync, rmSync, statSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { startHarness, seedMedia, parseFlags } from "./harness";
import { resolveExampleMedia } from "./example-media";

const { flag, bool } = parseFlags();
const HEADLESS = bool("headless");
const WITH_TEXT = bool("text"); // off by default; pass --text to overlay the code
const FRAMES = parseInt(flag("frames", "24"), 10);
const WARMUP_MS = parseInt(flag("warmup", "6000"), 10);
const CPS = parseFloat(flag("cps", "0.5"));
const MAX_COLORS = parseInt(flag("colors", "128"), 10);
// fps is derived so the GIF spans exactly one cycle (frames / cycleSeconds);
// override with --fps if you want a different playback speed.
const FPS = parseFloat(flag("fps", String(FRAMES * CPS)));
const OUT_DIR = resolve(import.meta.dirname ?? ".", "..", flag("out", "readme-gifs"));
const ONLY = flag("only", "").split(",").map(s => s.trim()).filter(Boolean);

// Stable named library of GIFs. Each entry is a fixed filename (slug) + the code
// that produces it. This is intentionally NOT read positionally from README:
// the README is hand-curated (embeds reused, hidden, deduped) and must not be
// edited by this script, so gif filenames have to stay stable regardless of how
// the README's blocks are reordered. To change what a gif shows, edit its code
// here. Filenames are referenced from README as readme-gifs/<slug>.gif.
const BLOCKS: { slug: string; code: string }[] = [
  { slug: "01-canalboat-ducks",   code: `$: s("canalboat [ducks ducks]")` },
  { slug: "02-text",              code: `$: text('hello world\\nthis is picodevil').fontsize(64)` },
  { slug: "02-scroll-ducks",      code: `$: s("ducks").scrollX(sine)` },
  { slug: "03-ducks",             code: `$: s("ducks")` },
  { slug: "04-stackN16",          code: `$: s("ducks").stackN(16)` },
  { slug: "05-stackN16-index",    code: `$: s("ducks").stackN(16).index()` },
  { slug: "06-stackN16-tile",     code: `$: s("ducks").stackN(15).index().tile()` },
  { slug: "07-grid",              code: `$: s("ducks").stackN(15).rows(4).cols(4).grid()` },
  { slug: "08-gridMod",           code: `$: s("ducks").stackN(15).rows(4).cols(4).gridMod()` },
  { slug: "09-canalboat-cells",   code: `$: s("ducks").stackN(15).stack(\n  s("canalboat").i("0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15").count("16")\n).rows(4).cols(4).gridMod()` },
  { slug: "10-sometimes-reverse", code: `$: s("ducks").stackN(16).sometimes(speed(-1)).tile()` },
  { slug: "11-ducks-corners",     code: `$: s("ducks, canalboat").index().rows(3).cols(3).gridMod()` },
  { slug: "12-canalboat-corners", code: `$: s("canalboat, ducks").index().rows(3).cols(3).gridMod()` },
  { slug: "13-stackN5-grid",      code: `$: s("canalboat, ducks").stackN(5).index().rows(3).cols(3).gridMod()` },
  { slug: "14-shuffleIndex",      code: `$: s("canalboat, ducks").stackN(5).shuffleIndex().rows(3).cols(3).gridMod()` },
  { slug: "15-shuffleIndex-rand", code: `$: s("canalboat, ducks").stackN(5).shuffleIndex(rand.segment(4)).rows(3).cols(3).gridMod()` },
  { slug: "16-sync-tile",         code: `$: stack(s("ducks").sync(0), s("ducks").sync(0.5)).index().tile()` },
  { slug: "17-syncStack",         code: `$: s("ducks").syncStack(2).tile()` },
  { slug: "18-stack-occlude",     code: `$: s("ducks, canalboat")` },
  { slug: "19-stack-alpha",       code: `$: s("ducks, canalboat").alpha(.5)` },
  { slug: "20-layer-alpha",       code: `$: s("ducks")\n$: s("canalboat").alpha(.5)` },
  { slug: "21-blend-multiply",    code: `$: s("ducks")\n$: s("canalboat").blend("multiply")` },
  { slug: "22-all-grey",          code: `$: s("ducks").stackN(9).tile()\n$: s("all").scale(0.5).grey()` },
  { slug: "23-prev-feedback",     code: `$: s("prev")\n$: s("ducks").alpha(0.03)` },
  { slug: "24-quack-crop",        code: `quack: s("ducks").stackN(9).tile()\n$: s("canalboat").alpha(.7)\n$: s("quack").cropStack(4,4).tile().scale(.7)` },
  { slug: "25-Hquack",            code: `Hquack: s("ducks").stackN(9).tile()\n$: s("quack").cropStack(2,2).tile().scale(.9)` },
];

// In-browser one-cycle capture. Two strategies:
//
// STEP (default) — deterministic frame stepping. Pause the live loop, set
//   __pdStepSeek so every clip positions by seeking to its exact per-cycle
//   `expected` time (instead of decode-paced native el.play()), and for each of
//   N frames: render → wait for all seeks to land → render again → read. This
//   removes the speed non-determinism of live playback (a 13.5s clip's native
//   playback covers a variable amount per cycle depending on decode timing).
//
// LIVE — for cross-frame feedback (s("prev")), where the look depends on the
//   accumulation over the live loop's actual per-frame renders. Stepping would
//   change the trail length, so we instead let the live loop drive and just
//   phase-sample it, reading the canvas directly (preserveDrawingBuffer).
const CAPTURE_FN = `
window.__pdGrab = (c, codeText) => {
  const tmp = document.createElement('canvas');
  tmp.width = c.width; tmp.height = c.height;
  const ctx = tmp.getContext('2d');
  // Black backdrop: the WebGL canvas has transparent regions (the app renders
  // over a black page), so composite over black instead of GIF-default white.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(c, 0, 0);
  if (codeText) {
    const lines = codeText.split('\\n');
    const fs = 16, lh = 21, pad = 9;
    ctx.font = fs + 'px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';
    const boxH = pad * 2 + lines.length * lh;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, c.width, boxH);
    for (let j = 0; j < lines.length; j++) {
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillText(lines[j], pad + 1, pad + 1 + j * lh);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(lines[j], pad, pad + j * lh);
    }
  }
  return tmp.toDataURL('image/png');
};

window.pdCaptureStep = async (cps, nFrames, codeText) => {
  const c = document.getElementById('c');
  const out = [];
  const nextRaf = () => new Promise(r => requestAnimationFrame(r));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__pdStepSeek = true;   // force seek-based positioning for every clip
  window.pdPauseRaf();
  // Pool <video>s are detached texture sources, not in the DOM — use the app's
  // exposed active list (updated by each render) to wait for seeks to land.
  const settled = () => {
    const v = window._pdActiveVideoEls || [];
    return v.length === 0 || v.every(x => !x.seeking && x.readyState >= 2 && x.videoWidth > 0);
  };
  const startCycle = 8;         // any integer: a fresh cycle (clips retrigger to begin)
  const baseWall = 100000, durMs = 1000 / cps;
  // Step through a few warm-up cycles first (discarded) so frame-driven feedback
  // (s("prev")) reaches steady state at the stepping cadence, then capture the
  // final cycle. Harmless for non-feedback blocks.
  const warmCycles = 2;
  const total = (warmCycles + 1) * nFrames;
  for (let i = 0; i < total; i++) {
    const cycle = startCycle + i / nFrames;               // continuous stepping
    const wall = baseWall + (i / nFrames) * durMs;
    // Converge the pool + seeks at this cycle: re-render until a render issues no
    // new seeks (every clip already sits at its expected position). One pass isn't
    // enough when many elements of one clip are needed at different positions
    // (e.g. sometimes(speed(-1)) — forward AND reverse tiles of "ducks"): the pool
    // can reassign elements between passes, and a single render leaves one set
    // mid-seek (frozen, and which set is random per run). The render right before
    // the break displays the fully-settled frame, so we grab straight after.
    for (let pass = 0; pass < 8; pass++) {
      window.pdRenderAt(cycle, cps, wall);
      if (settled()) break;                               // no seeks pending => converged
      for (let k = 0; k < 80 && !settled(); k++) { await nextRaf(); await sleep(8); }
    }
    if (i >= warmCycles * nFrames) out.push(window.__pdGrab(c, codeText));
  }
  return out;
};

// Luminance spread of the current (live) canvas. Used to detect "blank" frames
// (video not yet decoded => transparent => near-zero spread). Reads the live
// frame directly (preserveDrawingBuffer) — no render. Samples a coarse grid.
window.pdProbeSpread = () => {
  const c = document.getElementById('c');
  const tmp = document.createElement('canvas');
  tmp.width = c.width; tmp.height = c.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(c, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let lo = 255, hi = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const i = (y * width + x) * 4;
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (l < lo) lo = l; if (l > hi) hi = l;
    }
  }
  return hi - lo;
};
`;

async function main() {
  const media = resolveExampleMedia(false);
  console.error(`media: ${media.mode}`);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const harness = await startHarness({
    headless: HEADLESS,
    viewport: { width: 640, height: 480 },
    mediaDir: media.mediaDir,
  });
  const { page } = harness;
  page.on("pageerror", e => console.error("  page error:", e.message));

  // The local media mount lives on the harness's own origin. picodevil's
  // resolveUrl() otherwise rewrites bare "/example-media/…" paths against the
  // dev-default server (localhost:47426, not running) — so absolutize them
  // against the harness URL, which has a scheme and passes through untouched.
  const seedEntries = media.entries.map(e => ({
    name: e.name,
    url: e.url.startsWith("/") ? harness.url + e.url : e.url,
  }));

  const blocks = ONLY.length ? BLOCKS.filter(b => ONLY.includes(b.slug)) : BLOCKS;

  for (const b of blocks) {
    process.stderr.write(`  [${b.slug}] eval… `);
    // Navigate with ?pdpreserve=1 so the WebGL buffer is readable for capture.
    // (harness.reload() goes to the bare URL, which wouldn't set the flag.)
    await page.goto(harness.url + "?pdpreserve=1", { waitUntil: "load" });
    await page.waitForFunction(() => typeof (window as any).pdEval === "function", null, { timeout: 10000 });
    await seedMedia(page, seedEntries);
    await page.evaluate(CAPTURE_FN);

    const evalErr = await page.evaluate((c: string) => {
      try { (window as any).pdEval(c); return null; }
      catch (e: any) { return e?.message || String(e); }
    }, b.code);
    if (evalErr) { console.error(`EVAL ERROR: ${evalErr}`); continue; }

    process.stderr.write(`warmup… `);
    await page.waitForTimeout(WARMUP_MS);
    await page.evaluate(() => (document as any).fonts?.ready);

    // Readiness gate: poll until the canvas actually has decoded content, so we
    // never start the capture pass while videos are still buffering (blank).
    let spread = 0;
    for (let i = 0; i < 40; i++) {
      spread = await page.evaluate(() => (window as any).pdProbeSpread());
      if (spread > 20) break;
      await page.waitForTimeout(250);
    }
    if (spread <= 20) process.stderr.write(`(low content spread=${spread}) `);

    process.stderr.write(`capture… `);
    const dataUrls: string[] = await page.evaluate(
      ({ cps, frames, text }) => (window as any).pdCaptureStep(cps, frames, text),
      { cps: CPS, frames: FRAMES, text: WITH_TEXT ? b.code : "" },
    );

    // Write frames to a temp dir, assemble, clean up.
    const frameDir = resolve(OUT_DIR, `.frames-${b.slug}`);
    if (existsSync(frameDir)) rmSync(frameDir, { recursive: true });
    mkdirSync(frameDir);
    dataUrls.forEach((u, i) => {
      const b64 = u.replace(/^data:image\/png;base64,/, "");
      writeFileSync(resolve(frameDir, `f${String(i).padStart(4, "0")}.png`), Buffer.from(b64, "base64"));
    });

    const gifPath = resolve(OUT_DIR, `${b.slug}.gif`);
    execFileSync("ffmpeg", [
      "-y", "-framerate", String(FPS),
      "-i", resolve(frameDir, "f%04d.png"),
      "-vf", `split[s0][s1];[s0]palettegen=max_colors=${MAX_COLORS}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
      "-loop", "0", gifPath,
    ], { stdio: ["ignore", "ignore", "ignore"] });
    if (!bool("keep")) rmSync(frameDir, { recursive: true });

    const kb = (statSync(gifPath).size / 1024).toFixed(0);
    console.error(`✓ ${b.slug}.gif (${kb} KB)`);
  }

  await harness.close();
  console.error(`\nDone → ${OUT_DIR}`);
}

main().catch(e => { console.error("crashed:", e); process.exit(1); });

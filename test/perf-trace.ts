/**
 * Performance tracer for uzuvid.
 *
 * Opens a headful browser, loads a user-specified pattern, captures a
 * Chrome DevTools Protocol performance trace, and prints a summary of
 * where time is being spent between rAF callbacks.
 *
 * Usage:
 *   npx tsx test/perf-trace.ts [--duration 5000]
 *
 * Requires the video server to be running on port 3456.
 */

import { chromium, type CDPSession } from "playwright";
import { createServer } from "vite";

const args = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const DURATION_MS = parseInt(flag("duration", "35000"), 10);
const TRACE_DURATION_MS = parseInt(flag("trace", "20000"), 10);

// The pattern to investigate
const SETUP_CODE = ``;
const PATTERN_CODE = `$: s("<CGI_31.mp4 ~ CGI_32.mp4 ~ CGI_34.mp4 ~ CGI_15.mp4 ~ CGI_16.mp4 ~>, CGI_12.mp4")
  .index().syncStack(10).shuffleStack(rand.segment(2)).index().tile()`;

async function main() {
  const server = await createServer({ server: { port: 0 }, logLevel: "warn" });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : (addr as any).port;
  const url = `http://localhost:${port}`;

  console.error(`Vite at ${url}`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--enable-precise-memory-info"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Capture console errors
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

  await page.goto(url);
  await page.waitForFunction(() => typeof (window as any).uzuEval === "function", null, { timeout: 10000 });
  console.error("App loaded.");

  // Load video first (imperative, non-pattern)
  if (SETUP_CODE) {
    await page.evaluate((code: string) => {
      try { (window as any).uzuEval(code); } catch (e) { console.error(e); }
    }, SETUP_CODE);
    // Wait for video metadata to load
    await page.waitForTimeout(2000);
  }

  // Run the pattern
  await page.evaluate((code: string) => {
    try { (window as any).uzuEval(code); } catch (e: any) { console.error("eval error:", e?.message); }
  }, PATTERN_CODE);
  console.error("Pattern running. Warming up...");

  // Warm-up: let it run before tracing
  await page.waitForTimeout(DURATION_MS - TRACE_DURATION_MS);

  // ---- CDP trace ----
  const cdp: CDPSession = await context.newCDPSession(page);

  // Use the standard set of Chrome trace categories that show painting + GPU
  await cdp.send("Tracing.start", {
    categories: [
      "blink",
      "blink.user_timing",
      "cc",
      "gpu",
      "renderer",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-cc.debug",
      "v8",
      "media",
    ].join(","),
    options: "sampling-frequency=1000",
  });

  // Set up listeners BEFORE ending trace
  const allTraceEvents: any[] = [];
  cdp.on("Tracing.dataCollected", (params: any) => {
    if (Array.isArray(params.value)) {
      allTraceEvents.push(...params.value);
    }
  });

  console.error(`Capturing ${TRACE_DURATION_MS}ms trace...`);
  await page.waitForTimeout(TRACE_DURATION_MS);

  await cdp.send("Tracing.end");

  // Wait for all chunks to arrive
  await new Promise<void>((resolve) => {
    cdp.on("Tracing.tracingComplete", () => resolve());
  });

  console.error("Trace collected, analysing...");

  const allEvents = allTraceEvents;
  console.error(`Raw event count: ${allEvents.length}`);
  if (allEvents.length > 0) {
    console.error("Sample event:", JSON.stringify(allEvents[0]).slice(0, 200));
  }

  // ----- Analysis -----

  // 1. Find rAF / DrawFrame events on the main renderer thread
  // Identify the renderer process (main frame)
  const frameEvents = allEvents.filter(
    (e) => e.name === "DrawFrame" || e.name === "BeginFrame" || e.name === "NeedsBeginFrameChanged"
  );

  // 2. Summarise by event name — total duration and count
  const durationByName = new Map<string, { total: number; count: number; max: number }>();
  for (const e of allEvents) {
    if (!e.name || e.ph !== "X") continue; // only complete events with duration
    const dur = e.dur ?? 0; // microseconds
    const entry = durationByName.get(e.name) ?? { total: 0, count: 0, max: 0 };
    entry.total += dur;
    entry.count++;
    entry.max = Math.max(entry.max, dur);
    durationByName.set(e.name, entry);
  }

  // Sort by total duration descending, show top 30
  const sorted = [...durationByName.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 30);

  console.log("\n=== Top events by total time (microseconds) ===");
  console.log(`${"Event".padEnd(50)} ${"Count".padStart(8)} ${"Total (ms)".padStart(12)} ${"Max (ms)".padStart(10)} ${"Avg (ms)".padStart(10)}`);
  console.log("-".repeat(95));
  for (const [name, { total, count, max }] of sorted) {
    console.log(
      `${name.padEnd(50)} ${String(count).padStart(8)} ${(total / 1000).toFixed(1).padStart(12)} ${(max / 1000).toFixed(1).padStart(10)} ${(total / count / 1000).toFixed(2).padStart(10)}`
    );
  }

  // 3. Find Canvas-specific operations
  console.log("\n=== Canvas / Paint events ===");
  const paintNames = [
    "Canvas2DLayerBridge::flushRecordingOnly",
    "Canvas2DLayerBridge::flush",
    "HTMLCanvasElement::commit",
    "RasterTask",
    "CopyGpuMemoryBuffers",
    "DrawingBuffer::copyToPlatformTexture",
    "SwapBuffers",
    "GrGLGpu::onWritePixels",
    "SkCanvas::drawImage",
    "cc::TileManager::UpdateVisibleTiles",
    "Rasterize",
    "LayerTreeHostImpl::DrawLayers",
    "CompositeLayers",
    "PaintLayer",
    "InvalidateRect",
  ];
  for (const name of paintNames) {
    const entry = durationByName.get(name);
    if (entry) {
      console.log(
        `  ${name}: count=${entry.count} total=${(entry.total / 1000).toFixed(1)}ms avg=${(entry.total / entry.count / 1000).toFixed(2)}ms max=${(entry.max / 1000).toFixed(1)}ms`
      );
    }
  }

  // 4. Frame timing from main thread "FireAnimationFrame" / "FunctionCall"
  const rafEvents = allEvents
    .filter((e) => e.name === "FireAnimationFrame" && e.ph === "X")
    .map((e) => e.dur / 1000); // ms

  if (rafEvents.length > 0) {
    rafEvents.sort((a, b) => a - b);
    const p50 = rafEvents[Math.floor(rafEvents.length * 0.5)];
    const p95 = rafEvents[Math.floor(rafEvents.length * 0.95)];
    console.log(`\n=== rAF callback durations (${rafEvents.length} callbacks) ===`);
    console.log(`  p50=${p50?.toFixed(2)}ms  p95=${p95?.toFixed(2)}ms  max=${rafEvents[rafEvents.length - 1]?.toFixed(2)}ms`);
  }

  // 5. Inter-frame gap analysis
  const frameBegins = allEvents
    .filter((e) => e.name === "BeginMainThreadFrame" && e.ph === "I")
    .map((e) => e.ts)
    .sort((a, b) => a - b);

  if (frameBegins.length > 1) {
    const gaps = frameBegins.slice(1).map((t, i) => (t - frameBegins[i]) / 1000);
    gaps.sort((a, b) => a - b);
    const p50 = gaps[Math.floor(gaps.length * 0.5)];
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    console.log(`\n=== Inter-frame gaps from BeginMainThreadFrame (${gaps.length} gaps) ===`);
    console.log(`  p50=${p50?.toFixed(1)}ms  p95=${p95?.toFixed(1)}ms  max=${gaps[gaps.length - 1]?.toFixed(1)}ms`);
  }

  // 6. GPU thread summary
  const gpuProcesses = allEvents.filter((e) => e.cat?.includes("gpu") || e.pid !== allEvents.find((x) => x.name === "thread_name" && x.args?.name === "CrGpuMain")?.pid);
  const gpuByName = new Map<string, { total: number; count: number }>();
  for (const e of allEvents) {
    if (e.ph !== "X") continue;
    const isGpu = e.cat?.split(",").some((c: string) => ["gpu", "cc"].includes(c.trim()));
    if (!isGpu) continue;
    const entry = gpuByName.get(e.name) ?? { total: 0, count: 0 };
    entry.total += e.dur ?? 0;
    entry.count++;
    gpuByName.set(e.name, entry);
  }
  const gpuSorted = [...gpuByName.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15);
  if (gpuSorted.length > 0) {
    console.log("\n=== GPU/CC thread events (top 15 by total time) ===");
    for (const [name, { total, count }] of gpuSorted) {
      console.log(`  ${name}: count=${count} total=${(total / 1000).toFixed(1)}ms avg=${(total / count / 1000).toFixed(2)}ms`);
    }
  }

  // 7. uzu named measures (blink.user_timing)
  // Look for measure events by name prefix "uzu"
  const uzuByName = new Map<string, { total: number; count: number; max: number; vals: number[] }>();
  for (const e of allEvents) {
    if (!e.name?.startsWith("uzu")) continue;
    if (e.ph !== "X" && e.ph !== "R") continue;
    const dur = e.dur ?? 0;
    const entry = uzuByName.get(e.name) ?? { total: 0, count: 0, max: 0, vals: [] };
    entry.total += dur;
    entry.count++;
    entry.max = Math.max(entry.max, dur);
    entry.vals.push(dur);
    uzuByName.set(e.name, entry);
  }
  if (uzuByName.size > 0) {
    console.log("\n=== uzu named measures ===");
    for (const [name, { total, count, max, vals }] of uzuByName) {
      vals.sort((a, b) => a - b);
      const p50 = vals[Math.floor(vals.length * 0.5)] / 1000;
      const p95 = vals[Math.floor(vals.length * 0.95)] / 1000;
      console.log(`  ${name}: count=${count} total=${(total/1000).toFixed(1)}ms p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${(max/1000).toFixed(2)}ms`);
    }
  }

  // 8. Video decode / media events
  const mediaEvents = allEvents.filter(
    (e) => e.cat?.includes("media") || e.name?.toLowerCase().includes("video") || e.name?.toLowerCase().includes("decode")
  );
  const mediaByName = new Map<string, { total: number; count: number; max: number }>();
  for (const e of mediaEvents) {
    if (e.ph !== "X") continue;
    const entry = mediaByName.get(e.name) ?? { total: 0, count: 0, max: 0 };
    entry.total += e.dur ?? 0;
    entry.count++;
    entry.max = Math.max(entry.max, e.dur ?? 0);
    mediaByName.set(e.name, entry);
  }
  if (mediaByName.size > 0) {
    console.log("\n=== Media/Video/Decode events (top 20) ===");
    const mediaSorted = [...mediaByName.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20);
    for (const [name, { total, count, max }] of mediaSorted) {
      console.log(`  ${name}: count=${count} total=${(total/1000).toFixed(1)}ms avg=${(total/count/1000).toFixed(2)}ms max=${(max/1000).toFixed(2)}ms`);
    }
  }

  // 9. Seek-correlated spike analysis: find rAF frames > 20ms and check what's inside
  const rafEventsRaw = allEvents.filter((e) => e.name === "FireAnimationFrame" && e.ph === "X");
  const slowRafs = rafEventsRaw.filter((e) => (e.dur ?? 0) > 20000); // > 20ms
  console.log(`\n=== Slow rAF frames (>${20}ms): ${slowRafs.length} of ${rafEventsRaw.length} total ===`);
  if (slowRafs.length > 0) {
    // For each slow frame, find all child events (same pid/tid, overlapping ts range)
    const slowChildNames = new Map<string, number>();
    for (const raf of slowRafs) {
      const rafStart = raf.ts;
      const rafEnd = raf.ts + (raf.dur ?? 0);
      const children = allEvents.filter(
        (e) => e.pid === raf.pid && e.tid === raf.tid && e.ph === "X" && e.ts >= rafStart && e.ts + (e.dur ?? 0) <= rafEnd && e.name !== "FireAnimationFrame"
      );
      for (const c of children) {
        slowChildNames.set(c.name, (slowChildNames.get(c.name) ?? 0) + (c.dur ?? 0));
      }
    }
    const slowChildSorted = [...slowChildNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log("  Top events inside slow rAF frames:");
    for (const [name, total] of slowChildSorted) {
      console.log(`    ${name}: total=${(total/1000).toFixed(1)}ms`);
    }
  }

  console.log(`\nTotal trace events: ${allEvents.length}`);
  console.error("\nDone. Close the browser window to exit.");

  // Keep browser open so user can see the running pattern
  await page.waitForTimeout(10000);
  await browser.close();
  await server.close();
}

main().catch((e) => {
  console.error("Perf trace crashed:", e);
  process.exit(1);
});

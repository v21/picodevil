/**
 * Scratch probe: load the `canalslices` example in a headless browser, let the
 * real rAF loop run, and watch what happens to each active video element's
 * playhead (currentTime), src (network vs blob:), and readyState over time.
 *
 * Goal: see empirically whether/when the slices freeze, and correlate it with
 * the proactive blob src-swap and any aborted network requests.
 *
 *   npx tsx test/probe-canalslices.ts [--cdn] [--headed] [--secs 20] [--mbps 100]
 *
 * Local files serve far faster than a real network, so by default we throttle
 * the page's download throughput via CDP (Network.emulateNetworkConditions) to
 * make the blob-fetch / streaming dynamics resemble the over-the-network case.
 * Pass `--mbps 0` to disable throttling.
 */
import { startHarness, seedMedia, parseFlags } from "./harness";
import { resolveExampleMedia } from "./example-media";
import { examples } from "../src/examples";

const { flag, bool } = parseFlags();
const FORCE_CDN = bool("cdn");
const HEADLESS = !bool("headed");
const SECS = parseInt(flag("secs", "20"), 10);
const MBPS = parseFloat(flag("mbps", "100"));
const INTERVAL_MS = 250;

const ex = examples.find(e => e.name === "canalslices")!;

async function main() {
  const media = resolveExampleMedia(FORCE_CDN);
  console.error(`media: ${media.mode}`);
  const harness = await startHarness({ headless: HEADLESS, viewport: { width: 800, height: 600 }, mediaDir: media.mediaDir });
  const { page, context } = harness;

  // Throttle download throughput so local serving doesn't outrun a real network.
  if (MBPS > 0) {
    const bytesPerSec = (MBPS * 1_000_000) / 8;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: 20, downloadThroughput: bytesPerSec, uploadThroughput: bytesPerSec,
    });
    console.error(`throttled: ${MBPS} Mbps (${(bytesPerSec / 1e6).toFixed(1)} MB/s) → ~${(103063282 / bytesPerSec).toFixed(1)}s for the full blob fetch`);
  }

  // Surface page errors and aborted/failed canalboat requests (mirrors the HAR).
  page.on("pageerror", e => console.error("PAGEERROR:", e.message));
  page.on("requestfailed", r => {
    if (r.url().includes("canalboat")) {
      console.error(`  [reqfailed] ${r.url().split("/").pop()}  ${r.failure()?.errorText ?? ""}  (range=${r.headers()["range"] ?? "-"})`);
    }
  });
  page.on("response", async r => {
    if (r.url().includes("canalboat")) {
      console.error(`  [response ] ${r.status()} ${r.url().split("/").pop()}  (range=${r.request().headers()["range"] ?? "-"})`);
    }
  });

  await harness.reload();
  // Make relative /example-media/ paths absolute against the Vite origin — otherwise
  // a bare path resolves against the dev-default server URL (localhost:47426) and 404s.
  const entries = media.entries.map(e => ({ name: e.name, url: new URL(e.url, harness.url).href }));
  await seedMedia(page, entries);
  const evalError = await page.evaluate((code: string) => {
    try { (window as any).pdEval(code); return null; } catch (e: any) { return e?.message || String(e); }
  }, ex.code);
  if (evalError) console.error("EVAL ERROR:", evalError);

  console.error(`\nt(ms)  | per element: idx[src currentTime readyState net paused]`);
  const ticks = Math.floor((SECS * 1000) / INTERVAL_MS);
  for (let i = 0; i <= ticks; i++) {
    const snap = await page.evaluate(() => {
      const els = (window as any)._pdActiveVideoEls as any[];
      return (els ?? []).map((el, idx) => ({
        idx,
        blob: typeof el.src === "string" && el.src.startsWith("blob:"),
        src: String(el.src).slice(-40),
        srcUrl: String(el._state?.srcUrl ?? "").slice(-40),
        t: +el.currentTime.toFixed(3),
        rs: el.readyState,
        net: el.networkState,
        paused: el.paused,
      }));
    });
    const ms = i * INTERVAL_MS;
    const cells = snap.map(s => `${s.idx}[${s.blob ? "BLOB" : "net "} t=${s.t.toFixed(3)} rs=${s.rs} n=${s.net}${s.paused ? " P" : ""}]`).join("  ");
    console.error(`${String(ms).padStart(5)}  | ${snap.length ? cells : "(no active video els)"}`);
    if (i === 1 && snap.length) console.error(`        src=${snap[0].src}  srcUrl=${snap[0].srcUrl}`);
    await page.waitForTimeout(INTERVAL_MS);
  }

  await harness.close();
}

main().catch(e => { console.error(e); process.exit(1); });

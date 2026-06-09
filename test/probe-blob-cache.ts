/**
 * Experiment: can the blob be built from bytes the <video> element already
 * streamed "naturally", served from the HTTP cache instead of a second download?
 *
 * Tests whether a <video>'s range streaming populates the disk cache that a
 * later fetch() reads. Uses CDP to report, per response, `fromDiskCache` and
 * `encodedDataLength` (actual bytes off the network).
 *
 *   npx tsx test/probe-blob-cache.ts [--stream 15] [--mbps 50]
 */
import { startHarness, parseFlags } from "./harness";

const { flag } = parseFlags();
const STREAM_S = parseInt(flag("stream", "15"), 10);
const MBPS = parseFloat(flag("mbps", "50"));
const URL_ = "https://videoclip.picodevil.com/canalboat.mp4";
const TOTAL = 103063282;

async function main() {
  const harness = await startHarness({ headless: true, viewport: { width: 400, height: 300 } });
  const { page, context } = harness;

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (MBPS > 0) {
    const bps = (MBPS * 1_000_000) / 8;
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: bps, uploadThroughput: bps });
  }
  // Map requestId -> {range, fromCache} at responseReceived, then fill bytes at loadingFinished.
  const reqs = new Map<string, any>();
  cdp.on("Network.requestWillBeSent", (e: any) => {
    if (e.request.url.includes("canalboat")) reqs.set(e.requestId, { range: e.request.headers["Range"] ?? e.request.headers["range"] ?? "-", phase: "(pending)" });
  });
  cdp.on("Network.responseReceived", (e: any) => {
    const r = reqs.get(e.requestId);
    if (r) { r.status = e.response.status; r.fromDiskCache = e.response.fromDiskCache; r.type = e.type; }
  });
  cdp.on("Network.loadingFinished", (e: any) => {
    const r = reqs.get(e.requestId);
    if (r) r.encodedDataLength = e.encodedDataLength;
  });

  await harness.reload();

  // Phase 1: stream the clip through a <video> element for STREAM_S seconds.
  console.error(`streaming canalboat through <video> for ${STREAM_S}s (throttle ${MBPS} Mbps)...`);
  await page.evaluate((url) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous"; v.muted = true; v.playsInline = true; v.src = url;
    (window as any).__v = v;
    return v.play().catch(() => {});
  }, URL_);
  await page.waitForTimeout(STREAM_S * 1000);

  const buffered = await page.evaluate(() => {
    const v = (window as any).__v as HTMLVideoElement;
    const b: [number, number][] = [];
    for (let i = 0; i < v.buffered.length; i++) b.push([+v.buffered.start(i).toFixed(1), +v.buffered.end(i).toFixed(1)]);
    return { dur: v.duration, ranges: b, ct: v.currentTime };
  });
  console.error(`  buffered ranges (s): ${JSON.stringify(buffered.ranges)}  duration=${buffered.dur?.toFixed(1)} ct=${buffered.ct?.toFixed(1)}`);

  // Phase 2: now fetch() the whole file (what fetchVideoBlob does) and see how much hits the network.
  console.error(`fetch()ing the whole file for the blob...`);
  const fetched = await page.evaluate(async (url) => {
    const t0 = performance.now();
    const r = await fetch(url);
    const b = await r.blob();
    return { ms: Math.round(performance.now() - t0), size: b.size, status: r.status };
  }, URL_);
  // Let CDP events settle.
  await page.waitForTimeout(500);

  console.error(`\n=== canalboat requests (CDP) ===`);
  for (const [, r] of reqs) {
    const mb = r.encodedDataLength != null ? (r.encodedDataLength / 1e6).toFixed(1) : "?";
    console.error(`  type=${(r.type ?? "?").padEnd(6)} status=${r.status ?? "?"} range=${String(r.range).padEnd(14)} fromDiskCache=${r.fromDiskCache} netBytes=${mb}MB`);
  }
  const totalNet = [...reqs.values()].reduce((a, r) => a + (r.encodedDataLength ?? 0), 0);
  console.error(`\nblob fetch(): ${fetched.ms}ms, ${(fetched.size / 1e6).toFixed(1)}MB, status ${fetched.status}`);
  console.error(`total bytes off network across ALL canalboat requests: ${(totalNet / 1e6).toFixed(1)}MB (file is ${(TOTAL / 1e6).toFixed(1)}MB)`);
  console.error(`→ if the blob fetch were free from cache, total ≈ what the <video> streamed; if it re-downloaded, total ≈ ${(TOTAL / 1e6).toFixed(0)}MB + stream`);

  await harness.close();
}
main().catch(e => { console.error(e); process.exit(1); });

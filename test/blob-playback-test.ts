/**
 * End-to-end "drop → blob → playback" integration test.
 *
 * The upload integration test (upload-integration-test.ts) stops at the
 * registry: it proves a dropped file becomes a blob: entry (and, with a
 * server, swaps to a server URL). This test closes the remaining gap — it
 * proves the resulting blob: URL actually *decodes and renders a frame*.
 *
 * Flow, in a real WebGL-capable Chromium:
 *   1. Drop a genuinely decodable MP4 (public/test-assets/red.mp4, a solid red
 *      clip) onto #tab-videos by fetching it in-page and dispatching a real
 *      DragEvent carrying a File.
 *   2. Assert the media registry now holds a `blob:` entry (the drop path, not
 *      a server URL — the server probe is forced to "error" first so no upload
 *      is attempted).
 *   3. Render `video("dropped-red")`, let the blob decode, read back the canvas
 *      and assert it shows a non-blank, predominantly-red frame.
 *
 * Usage:
 *   npx tsx test/blob-playback-test.ts [--headless] [--settle 2000]
 *
 * Exit code: 0 = pass, 1 = failure.
 */

import { startHarness, renderAndSettle, type PixelData } from "./harness";

const args = process.argv.slice(2);
const HEADLESS = args.includes("--headless") || !args.includes("--headed");
const settleIdx = args.indexOf("--settle");
const SETTLE_MS = settleIdx >= 0 ? parseInt(args[settleIdx + 1], 10) : 2000;

/** Mean RGBA + fraction of (mostly) opaque pixels across the whole frame. */
function analyze(px: PixelData) {
  let r = 0, g = 0, b = 0, a = 0, opaque = 0;
  const n = px.width * px.height;
  for (let i = 0; i < px.data.length; i += 4) {
    r += px.data[i];
    g += px.data[i + 1];
    b += px.data[i + 2];
    a += px.data[i + 3];
    if (px.data[i + 3] > 200) opaque++;
  }
  return { r: r / n, g: g / n, b: b / n, a: a / n, opaqueFrac: opaque / n };
}

async function main() {
  const h = await startHarness({ headless: HEADLESS, viewport: { width: 400, height: 300 } });
  const errors: string[] = [];
  h.page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

  try {
    // Start from a clean registry, and pin the server to a dead URL probed to
    // "error" so the drop handler takes the pure-blob path. This must be robust
    // even when a real picodevil-server happens to be running on the dev-default
    // port (47426) — otherwise it would accept the upload and swap the blob URL
    // for a server one, and this test would no longer exercise blob playback.
    const status = await h.page.evaluate(async () => {
      const reg = await import("/src/media-registry.ts");
      reg.clearAll();
      const sc = await import("/src/server-config.ts");
      sc.setServerUrl("http://127.0.0.1:59999"); // closed port → connection refused
      await sc.probeHealth();
      return sc.getServerStatus();
    });
    if (status !== "error") {
      errors.push(`expected server status "error" (no upload), got "${status}"`);
    }
    await h.page.locator("#tab-videos").waitFor({ state: "attached", timeout: 5000 });

    // 1. Drop a real, decodable MP4 as a File onto the videos tab.
    await h.page.evaluate(async () => {
      const res = await fetch("/test-assets/red.mp4");
      const blob = await res.blob();
      const file = new File([blob], "dropped-red.mp4", { type: "video/mp4" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const tab = document.getElementById("tab-videos")!;
      tab.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      tab.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    });

    // 2. The entry exists and carries a blob: URL (not a server URL).
    const entry = await h.page.evaluate(async () => {
      const reg = await import("/src/media-registry.ts");
      return reg.getAllEntries().find((e: any) => e.name === "dropped-red") ?? null;
    });
    if (!entry) {
      errors.push("drop did not add a 'dropped-red' entry to the media registry");
    } else {
      if (!String((entry as any).url).startsWith("blob:")) {
        errors.push(`expected a blob: URL on the dropped entry, got: ${(entry as any).url}`);
      }
      // The blob URL has no extension; the type must be carried over from the
      // dropped File (video/mp4), not defaulted to "image".
      if ((entry as any).type !== "video") {
        errors.push(`expected the dropped entry to be typed "video", got "${(entry as any).type}"`);
      }
    }

    // 3. Render via s() — which trusts the registry's type — so this also
    //    exercises the type passthrough: a mistyped "image" entry would render
    //    nothing here. Confirm the blob decodes to a red frame.
    await h.page.evaluate(() => (window as any).pdEval(`$: s("dropped-red")`));
    const { pixels, settled } = await renderAndSettle(h.page, {
      cycle: 0, cps: 0.5, settleMs: SETTLE_MS, maxAttempts: 25, wallMs: 0,
    });
    const c = analyze(pixels);

    // Hard requirement: the frame is actually drawn (mostly opaque, not a blank
    // transparent/black canvas).
    if (c.opaqueFrac < 0.5) {
      errors.push(
        `frame looks blank — only ${(c.opaqueFrac * 100).toFixed(0)}% opaque ` +
        `(mean rgba ${c.r.toFixed(0)},${c.g.toFixed(0)},${c.b.toFixed(0)},${c.a.toFixed(0)}); ` +
        `blob never decoded/rendered (settled=${settled})`,
      );
    } else if (!(c.r > 100 && c.r > c.g + 60 && c.r > c.b + 60)) {
      // Source is solid red — a correctly decoded blob frame is predominantly red.
      errors.push(
        `frame decoded but isn't red — mean rgb ${c.r.toFixed(0)},${c.g.toFixed(0)},${c.b.toFixed(0)} ` +
        `(expected red-dominant); blob may have rendered the wrong source`,
      );
    }

    // 4. Drop an UNDECODABLE blob (garbage bytes — stands in for the 10-bit HEVC
    //    .MOV case). It must be flagged `unavailable` and show a ⚠ in the list,
    //    rather than silently sitting there looking playable.
    await h.page.evaluate(() => {
      const file = new File([new Uint8Array(2048)], "broken-clip.mp4", { type: "video/mp4" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const tab = document.getElementById("tab-videos")!;
      tab.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      tab.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    });

    const flagged = await h.page.waitForFunction(async () => {
      const reg = await import("/src/media-registry.ts");
      const e = reg.getAllEntries().find((x: any) => x.name === "broken-clip");
      return !!e && (e as any).unavailable === true;
    }, null, { timeout: 10000 }).then(() => true).catch(() => false);
    if (!flagged) {
      errors.push("undecodable blob was not flagged unavailable after its thumbnail probe failed");
    }

    const warnShown = await h.page.evaluate(() =>
      !!document.querySelector('#tab-videos [data-entry-name="broken-clip"] .vid-thumb-warn'),
    );
    if (!warnShown) {
      errors.push("expected a ⚠ (.vid-thumb-warn) in the list row for the undecodable blob");
    }

    const relevant = errors.filter((e) => !/Failed to load resource|no supported source|ERR_/.test(e));
    if (relevant.length === 0) {
      console.log("✅ drop → blob → playback: red clip decoded to a frame; undecodable clip flagged ⚠");
      console.log(`   red: mean rgba ${c.r.toFixed(0)},${c.g.toFixed(0)},${c.b.toFixed(0)},${c.a.toFixed(0)} · opaque ${(c.opaqueFrac * 100).toFixed(0)}% · settled=${settled}`);
      process.exit(0);
    } else {
      console.error("❌ drop → blob → playback");
      relevant.forEach((e) => console.error("   •", e));
      process.exit(1);
    }
  } finally {
    await h.close();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

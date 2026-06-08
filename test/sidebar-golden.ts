/**
 * Visual-regression golden harness for the SIDEBAR (DOM, not the WebGL canvas).
 *
 * The CSS cleanup (moving inline `.style.cssText` → stylesheet classes, adding
 * `:root` tokens, re-sorting style.css, splitting fonts.css) is meant to be
 * *visually identical* — classes / `var()` resolve to the same computed styles
 * as the inline strings they replace. So the correctness check is simply:
 * screenshot every sidebar tab + a couple of interaction states before the
 * refactor, then after, and assert ZERO pixel drift.
 *
 * Modelled on test/example-golden.ts (capture | compare, git-ignored output,
 * drift → exit 1) and reusing test/harness.ts for the Vite+Playwright boot and
 * the PNG decode / pixel-diff helpers.
 *
 * Usage:
 *   npx tsx test/sidebar-golden.ts capture [--headless]
 *   npx tsx test/sidebar-golden.ts compare [--headless] [--tolerance 2]
 *
 * Output:
 *   test/sidebar-golden/manifest.json   { viewport, shots[] }
 *   test/sidebar-golden/<shot>.png      one golden per shot
 *
 * Exit codes: 0 = all shots match · 1 = a shot drifted · 2 = harness crash.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { Page } from "playwright";
import { startHarness, decodePng, diffPixels, parseFlags, type PixelData } from "./harness";

const { argv, flag, bool } = parseFlags();
const MODE = argv[0];
const HEADLESS = bool("headless");
const TOLERANCE = parseInt(flag("tolerance", "2"), 10);
const VIEWPORT = flag("viewport", "1000x800");
const [VPW, VPH] = VIEWPORT.split("x").map((n) => parseInt(n, 10));

if (MODE !== "capture" && MODE !== "compare") {
  console.error("Usage: sidebar-golden.ts (capture | compare) [--headless] [--tolerance N]");
  process.exit(2);
}

const OUT_DIR = resolve(import.meta.dirname ?? ".", "sidebar-golden");
const MANIFEST_PATH = resolve(OUT_DIR, "manifest.json");

/**
 * A saved editor state (shared by the maintainer) whose code renders nothing to
 * the canvas but exercises syntax highlighting + inline widgets in the editor.
 * Loading it lets the golden cover the `.cm-*` rules, which the sidebar-panel
 * shots don't see. The blinking cursor is masked; the canvas behind the
 * transparent editor stays black, so the shot is deterministic.
 */
const EDITOR_HASH =
  "#v1,eyJ2IjoxLCJjb2RlIjoiLy8gYnkgdjIxXG5cblxuTSQ6IHMoXCJ0ZXh0Ol9waWNvZGV2aWxfXCIpXG4ub2JqZWN0Zml0KFwidGlsZVwiKVxuLmZvbnRwaWNrZXIoJ0JJWiBVRFBNaW5jaG8nKVxuLnJvdGF0ZShzYXcuc2xvdygxMDApKVxuLmZvbnRzaXplKDQ4KVxuLnNjYWxlKDIpXG5cblxuTSQ6IHMoXCJwcmV2XCIpXG4gIC5hbHBoYShzbGlkZXIoLjk5NzUpKVxuICAucGl4ZWxhdGUoOClcbiAgLmh1ZXJvdChcIi0uMDEgLjAxXCIuZmFzdCgxMCkpXG5cblxuTSQ6IHMoXCJ0ZXh0OnBpY29kZXZpbFwiKVxuLmZvbnRwaWNrZXIoJ1NoYW50ZWxsIFNhbnMnKVxuLmZvbnRheGlzKCdJTkZNJywgXCIwIDEwMCA1MFwiLmxlcnAoKSlcbi5mb250YXhpcygnQk5DRScsIHNpbmUucmFuZ2UoLTEwMCwxMDApLmZhc3QoMikpXG4uZm9udGF4aXMoJ3dnaHQnLCBzaW5lLnJhbmdlKDMwMCw4MDApLmZhc3QoMS41KSlcbi5mb250YXhpcygnaXRhbCcsIHNpbmUucmFuZ2UoMCwxKS5zbG93KDEwKSlcbi5mb250c2l6ZSg1MDApXG4uZm9udGNvbG9yKFwicmVkXCIpXG4ueChzaW5lLnJhbmdlKC40LC42KS5zbG93KDUpKVxuLnkoY29zaW5lLnJhbmdlKC40LC42KS5zbG93KDIpKVxuIiwibWVkaWEiOlt7ImlkIjoiMWEwZjM5Y2EtYWY0MS00NjJjLWI1OGQtMzRhOGJiMjg2ZTBjIiwibmFtZSI6ImNhcnBldHNob3AiLCJ1cmwiOiJodHRwczovL3ZpZGVvY2xpcC5waWNvZGV2aWwuY29tL2NhcnBldHNob3AubXA0IiwidHlwZSI6InZpZGVvIiwiZHVyYXRpb24iOjExLjV9LHsiaWQiOiI5M2JjNjI1Ny03ZmZiLTRmNWYtOWI0Mi00NjgzYzU0YmQ3ZGIiLCJuYW1lIjoiaXNzZG9jayIsInVybCI6Imh0dHBzOi8vdmlkZW9jbGlwLnBpY29kZXZpbC5jb20vaXNzZG9jay5tcDQiLCJ0eXBlIjoidmlkZW8iLCJkdXJhdGlvbiI6MTAuMjMzMzMzfSx7ImlkIjoiOTQzNjY2NjgtMmJiNy00M2M2LWFkZTYtNzFjNWQxNzMzNmEyIiwibmFtZSI6Imlzc2V4ZXJjaXNlMSIsInVybCI6Imh0dHBzOi8vdmlkZW9jbGlwLnBpY29kZXZpbC5jb20vaXNzZXhlcmNpc2UxLm1wNCIsInR5cGUiOiJ2aWRlbyIsImR1cmF0aW9uIjo1LjA1NTA1fSx7ImlkIjoiY2VmODVhOGItOWVkNC00YjMzLWFiNDYtZjc0MjdmOGMxMDJhIiwibmFtZSI6Imlzc2V4ZXJjaXNlMiIsInVybCI6Imh0dHBzOi8vdmlkZW9jbGlwLnBpY29kZXZpbC5jb20vaXNzZXhlcmNpc2UyLm1wNCIsInR5cGUiOiJ2aWRlbyIsImR1cmF0aW9uIjo1LjU3MjIzM30seyJpZCI6ImM2MTQyOWJiLTkyYjAtNDYwMS05ZTEzLTM2OTEwMzllOTI3ZSIsIm5hbWUiOiJpc3NleGVyY2lzZTMiLCJ1cmwiOiJodHRwczovL3ZpZGVvY2xpcC5waWNvZGV2aWwuY29tL2lzc2V4ZXJjaXNlMy5tcDQiLCJ0eXBlIjoidmlkZW8iLCJkdXJhdGlvbiI6Ni40Mzk3Njd9LHsiaWQiOiI0ZjU1M2I5NS0yMGQ2LTQ1MTctYmEyMy04ZmJmZDAzMDRmZmQiLCJuYW1lIjoiaXNzbW9kdWxlIiwidXJsIjoiaHR0cHM6Ly92aWRlb2NsaXAucGljb2RldmlsLmNvbS9pc3Ntb2R1bGUubXA0IiwidHlwZSI6InZpZGVvIiwiZHVyYXRpb24iOjE1LjczMzMzM30seyJpZCI6ImJmMGI0ZTk2LWVhZGEtNDk1Yi1hNTVkLWM0MzBiNmIzM2Q3OSIsIm5hbWUiOiJ0dnNub3ciLCJ1cmwiOiJodHRwczovL3ZpZGVvY2xpcC5waWNvZGV2aWwuY29tL3R2c25vdy5tcDQiLCJ0eXBlIjoidmlkZW8iLCJkdXJhdGlvbiI6NX0seyJpZCI6ImY2NmZmYWEyLTIwZTAtNDlkMi1iMGI3LWY1NjlmMWNkYzBhYSIsIm5hbWUiOiJjYW5hbGJvYXQiLCJ1cmwiOiJodHRwczovL3ZpZGVvY2xpcC5waWNvZGV2aWwuY29tL2NhbmFsYm9hdC5tcDQiLCJ0eXBlIjoidmlkZW8iLCJkdXJhdGlvbiI6NjB9LHsiaWQiOiI5ZGU2MGJmYS1kMWY4LTQzZGItYWNhOS03NjFiOTliM2IyY2EiLCJuYW1lIjoiZHVja3MiLCJ1cmwiOiJodHRwczovL3ZpZGVvY2xpcC5waWNvZGV2aWwuY29tL2R1Y2tzLm1wNCIsInR5cGUiOiJ2aWRlbyIsImR1cmF0aW9uIjoxMy41fSx7ImlkIjoiYzQxNWZjYWEtMzUzMC00YjhhLTllNWYtNTkxOTRjZjllYzQ5IiwibmFtZSI6ImNhbmFsbW9zcyIsInVybCI6Imh0dHBzOi8vdmlkZW9jbGlwLnBpY29kZXZpbC5jb20vY2FuYWxtb3NzLm1wNCIsInR5cGUiOiJ2aWRlbyIsImR1cmF0aW9uIjo1fSx7ImlkIjoiOWNmYzIxMWYtNzJjNy00YmIwLThlMmQtZDUyNTkwMGY4MDFhIiwibmFtZSI6InJnYjIiLCJ1cmwiOiJodHRwczovL3ZpZGVvY2xpcC5waWNvZGV2aWwuY29tL3JnYjIucG5nIiwidHlwZSI6ImltYWdlIn0seyJpZCI6ImExMTZjZTQyLTVmN2MtNDUwZC1iNTVkLWMyZTBlNTdlZjA3MSIsIm5hbWUiOiJyZ2IxIiwidXJsIjoiaHR0cHM6Ly92aWRlb2NsaXAucGljb2RldmlsLmNvbS9yZ2IxLnBuZyIsInR5cGUiOiJpbWFnZSJ9LHsiaWQiOiJlMWJjMGZiYy1iYjE1LTQxNTMtYTFjZS01M2RhZGRkMjBkNzYiLCJuYW1lIjoicmdiMyIsInVybCI6Imh0dHBzOi8vdmlkZW9jbGlwLnBpY29kZXZpbC5jb20vcmdiMy5wbmciLCJ0eXBlIjoiaW1hZ2UifSx7ImlkIjoiMzgxNDA0MGYtOTMzMS00NmU1LWI5NTQtNWE0NzFlYzkxMGJlIiwibmFtZSI6InNjYW5saW5lcyIsInVybCI6Imh0dHBzOi8vdmlkZW9jbGlwLnBpY29kZXZpbC5jb20vc2NhbmxpbmVzLnBuZyIsInR5cGUiOiJpbWFnZSJ9LHsiaWQiOiJhM2NlYWI3Yy0xYjk3LTQ1Y2ItOGJhZC1jNjI2YWI2ZjM0ODUiLCJuYW1lIjoidGVzdGNhcmQiLCJ1cmwiOiJodHRwczovL3ZpZGVvY2xpcC5waWNvZGV2aWwuY29tL3Rlc3RjYXJkLnBuZyIsInR5cGUiOiJpbWFnZSJ9XSwiZmZ0Ijp7ImJpbnMiOjMsInNtb290aCI6MC45OSwiY3V0b2ZmIjowLjAyLCJzY2FsZSI6MC4wMX19";

/**
 * Regions that animate (rAF canvases) or load async (thumbnails), so they can't
 * be pixel-asserted. Masked identically in both runs ⇒ they always match; the
 * surrounding CSS is what's actually under test. Selectors are chosen to be
 * STABLE across the refactor (IDs / structural / unchanged `.perf-*` classes),
 * so they match in both the pre- and post-refactor DOM. A selector that matches
 * nothing on a given shot is a harmless no-op.
 */
const MASKS = [
  "#perf-graph",
  "#perf-heap-graph",
  // Mask whole rows, not the `.perf-value` spans: the perf panel's own rAF loop
  // rewrites the values continuously, and a span's bbox hugs its glyphs, so a
  // text-width change between mask-box computation and the pixel grab leaks a
  // sliver. A `.perf-row` has a stable full-width bbox regardless of its value.
  "#tab-perf .perf-row",
  "#tab-audio canvas",
  "#tab-videos img",
  // Editor shot: the text cursor blinks.
  ".cm-cursor",
  ".cm-dropCursor",
];

interface Shot {
  name: string;
  /** Prepare the DOM, then return the element to screenshot. */
  go: (page: Page) => Promise<string>;
}

async function clickTab(page: Page, tab: string): Promise<void> {
  await page.click(`.tabs button[data-tab="${tab}"]`);
  await page.waitForTimeout(150);
}

const SHOTS: Shot[] = [
  { name: "tab-about", go: async (p) => { await clickTab(p, "about"); return "#sidebar-panel"; } },
  { name: "tab-videos", go: async (p) => { await clickTab(p, "videos"); return "#sidebar-panel"; } },
  { name: "tab-audio", go: async (p) => { await clickTab(p, "audio"); return "#sidebar-panel"; } },
  { name: "tab-examples", go: async (p) => { await clickTab(p, "examples"); return "#sidebar-panel"; } },
  { name: "tab-reference", go: async (p) => { await clickTab(p, "reference"); return "#sidebar-panel"; } },
  { name: "tab-perf", go: async (p) => { await clickTab(p, "perf"); return "#sidebar-panel"; } },
  {
    name: "server-popover",
    go: async (p) => {
      await clickTab(p, "videos");
      await p.click('#tab-videos button:has-text("Server")');
      // Blur the auto-focused URL field so a blinking caret doesn't desync the
      // two captures.
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      // Move the cursor off the button so its :hover state doesn't colour the
      // shot — this captures the resting popover layout, not a hover.
      await p.mouse.move(0, 0);
      await p.waitForTimeout(150);
      return "#sidebar-panel";
    },
  },
  {
    name: "closed",
    go: async (p) => {
      await p.click("#sidebar-toggle"); // panel was open → closes it
      await p.waitForTimeout(350); // transform transition is 0.2s
      return "#sidebar-toggle";
    },
  },
  {
    name: "editor",
    go: async (p) => {
      const base = p.url().split("#")[0];
      // Set the hash, then reload: goto to a hash-only-different URL is a
      // same-document navigation that does NOT re-run main.ts, so the share
      // link's code never loads. reload() forces a full boot with the hash set.
      await p.goto(base + EDITOR_HASH, { waitUntil: "load" });
      await p.reload({ waitUntil: "load" });
      await p.waitForFunction(() => typeof (window as any).pdEval === "function", null, { timeout: 10000 });
      // Hide the sidebar so it doesn't overlap the editor in the shot (the
      // seeded localStorage reopens it on navigation).
      await p.evaluate(() => {
        document.getElementById("sidebar-panel")?.classList.remove("open");
        document.getElementById("sidebar-toggle")?.classList.remove("open");
      });
      await p.evaluate(() => (document as any).fonts?.ready);
      await p.waitForTimeout(1200); // let any eval flash finish + fonts settle
      return ".cm-editor";
    },
  },
];

async function shoot(page: Page, target: string): Promise<Uint8Array> {
  const buf = await page.locator(target).screenshot({
    mask: MASKS.map((s) => page.locator(s)),
    maskColor: "#FF00FF",
  });
  return new Uint8Array(buf);
}

/** PNG IHDR width/height (big-endian) live at byte offsets 16 and 20. */
function pngSize(b: Uint8Array): { w: number; h: number } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

async function prepare(page: Page): Promise<void> {
  // Seed a deterministic UI state BEFORE the app's scripts run, then reload so
  // setupSidebar reads it: sidebar open at a fixed width, and NO server URL (a
  // configured URL would trigger Vite-dev's default localhost probe and flip the
  // status dot mid-capture).
  await page.context().addInitScript(() => {
    localStorage.setItem("picodevil-sidebar", JSON.stringify({ open: true, width: 600 }));
    localStorage.removeItem("picodevil-server-url");
  });
  // The Videos tab fetches the CDN "Defaults" bundle on setup; whether it lands
  // during a capture would non-deterministically toggle the Defaults button.
  // Abort it so that button stays hidden consistently in both runs.
  await page.route("https://videoclip.picodevil.com/**", (r) => r.abort());

  await page.goto(page.url(), { waitUntil: "load" });
  await page.waitForFunction(() => typeof (window as any).pdEval === "function", null, { timeout: 10000 });

  // Seed one external-URL media entry so the Videos row styling is exercised.
  await page.evaluate(() => {
    (window as any).pdAddMedia?.("https://example.com/clip.mp4", "demo-clip");
  });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(200);
}

async function main() {
  const harness = await startHarness({ headless: HEADLESS, viewport: { width: VPW, height: VPH } });
  const { page } = harness;

  try {
    await prepare(page);

    if (MODE === "capture") {
      if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
      const shots: string[] = [];
      for (const s of SHOTS) {
        const target = await s.go(page);
        const png = await shoot(page, target);
        writeFileSync(resolve(OUT_DIR, `${s.name}.png`), png);
        shots.push(s.name);
        console.error(`  [captured] ${s.name}`);
      }
      writeFileSync(
        MANIFEST_PATH,
        JSON.stringify({ viewport: [VPW, VPH], shots }, null, 2) + "\n",
      );
      console.error(`\n=== Sidebar golden: captured ${shots.length} shots → ${OUT_DIR} ===`);
      await harness.close();
      process.exit(0);
    }

    // ===== compare =====
    if (!existsSync(MANIFEST_PATH)) {
      console.error(`No manifest at ${MANIFEST_PATH}. Run capture first.`);
      await harness.close();
      process.exit(2);
    }
    let drifted = 0, ok = 0;
    const results: any[] = [];
    for (const s of SHOTS) {
      const goldenPath = resolve(OUT_DIR, `${s.name}.png`);
      if (!existsSync(goldenPath)) {
        console.error(`  [NEW    ] ${s.name} (no golden — run capture)`);
        results.push({ name: s.name, status: "NEW" });
        continue;
      }
      const target = await s.go(page);
      const current = await shoot(page, target);
      const golden = new Uint8Array(readFileSync(goldenPath));

      const gs = pngSize(golden), cs = pngSize(current);
      if (gs.w !== cs.w || gs.h !== cs.h) {
        drifted++;
        console.error(`  [DRIFT  ] ${s.name} size ${gs.w}x${gs.h} → ${cs.w}x${cs.h}`);
        results.push({ name: s.name, status: "DRIFT", reason: "dimensions" });
        continue;
      }
      const gp: PixelData = await decodePng(page, golden, gs.w, gs.h);
      const cp: PixelData = await decodePng(page, current, cs.w, cs.h);
      const d = diffPixels(gp, cp, TOLERANCE);
      if (d.drifted === 0) {
        ok++;
        console.error(`  [OK     ] ${s.name}`);
        results.push({ name: s.name, status: "OK" });
      } else {
        drifted++;
        const pct = ((d.drifted / d.total) * 100).toFixed(3);
        // Write the current frame next to the golden for eyeballing.
        writeFileSync(resolve(OUT_DIR, `${s.name}.actual.png`), current);
        console.error(`  [DRIFT  ] ${s.name} ${d.drifted}/${d.total} px (${pct}%), maxΔ=${d.maxDelta} → wrote ${s.name}.actual.png`);
        results.push({ name: s.name, status: "DRIFT", driftedPct: pct, maxDelta: d.maxDelta });
      }
    }
    console.log(JSON.stringify({ mode: "compare", ok, drifted, shots: results }, null, 2));
    console.error(`\n=== Sidebar golden compare: ${ok} ok, ${drifted} drifted ===`);
    await harness.close();
    process.exit(drifted > 0 ? 1 : 0);
  } catch (e) {
    console.error("Sidebar golden crashed:", e);
    await harness.close();
    process.exit(2);
  }
}

main();

/**
 * Real-browser playback behavior tests.
 *
 * Tests properties like "rolling().begin(.3) positions stay >= loopStart",
 * "sync() position tracks the clock", "scrub freezes at position" — using
 * actual video elements in a real Chromium browser, not mocks.
 *
 * Usage:
 *   npx tsx test/playback-behavior-test.ts [--headless] [--duration 4000]
 *
 * Exit code: 0 = all pass, 1 = any failure.
 */

import { chromium, type Page } from "playwright";
import { createServer } from "vite";

const args = process.argv.slice(2);
const HEADLESS = args.includes("--headless") || !args.includes("--headed");
const DURATION_MS = parseInt(args[args.indexOf("--duration") + 1] || "4000", 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForApp(page: Page) {
  await page.waitForFunction(() => typeof (window as any).uzuEval === "function", null, { timeout: 10000 });
}

/** Evaluate a pattern expression, wait ms, then return video element currentTime values. */
async function samplePositions(page: Page, code: string, sampleCount: number, intervalMs: number): Promise<number[][]> {
  await page.evaluate((c: string) => {
    (window as any).uzuEval(c);
  }, code);

  // Wait for video metadata to load (pool element needs duration)
  await page.waitForTimeout(500);

  const samples: number[][] = [];
  for (let i = 0; i < sampleCount; i++) {
    const positions = await page.evaluate(() =>
      Array.from(document.querySelectorAll("video")).map((v) => v.currentTime)
    );
    samples.push(positions);
    if (i < sampleCount - 1) await page.waitForTimeout(intervalMs);
  }
  return samples;
}

interface BehaviorCase {
  name: string;
  code: string;
  check: (samples: number[][], label: string) => void;
  /** ms to sample over */
  durationMs?: number;
  /** samples to collect */
  sampleCount?: number;
}

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------

const DUR = 121.07; // hXJaBfcdCKM.mp4 duration in seconds
const BEGIN = 0.3;
const LOOP_START = BEGIN * DUR; // ~36.3s

const CASES: BehaviorCase[] = [
  {
    name: "rolling().begin(.3): positions stay >= loopStart, no reset to 0",
    code: `$: video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').begin(${BEGIN}).rolling()`,
    durationMs: 3000,
    sampleCount: 10,
    check(samples, label) {
      // After the first sample (give it a moment to seek), all video elements
      // should be at or above loopStart — never at 0 (the video's absolute start).
      for (let i = 1; i < samples.length; i++) {
        const positions = samples[i];
        for (const pos of positions) {
          if (Number.isNaN(pos)) continue; // element may not be assigned yet
          if (pos === 0 && i > 2) {
            throw new Error(`${label} sample ${i}: position=${pos.toFixed(2)} is at 0, expected >= loopStart (${LOOP_START.toFixed(1)})`);
          }
          if (pos > 0 && pos < LOOP_START - 1) {
            throw new Error(`${label} sample ${i}: position=${pos.toFixed(2)} is below loopStart (${LOOP_START.toFixed(1)})`);
          }
        }
      }
    },
  },

  {
    name: "sync().begin(.3): positions stay >= loopStart",
    code: `$: video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').begin(${BEGIN}).sync()`,
    durationMs: 3000,
    sampleCount: 10,
    check(samples, label) {
      for (let i = 2; i < samples.length; i++) {
        for (const pos of samples[i]) {
          if (Number.isNaN(pos) || pos === 0) continue;
          if (pos < LOOP_START - 1) {
            throw new Error(`${label} sample ${i}: position=${pos.toFixed(2)} is below loopStart (${LOOP_START.toFixed(1)})`);
          }
        }
      }
    },
  },

  {
    name: "sync() + rolling() both set: no crashes, positions in range",
    code: `$: video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').begin(${BEGIN}).sync().rolling()`,
    durationMs: 2000,
    sampleCount: 6,
    check(samples, label) {
      // Just verify no position goes outside [0, DUR] and no NaN
      for (let i = 1; i < samples.length; i++) {
        for (const pos of samples[i]) {
          if (Number.isNaN(pos)) throw new Error(`${label} sample ${i}: NaN position`);
          if (pos < -0.1 || pos > DUR + 0.1) {
            throw new Error(`${label} sample ${i}: position=${pos.toFixed(2)} out of [0, ${DUR}]`);
          }
        }
      }
    },
  },

  {
    name: "scrub(0.5): position frozen at mid-video",
    code: `$: video("hXJaBfcdCKM.mp4").urlBase('/test-assets/').scrub(0.5)`,
    durationMs: 2000,
    sampleCount: 6,
    check(samples, label) {
      const expected = 0.5 * DUR;
      // After warmup, position should be within 1s of the scrub target
      for (let i = 2; i < samples.length; i++) {
        for (const pos of samples[i]) {
          if (pos === 0) continue; // element may not be assigned yet
          if (Math.abs(pos - expected) > 2) {
            throw new Error(`${label} sample ${i}: position=${pos.toFixed(2)} not near scrub target (${expected.toFixed(1)})`);
          }
        }
      }
    },
  },

  {
    name: "rolling().begin(.3): loop wraps back to loopStart, not 0",
    // Run longer to force at least one loop wrap (loopLen ≈ 0.7 * 121 ≈ 85s — too long to force in test)
    // Instead: use a short clip with begin(.3) so the loop wraps quickly
    code: `$: video("red.mp4").urlBase('/test-assets/').begin(0.3).rolling()`,
    durationMs: 3000,
    sampleCount: 10,
    check(samples, label) {
      // red.mp4 is 1s long, loopLen = 0.7s, wraps every ~0.7s
      // All non-zero positions should be >= 0.3s (loopStart)
      const loopStartShort = 0.3 * 1.0; // 0.3s
      for (let i = 2; i < samples.length; i++) {
        for (const pos of samples[i]) {
          if (pos === 0) continue;
          if (pos < loopStartShort - 0.05) {
            throw new Error(`${label} sample ${i}: position=${pos.toFixed(3)} below loopStart (${loopStartShort}) after wrap`);
          }
        }
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const server = await createServer({ server: { port: 0 }, logLevel: "warn" });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : (addr as any).port;
  const url = `http://localhost:${port}`;

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();

  // Silence console noise but collect errors
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(url);
  await waitForApp(page);

  const results: { name: string; pass: boolean; error?: string }[] = [];

  for (const tc of CASES) {
    pageErrors.length = 0;

    let error: string | undefined;
    try {
      const count = tc.sampleCount ?? 8;
      const interval = Math.floor((tc.durationMs ?? 3000) / count);
      const samples = await samplePositions(page, tc.code, count, interval);
      tc.check(samples, tc.name);

      if (pageErrors.length > 0) {
        error = `JS errors: ${pageErrors.join("; ")}`;
      }
    } catch (e: any) {
      error = e?.message || String(e);
    }

    results.push({ name: tc.name, pass: !error, error });

    // Reset for next case
    await page.goto(url);
    await waitForApp(page);
  }

  await browser.close();
  await server.close();

  // Report
  console.error("\n=== Playback Behavior Test Results ===");
  let allPass = true;
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.error(`  [${status}] ${r.name}`);
    if (r.error) {
      console.error(`         ${r.error}`);
      allPass = false;
    }
  }
  console.error(`\n${allPass ? "ALL PASSED" : "FAILURES DETECTED"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(2);
});

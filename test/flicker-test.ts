/**
 * Browser-based flicker detection test.
 *
 * Runs patterns that are known to cause flicker, samples el.currentTime
 * each frame, and checks that it never hits the video end unexpectedly.
 *
 * Usage: npx tsx test/flicker-test.ts [--headless]
 */

import { chromium } from "playwright";
import { createServer } from "vite";

const HEADLESS = process.argv.includes("--headless");
const DURATION_MS = 5000;

interface FlickerCase {
  name: string;
  code: string;
}

const CASES: FlickerCase[] = [
  {
    name: "sync + begin(saw) + speed(1)",
    code: `$: video("HCP-4P0eoOo.mp4").urlBase('http://localhost:3456/videos/').sync().begin(saw).speed(1)`,
  },
  {
    name: "sync + begin(sine)",
    code: `$: video("HCP-4P0eoOo.mp4").urlBase('http://localhost:3456/videos/').sync().begin(sine)`,
  },
  {
    name: "sync + speed(2)",
    code: `$: video("HCP-4P0eoOo.mp4").urlBase('http://localhost:3456/videos/').sync().speed(2)`,
  },
  {
    name: "plain speed(1) (control)",
    code: `$: video("HCP-4P0eoOo.mp4").urlBase('http://localhost:3456/videos/')`,
  },
];

async function main() {
  const server = await createServer({
    server: { port: 0 },
    logLevel: "warn",
  });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : addr.port;
  const url = `http://localhost:${port}`;

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();

  let allPass = true;

  for (const tc of CASES) {
    await page.goto(url, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.uzuEval === "function", null, { timeout: 15000 });

    // Inject flicker detection: record el.currentTime each frame
    await page.evaluate(`window._flickerSamples = []`);

    // Eval the pattern
    await page.evaluate(`try { window.uzuEval(${JSON.stringify(tc.code)}); } catch(e) { console.error(e); }`);

    // Wait for video to load from server
    await page.waitForTimeout(2000);

    // Install post-render sampler: hook into the render loop's rAF to sample
    // AFTER updateVideoPlayback has set el.currentTime
    await page.evaluate(`
      (function() {
        var samples = window._flickerSamples;
        var startTime = Date.now();
        var durationMs = ${DURATION_MS};
        // Use setTimeout(0) inside rAF to run after all rAF callbacks (including render)
        function sample() {
          if (Date.now() - startTime > durationMs) return;
          setTimeout(function() {
            var fa = window._uzuFrameAssignments;
            if (fa) {
              fa.forEach(function(el) {
                if (el && el.duration > 0) {
                  var st = el._state;
                  samples.push({ ct: el.currentTime, dur: el.duration, paused: el.paused, rate: el.playbackRate, lastExp: st ? st.lastExpected : null, begin: st ? st.lastSyncBegin : null });
                }
              });
            }
          }, 0);
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      })()
    `);

    await page.waitForTimeout(DURATION_MS + 200);

    // Collect and analyze samples
    const samples: { ct: number; dur: number; paused: boolean; rate: number; lastExp?: number }[] =
      (await page.evaluate(`window._flickerSamples`) as any) ?? [];

    // Check for flicker: ct at video end when expected is far away
    let endFrames = 0;
    let totalFrames = samples.length;
    for (const s of samples) {
      // Check if browser is stuck at or very near the video end
      // AND the expected position is far from the end (indicating a bug)
      if (s.ct >= s.dur - 0.05 && (s as any).lastExp != null && (s as any).lastExp < s.dur - 1) {
        endFrames++;
      }
    }

    const endFraction = totalFrames > 0 ? endFrames / totalFrames : 0;
    // With a 10s video, hitting the end should be rare (< 1%)
    const pass = endFraction < 0.01;
    if (!pass) allPass = false;

    const pausedFrames = samples.filter(s => s.paused).length;
    const pausedFraction = totalFrames > 0 ? pausedFrames / totalFrames : 0;

    console.log(`${pass ? "PASS" : "FAIL"} ${tc.name}`);
    console.log(`  frames: ${totalFrames}, at-end: ${endFrames} (${(endFraction * 100).toFixed(1)}%), paused: ${pausedFrames} (${(pausedFraction * 100).toFixed(1)}%)`);
    if (!pass) {
      // Show some sample end-frames
      const endSamples = samples.filter(s => s.ct >= s.dur - 0.05).slice(0, 5);
      console.log(`  sample end-frames:`, endSamples);
    }
  }

  await browser.close();
  await server.close();

  console.log(`\n${allPass ? "ALL PASSED" : "SOME FAILED"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

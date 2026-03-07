/**
 * Monkey tester for uzuvid.
 *
 * Generates random valid patterns and evaluates them in the real browser app,
 * monitoring for errors and crashes.
 *
 * Usage:
 *   1. Start the video server:  cd server && npm start
 *   2. Run:  npx tsx monkey-test.ts [--rounds 50] [--delay 2000] [--headless]
 */

import { chromium } from "playwright";
import { createServer, build } from "vite";

const args = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const ROUNDS = parseInt(flag("rounds", "50"), 10);
const DELAY_MS = parseInt(flag("delay", "2000"), 10);
const HEADLESS = args.includes("--headless");

// --- available assets ---
const VIDEOS = [
  "6dca7430d24af6c8a0dc337bd09e333e.mp4",
  "BalgIMSzY3k.mp4",
  "HCP-4P0eoOo.mp4",
  "aGMOFLgB1CU.mp4",
  "hXJaBfcdCKM.mp4",
  "iDcekQeBGOY.mp4",
];

const COLORS = [
  "red", "green", "blue", "yellow", "cyan", "magenta",
  "purple", "orange", "white", "black", "pink",
];

// --- random helpers ---
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  return Array.from({ length: n }, () => pick(arr));
}

function randFloat(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function randInt(lo: number, hi: number): number {
  return Math.floor(randFloat(lo, hi + 1));
}

// --- mininotation generators ---
function miniGroup(items: string[]): string {
  if (items.length === 1) return items[0];
  // sometimes add subdivision brackets
  if (items.length >= 2 && Math.random() < 0.3) {
    const mid = Math.ceil(items.length / 2);
    return `[${items.slice(0, mid).join(" ")}] ${items.slice(mid).join(" ")}`;
  }
  return items.join(" ");
}

function generateColorPattern(): string {
  const items = pickN(COLORS, 1, 6);
  return miniGroup(items);
}

function generateVideoPattern(): string {
  const items = pickN(VIDEOS, 1, 4);
  return miniGroup(items);
}

function generateSpeedValue(): string {
  const speeds = ["-2", "-1", "-0.5", "0.1", "0.25", "0.5", "1", "2", "4", "8", "16"];
  return pick(speeds);
}

function generateSpeedPattern(): string {
  const items = pickN(
    ["-2", "-1", "-0.5", "0.1", "0.25", "0.5", "1", "2", "4"],
    1,
    4,
  );
  return miniGroup(items);
}

function generateTimeValue(): string {
  const strategies: (() => string)[] = [
    () => `${randFloat(0, 0.9).toFixed(2)}`,       // relative
    () => `${randFloat(0, 10).toFixed(1)}s`,        // seconds
    () => `${randInt(100, 5000)}ms`,                // milliseconds
  ];
  return pick(strategies)();
}

function generateTimePattern(): string {
  const n = randInt(1, 3);
  return Array.from({ length: n }, generateTimeValue).join(" ");
}

// --- code generators ---
type Generator = () => { code: string; description: string };

const generators: Generator[] = [
  // simple color
  () => {
    const pat = generateColorPattern();
    return { code: `color("${pat}").out()`, description: `color: ${pat}` };
  },

  // video with no extras
  () => {
    const pat = generateVideoPattern();
    return { code: `video("${pat}").out()`, description: `video: ${pat}` };
  },

  // video with speed
  () => {
    const pat = generateVideoPattern();
    const spd = generateSpeedPattern();
    return {
      code: `video("${pat}").speed("${spd}").out()`,
      description: `video+speed: ${pat} @ ${spd}`,
    };
  },

  // video with start/end
  () => {
    const pat = generateVideoPattern();
    const start = generateTimePattern();
    const end = generateTimePattern();
    return {
      code: `video("${pat}").start("${start}").end("${end}").out()`,
      description: `video+start/end: ${pat} [${start} -> ${end}]`,
    };
  },

  // video with start + duration
  () => {
    const pat = generateVideoPattern();
    const start = generateTimePattern();
    const dur = generateTimePattern();
    return {
      code: `video("${pat}").start("${start}").duration("${dur}").out()`,
      description: `video+start/dur: ${pat} [${start} +${dur}]`,
    };
  },

  // video with speed + start/end
  () => {
    const pat = generateVideoPattern();
    const spd = generateSpeedPattern();
    const start = generateTimePattern();
    const end = generateTimePattern();
    return {
      code: `video("${pat}").speed("${spd}").start("${start}").end("${end}").out()`,
      description: `video full: ${pat} @ ${spd} [${start} -> ${end}]`,
    };
  },

  // video with speed + start/duration
  () => {
    const pat = generateVideoPattern();
    const spd = generateSpeedPattern();
    const start = generateTimePattern();
    const dur = generateTimePattern();
    return {
      code: `video("${pat}").speed("${spd}").start("${start}").dur("${dur}").out()`,
      description: `video full+dur: ${pat} @ ${spd} [${start} +${dur}]`,
    };
  },

  // setCps then pattern
  () => {
    const cps = pick(["0.25", "0.5", "1", "2", "4"]);
    const inner = pick(generators.slice(0, 3))();
    return {
      code: `setCps(${cps}); ${inner.code}`,
      description: `cps=${cps}, ${inner.description}`,
    };
  },
];

// --- main ---
async function main() {
  // Start vite dev server
  console.log("Starting vite dev server...");
  const server = await createServer({
    server: { port: 0 },
    logLevel: "warn",
  });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : addr.port;
  const url = `http://localhost:${port}`;
  console.log(`Vite running at ${url}`);

  // Launch browser
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();

  const errors: { round: number; code: string; error: string }[] = [];
  const warnings: { round: number; code: string; message: string }[] = [];

  // Collect console errors
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // ignore video loading errors from missing server
      if (text.includes("net::ERR") || text.includes("Failed to load")) return;
      errors.push({ round: -1, code: "(console)", error: text });
    }
  });

  page.on("pageerror", (err) => {
    errors.push({ round: -1, code: "(pageerror)", error: err.message });
  });

  console.log(`Loading app...`);
  await page.goto(url);
  // Wait for the app to initialize
  await page.waitForFunction(() => typeof window.uzuEval === "function", null, { timeout: 10000 });
  console.log(`App loaded. Running ${ROUNDS} rounds with ${DELAY_MS}ms delay each.\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < ROUNDS; i++) {
    const gen = pick(generators);
    const { code, description } = gen();

    const errorsBefore = errors.length;

    // Evaluate the code
    const evalError = await page.evaluate((c: string) => {
      try {
        window.uzuEval(c);
        return null;
      } catch (e: any) {
        return e?.message || String(e);
      }
    }, code);

    if (evalError) {
      errors.push({ round: i, code, error: evalError });
    }

    // Let the render loop run for a bit
    await page.waitForTimeout(DELAY_MS);

    // Check if page is still alive
    const alive = await page.evaluate(() => {
      return document.getElementById("c") !== null;
    }).catch(() => false);

    if (!alive) {
      errors.push({ round: i, code, error: "Page crashed or became unresponsive" });
      // Try to recover
      await page.goto(url);
      await page.waitForFunction(() => typeof window.uzuEval === "function", null, { timeout: 10000 }).catch(() => {});
    }

    const newErrors = errors.length - errorsBefore;
    const status = newErrors === 0 ? "OK" : `FAIL (${newErrors} error(s))`;

    if (newErrors === 0) {
      passed++;
      console.log(`  [${i + 1}/${ROUNDS}] ${status} | ${description}`);
    } else {
      failed++;
      console.log(`  [${i + 1}/${ROUNDS}] ${status} | ${description}`);
      for (const err of errors.slice(errorsBefore)) {
        console.log(`           -> ${err.error}`);
      }
    }
  }

  // --- summary ---
  console.log("\n" + "=".repeat(60));
  console.log(`MONKEY TEST COMPLETE: ${passed} passed, ${failed} failed out of ${ROUNDS} rounds`);

  if (errors.length > 0) {
    console.log(`\nAll errors (${errors.length}):`);
    for (const err of errors) {
      console.log(`  Round ${err.round}: ${err.error}`);
      console.log(`    Code: ${err.code}`);
    }
  } else {
    console.log("\nNo errors detected!");
  }

  console.log("=".repeat(60));

  await browser.close();
  await server.close();

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Monkey test crashed:", e);
  process.exit(2);
});

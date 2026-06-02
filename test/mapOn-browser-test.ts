/**
 * Browser regression test for mapOn smooth interpolation.
 *
 * Reproduces the bug where `s("red").x(".1 -.1").mapOn("x", x=>x.spline())`
 * shows stepped values instead of smooth interpolation in the real browser.
 *
 * Usage:
 *   npx tsx test/mapOn-browser-test.ts
 *
 * Exit code: 0 if mapOn produces >2 distinct x values (smooth), 1 if stepped.
 */

import { chromium } from "playwright";
import { createServer } from "vite";

async function main() {
  const server = await createServer({
    server: { port: 0 },
    logLevel: "warn",
  });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : addr.port;
  const url = `http://localhost:${port}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();

  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("CONSOLE ERROR:", msg.text());
  });

  await page.goto(url);
  await page.waitForFunction(() => typeof (window as any).pdEval === "function", null, { timeout: 10000 });

  // Reset xLog
  await page.evaluate(() => (window as any).pdMetrics.reset());

  // Eval the mapOn pattern — this is the pattern reported to NOT produce smooth movement
  const evalError = await page.evaluate(() => {
    try {
      (window as any).pdEval(`$: s("red").x(".1 -.1").mapOn("x", x=>x.spline())`);
      return null;
    } catch (e: any) {
      return e?.message || String(e);
    }
  });

  if (evalError) {
    console.error("Eval error:", evalError);
    await browser.close();
    await server.close();
    process.exit(1);
  }

  // Wait 2 seconds to collect x values from multiple frames
  await page.waitForTimeout(2000);

  const xLog: number[] = await page.evaluate(() => (window as any).pdMetrics.xLog);

  const distinctValues = new Set(xLog.map((v) => Math.round(v * 1000) / 1000));

  console.log(`xLog length: ${xLog.length}`);
  console.log(`Distinct x values (rounded to 3dp): ${[...distinctValues].sort((a, b) => a - b).join(", ")}`);

  const pass = distinctValues.size > 2;
  if (pass) {
    console.log("PASS: mapOn produces smooth interpolation (>2 distinct x values)");
  } else {
    console.log(
      `FAIL: mapOn produces only ${distinctValues.size} distinct x value(s) — stepped, not smooth`,
    );
  }

  await browser.close();
  await server.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

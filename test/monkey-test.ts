/**
 * Property-based monkey tester for uzuvid.
 *
 * Uses fast-check for generation and automatic shrinking. When a test
 * fails, fast-check reduces the failing input to a minimal reproduction.
 *
 * Usage:
 *   1. Run:  npx tsx test/monkey-test.ts [--rounds 50] [--delay 2000] [--headless]
 *   2. Replay failures: npx tsx test/monkey-test.ts --replay [--delay 2000] [--headless]
 *
 * Failed tests (already shrunk) are saved to regression-cases.json and
 * can be replayed as a conformance suite.
 */

import { chromium } from "playwright";
import { createServer } from "vite";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import fc from "fast-check";
import { topExpr, type GeneratedExpr } from "./arbitraries";

const args = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const ROUNDS = parseInt(flag("rounds", "50"), 10);
const DELAY_MS = parseInt(flag("delay", "2000"), 10);
const SHRINK_DELAY_MS = parseInt(flag("shrink-delay", "500"), 10);
const HEADLESS = args.includes("--headless");
const REPLAY = args.includes("--replay");
const FAILURES_FILE = resolve(import.meta.dirname ?? ".", "regression-cases.json");

// ============================================================
// Failure store
// ============================================================

interface FailureCase {
  code: string;
  description: string;
  errors: string[];
  timestamp: string;
}

function loadFailures(): FailureCase[] {
  if (!existsSync(FAILURES_FILE)) return [];
  try { return JSON.parse(readFileSync(FAILURES_FILE, "utf-8")); }
  catch { return []; }
}

function saveFailures(failures: FailureCase[]) {
  const seen = new Set<string>();
  const deduped = failures.filter(f => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
  writeFileSync(FAILURES_FILE, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`\nSaved ${deduped.length} failure(s) to regression-cases.json`);
}

// ============================================================
// Test runner
// ============================================================

async function runCase(
  page: any,
  code: string,
  delayMs: number,
  url: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const caseErrors: string[] = [];

  const onConsole = (msg: any) => {
    if (msg.type() === "error") {
      const text = msg.text();
      caseErrors.push(text);
    }
  };
  const onPageError = (err: any) => {
    const text = err.message || String(err);
    caseErrors.push(text);
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const evalError = await page.evaluate((c: string) => {
      try {
        if (typeof window.uzuSetCode === "function") window.uzuSetCode(c);
        window.uzuEval(c);
        return null;
      } catch (e: any) {
        return e?.message || String(e);
      }
    }, code);

    if (evalError) {
      caseErrors.push(evalError);
    }

    await page.waitForTimeout(delayMs);

    // Collect runtime warnings
    const runtimeWarnings: string[] = await page.evaluate(() => {
      const w = (window as any).uzuWarnings ?? [];
      return [...w];
    }).catch(() => []);
    for (const w of runtimeWarnings) {
      caseErrors.push(`[runtime warning] ${w}`);
    }

    const alive = await page.evaluate(() => {
      return document.getElementById("c") !== null;
    }).catch(() => false);

    if (!alive) {
      caseErrors.push("Page crashed or became unresponsive");
      await page.goto(url);
      await page.waitForFunction(
        () => typeof window.uzuEval === "function", null, { timeout: 10000 },
      ).catch(() => {});
    }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }

  return { ok: caseErrors.length === 0, errors: caseErrors };
}

// ============================================================
// Main
// ============================================================

async function main() {
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

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();

  console.log(`Loading app...`);
  await page.goto(url);
  await page.waitForFunction(() => typeof window.uzuEval === "function", null, { timeout: 10000 });

  const existingFailures = loadFailures();

  if (REPLAY) {
    // Replay mode: run saved failures as conformance suite
    if (existingFailures.length === 0) {
      console.log("No failures to replay. Run without --replay first.");
      await browser.close();
      await server.close();
      process.exit(0);
    }

    console.log(`Replaying ${existingFailures.length} saved failure(s) with ${DELAY_MS}ms delay each.\n`);
    let passed = 0;
    let failed = 0;
    const stillFailing: FailureCase[] = [];

    for (let i = 0; i < existingFailures.length; i++) {
      const f = existingFailures[i];
      const result = await runCase(page, f.code, DELAY_MS, url);

      if (result.ok) {
        passed++;
        console.log(`  [${i + 1}/${existingFailures.length}] FIXED | ${f.code}`);
      } else {
        failed++;
        console.log(`  [${i + 1}/${existingFailures.length}] STILL FAILING | ${f.code}`);
        for (const err of result.errors) {
          console.log(`    -> ${err}`);
        }
        stillFailing.push({ ...f, errors: result.errors });
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log(`CONFORMANCE REPLAY: ${passed} fixed, ${failed} still failing out of ${existingFailures.length}`);
    if (passed > 0) {
      saveFailures(stillFailing);
    }
    console.log("=".repeat(60));

    await browser.close();
    await server.close();
    process.exit(failed > 0 ? 1 : 0);

  } else {
    // Property-based testing with fast-check
    console.log(`Running ${ROUNDS} rounds with fast-check (delay=${DELAY_MS}ms, shrink-delay=${SHRINK_DELAY_MS}ms).\n`);

    let caseNum = 0;
    let firstFailureSeen = false;
    const newFailures: FailureCase[] = [];

    const result = await fc.check(
      fc.asyncProperty(topExpr, async (expr: GeneratedExpr) => {
        caseNum++;
        const isShrinking = firstFailureSeen;
        const delay = isShrinking ? SHRINK_DELAY_MS : DELAY_MS;

        const testResult = await runCase(page, expr.code, delay, url);

        if (!isShrinking) {
          const truncated = expr.code.length > 100 ? expr.code.slice(0, 100) + "..." : expr.code;
          if (testResult.ok) {
            console.log(`  [${caseNum}/${ROUNDS}] OK | ${truncated}`);
          } else {
            console.log(`  [${caseNum}/${ROUNDS}] FAIL | ${expr.code}`);
            for (const err of testResult.errors) {
              console.log(`    -> ${err}`);
            }
            console.log(`  Shrinking...`);
            firstFailureSeen = true;
          }
        } else if (!testResult.ok) {
          console.log(`  [shrink] still fails (${expr.code.length} chars)`);
        }

        return testResult.ok;
      }),
      {
        numRuns: ROUNDS,
      },
    );

    // Summary
    console.log("\n" + "=".repeat(60));

    if (result.failed) {
      console.log(`PROPERTY-BASED TEST: FAILED after ${result.numRuns} runs, ${result.numShrinks} shrinks`);

      // Extract the shrunk counterexample
      if (result.counterexample) {
        const shrunkExpr = result.counterexample[0] as GeneratedExpr;
        console.log(`\nMinimal failing case (after ${result.numShrinks} shrinks):`);
        console.log(`  ${shrunkExpr.code}`);

        // Run the shrunk case one more time to get the actual errors
        const finalResult = await runCase(page, shrunkExpr.code, DELAY_MS, url);
        if (!finalResult.ok) {
          for (const err of finalResult.errors) {
            console.log(`  -> ${err}`);
          }
          newFailures.push({
            code: shrunkExpr.code,
            description: `shrunk from ${result.numShrinks} shrinks`,
            errors: finalResult.errors,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if ("error" in result && result.error) {
        console.log(`\nError: ${result.error}`);
      }
    } else {
      console.log(`PROPERTY-BASED TEST: ${result.numRuns} runs passed`);
    }

    if (newFailures.length > 0) {
      saveFailures([...existingFailures, ...newFailures]);
    } else {
      console.log("\nNo errors detected!");
    }
    console.log("=".repeat(60));

    await browser.close();
    await server.close();
    process.exit(result.failed ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("Monkey test crashed:", e);
  process.exit(2);
});

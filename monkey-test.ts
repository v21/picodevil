/**
 * Monkey tester for uzuvid.
 *
 * Generates random valid patterns from a grammar and evaluates them in the
 * real browser app, monitoring for errors and crashes.
 *
 * Usage:
 *   1. Start the video server:  cd server && npm start
 *   2. Run:  npx tsx monkey-test.ts [--rounds 50] [--delay 2000] [--headless]
 *   3. Replay failures: npx tsx monkey-test.ts --replay [--delay 2000] [--headless]
 *
 * Failed tests are saved to monkey-failures.json and can be replayed as a
 * conformance suite after fixing bugs.
 */

import { chromium } from "playwright";
import { createServer } from "vite";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const ROUNDS = parseInt(flag("rounds", "50"), 10);
const DELAY_MS = parseInt(flag("delay", "2000"), 10);
const HEADLESS = args.includes("--headless");
const REPLAY = args.includes("--replay");
const FAILURES_FILE = resolve(import.meta.dirname ?? ".", "monkey-failures.json");

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
  // deduplicate by code
  const seen = new Set<string>();
  const deduped = failures.filter(f => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
  writeFileSync(FAILURES_FILE, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`\nSaved ${deduped.length} failure(s) to monkey-failures.json`);
}

// ============================================================
// Terminals
// ============================================================

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

// Continuous signals: support .lerp(), .spline(), .sec(), .ms()
const CONTINUOUS_SIGNALS = [
  "sine", "sine2", "cosine", "cosine2",
  "saw", "saw2", "isaw", "isaw2",
  "tri", "tri2", "itri", "itri2",
  "square", "square2",
  "rand", "rand2", "perlin",
];

// Discrete pattern signals: no .lerp()/.spline() but are pattern objects
const DISCRETE_SIGNALS = ["brand", "time"];

// Functions that return patterns (need args) — used separately
const SIGNAL_FUNCTIONS = [
  { name: "irand", arg: () => String(randInt(2, 10)) },
  { name: "brandBy", arg: () => randFloat(0.1, 0.9).toFixed(2) },
  { name: "choose", arg: () => pickN(SPEED_LITERALS.filter(s => s !== "0"), 2, 5).join(", ") },
  { name: "chooseCycles", arg: () => pickN(SPEED_LITERALS.filter(s => s !== "0"), 2, 5).join(", ") },
];

const EASING_CURVES = [
  "linear", "sine", "quad", "cubic", "quart", "quint",
  "expo", "circ", "elastic", "bounce", "back",
];

const EASING_DIRS = ["in", "out", "inout"];

const SPEED_LITERALS = ["-2", "-1", "-0.5", "0", "0.1", "0.25", "0.5", "1", "2", "4", "8", "16"];

const CPS_VALUES = ["0.25", "0.5", "1", "2", "4"];

// ============================================================
// Random helpers
// ============================================================

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

function maybe(p: number): boolean {
  return Math.random() < p;
}

// ============================================================
// Grammar: mininotation (mirrors krill.pegjs)
//
//   statement       → stack_or_choose
//   stack_or_choose → sequence ("," sequence)* — stack
//                   | sequence ("|" sequence)* — choose
//                   | sequence ("." sequence)* — feet
//                   | sequence
//   sequence        → slice_with_ops+
//   slice_with_ops  → slice op*
//   slice           → step | sub_cycle | polymeter | slow_sequence
//   sub_cycle       → "[" stack_or_choose "]"
//   polymeter       → "{" sequence ("," sequence)* "}" ("%"step)?
//   slow_sequence   → "<" sequence ("," sequence)* ">"
//   op              → @N | !N | *N | /N | ?N? | (p,s,r?)
//   step            → atom chars (letters, digits, -, #, ., ^, _, ~)
// ============================================================

// Generate a mininotation string from a pool of atom values.
// depth controls recursion to avoid runaway nesting.
function miniSlice(pool: string[], depth: number): string {
  // at max depth or most of the time, just pick an atom
  if (depth <= 0 || maybe(0.6)) {
    return pick(pool);
  }
  const r = Math.random();
  if (r < 0.4) {
    // sub_cycle: [sequence]
    return `[${miniSequence(pool, depth - 1)}]`;
  }
  if (r < 0.55) {
    // slow_sequence: <sequence>
    return `<${miniSequence(pool, depth - 1)}>`;
  }
  if (r < 0.7) {
    // polymeter: {sequence} or {sequence}%N
    const inner = miniSequence(pool, depth - 1);
    return maybe(0.4) ? `{${inner}}%${randInt(2, 5)}` : `{${inner}}`;
  }
  // rest ~
  return "~";
}

function miniSliceWithOps(pool: string[], depth: number): string {
  let s = miniSlice(pool, depth);
  // optionally apply 0-2 operators
  const nOps = maybe(0.3) ? randInt(1, 2) : 0;
  for (let i = 0; i < nOps; i++) {
    s += miniOp(pool, depth);
  }
  return s;
}

function miniOp(pool: string[], depth: number): string {
  return pick([
    // weight @N
    () => `@${randInt(1, 4)}`,
    // replicate !N
    () => `!${randInt(2, 4)}`,
    // fast *N
    () => `*${randInt(2, 4)}`,
    // slow /N
    () => `/${randInt(2, 4)}`,
    // degrade ?  or ?0.N
    () => maybe(0.5) ? "?" : `?${randFloat(0.1, 0.9).toFixed(1)}`,
    // euclidean (p,s) or (p,s,r)
    () => {
      const p = randInt(2, 5);
      const s = randInt(p, 8);
      return maybe(0.3) ? `(${p},${s},${randInt(0, s - 1)})` : `(${p},${s})`;
    },
  ])();
}

function miniSequence(pool: string[], depth: number): string {
  const n = randInt(1, 4);
  return Array.from({ length: n }, () => miniSliceWithOps(pool, depth)).join(" ");
}

function miniStackOrChoose(pool: string[], depth: number): string {
  const head = miniSequence(pool, depth);
  if (maybe(0.2) && depth > 0) {
    // stack (comma-separated)
    const nTails = randInt(1, 2);
    const tails = Array.from({ length: nTails }, () => miniSequence(pool, depth - 1));
    return [head, ...tails].join(", ");
  }
  if (maybe(0.15) && depth > 0) {
    // choose (pipe-separated)
    const nTails = randInt(1, 3);
    const tails = Array.from({ length: nTails }, () => miniSequence(pool, depth - 1));
    return [head, ...tails].join(" | ");
  }
  return head;
}

function miniOf(pool: string[], _min = 1, _max = 4): string {
  return miniStackOrChoose(pool, 2);
}

// ============================================================
// Grammar: signal expressions
// ============================================================

function signalExpr(): string {
  const r = Math.random();
  if (r < 0.6) {
    // continuous signal — may chain .lerp/.spline/.sec/.ms
    const sig = pick(CONTINUOUS_SIGNALS);
    const parts: string[] = [sig];
    if (maybe(0.3)) {
      parts.push(`.lerp("${pick(EASING_CURVES)}", "${pick(EASING_DIRS)}")`);
    } else if (maybe(0.2)) {
      parts.push(`.spline(${randFloat(0.1, 1.0).toFixed(2)})`);
    }
    if (maybe(0.3)) {
      parts.push(pick([".sec()", ".ms()"]));
    }
    return parts.join("");
  }
  if (r < 0.8) {
    // discrete pattern signal — no chaining
    return pick(DISCRETE_SIGNALS);
  }
  // signal function — needs args
  const fn = pick(SIGNAL_FUNCTIONS);
  return `${fn.name}(${fn.arg()})`;
}

// ============================================================
// Grammar: argument expressions (what goes inside .speed(), .start(), etc.)
//
//   arg → quoted_mini | signal_expr | number
// ============================================================

function timeValue(): string {
  return pick([
    () => `${randFloat(0, 0.9).toFixed(2)}`,        // relative
    () => `${randFloat(0, 10).toFixed(1)}s`,         // seconds (s)
    () => `${randFloat(0, 10).toFixed(1)}sec`,       // seconds (sec)
    () => `${randInt(100, 5000)}ms`,                 // milliseconds (ms)
    () => `${randInt(100, 5000)}millis`,             // milliseconds (millis)
  ])();
}

function timeMini(): string {
  // generate a pool of time values, then use mininotation structure around them
  const pool = Array.from({ length: randInt(3, 6) }, timeValue);
  return miniStackOrChoose(pool, 1);
}

function timeArg(): string {
  if (maybe(0.35)) return signalExpr();
  return `"${timeMini()}"`;
}

function speedArg(): string {
  if (maybe(0.4)) return signalExpr();
  return `"${miniOf(SPEED_LITERALS, 1, 4)}"`;
}

// ============================================================
// Grammar: video method chains
//
//   video_chain → method*
//   method      → .speed(arg) | .start(arg) | .end(arg) | .duration(arg)
//               | .dur(arg) | .scrub(arg)
//
// Each method can appear 0+ times. The grammar is permissive:
// you can chain .end() then .duration() — last one wins.
// ============================================================

interface MethodCall { code: string; desc: string }

const VIDEO_METHODS: (() => MethodCall)[] = [
  () => { const a = speedArg(); return { code: `.speed(${a})`, desc: `speed(${a})` }; },
  () => { const a = timeArg(); return { code: `.start(${a})`, desc: `start(${a})` }; },
  () => { const a = timeArg(); return { code: `.end(${a})`, desc: `end(${a})` }; },
  () => { const a = timeArg(); return { code: `.duration(${a})`, desc: `dur(${a})` }; },
  () => { const a = timeArg(); return { code: `.dur(${a})`, desc: `dur(${a})` }; },
  () => { const a = timeArg(); return { code: `.scrub(${a})`, desc: `scrub(${a})` }; },
  // speed(0) — explicit scrub
  () => ({ code: `.speed(0)`, desc: `speed(0)` }),
  // speed with a bare number
  () => { const n = pick(SPEED_LITERALS); return { code: `.speed(${n})`, desc: `speed(${n})` }; },
];

function videoChain(): { code: string; desc: string } {
  // geometric distribution: ~60% chance to add each next method, so
  // 0 methods: 40%, 1: 24%, 2: 14%, 3: 9%, 4: 5%, 5+: 8%
  const methods: MethodCall[] = [];
  while (maybe(0.6)) {
    methods.push(pick(VIDEO_METHODS)());
  }
  return {
    code: methods.map(m => m.code).join(""),
    desc: methods.map(m => m.desc).join(" "),
  };
}

// ============================================================
// Grammar: top-level expressions
//
//   expr       → color_expr | video_expr | cps_prefix expr
//   color_expr → color(mini(COLORS)).out()
//   video_expr → video(mini(VIDEOS)) video_chain .out()
// ============================================================

function generate(): { code: string; description: string } {
  // optionally prefix with setCps
  const cpsPrefix = maybe(0.15)
    ? { code: `setCps(${pick(CPS_VALUES)}); `, desc: `cps=${pick(CPS_VALUES)} ` }
    : { code: "", desc: "" };

  if (maybe(0.2)) {
    // color expression
    const pat = miniOf(COLORS, 1, 6);
    return {
      code: `${cpsPrefix.code}color("${pat}").out()`,
      description: `${cpsPrefix.desc}color: ${pat}`,
    };
  }

  // video expression
  const pat = miniOf(VIDEOS, 1, 4);
  const chain = videoChain();
  return {
    code: `${cpsPrefix.code}video("${pat}")${chain.code}.out()`,
    description: `${cpsPrefix.desc}video: ${pat} ${chain.desc}`.trim(),
  };
}

// ============================================================
// Test runner
// ============================================================

async function runCase(
  page: any,
  code: string,
  description: string,
  delayMs: number,
  url: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const caseErrors: string[] = [];

  // Collect errors that happen during this case
  const onConsole = (msg: any) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (text.includes("net::ERR") || text.includes("Failed to load")) return;
      caseErrors.push(text);
    }
  };
  const onPageError = (err: any) => {
    caseErrors.push(err.message);
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const evalError = await page.evaluate((c: string) => {
      try {
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

  // Build test cases: either replay saved failures or generate new ones
  let cases: { code: string; description: string }[];
  const existingFailures = loadFailures();

  if (REPLAY) {
    if (existingFailures.length === 0) {
      console.log("No failures to replay. Run without --replay first.");
      await browser.close();
      await server.close();
      process.exit(0);
    }
    cases = existingFailures.map(f => ({ code: f.code, description: f.description }));
    console.log(`Replaying ${cases.length} saved failure(s) with ${DELAY_MS}ms delay each.\n`);
  } else {
    cases = Array.from({ length: ROUNDS }, () => generate());
    console.log(`Running ${ROUNDS} rounds with ${DELAY_MS}ms delay each.\n`);
  }

  let passed = 0;
  let failed = 0;
  const newFailures: FailureCase[] = [];

  for (let i = 0; i < cases.length; i++) {
    const { code, description } = cases[i];
    const result = await runCase(page, code, description, DELAY_MS, url);

    if (result.ok) {
      passed++;
      console.log(`  [${i + 1}/${cases.length}] OK | ${description}`);
      console.log(`     ${code}`);
    } else {
      failed++;
      console.log(`  [${i + 1}/${cases.length}] FAIL (${result.errors.length} error(s)) | ${description}`);
      console.log(`     ${code}`);
      for (const err of result.errors) {
        console.log(`           -> ${err}`);
      }
      newFailures.push({
        code,
        description,
        errors: result.errors,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // --- summary ---
  console.log("\n" + "=".repeat(60));
  if (REPLAY) {
    console.log(`CONFORMANCE REPLAY: ${passed} passed, ${failed} still failing out of ${cases.length}`);
    if (passed > 0 && failed < existingFailures.length) {
      // Some old failures now pass — update the file to only keep still-failing ones
      saveFailures(newFailures);
    }
  } else {
    console.log(`MONKEY TEST: ${passed} passed, ${failed} failed out of ${ROUNDS} rounds`);
    if (newFailures.length > 0) {
      // Merge new failures with existing ones
      saveFailures([...existingFailures, ...newFailures]);
    }
  }

  if (newFailures.length > 0) {
    console.log(`\nFailed cases (${newFailures.length}):`);
    for (const f of newFailures) {
      console.log(`  ${f.description}`);
      console.log(`    ${f.code}`);
      for (const e of f.errors) {
        console.log(`    -> ${e}`);
      }
    }
  } else {
    console.log("\nNo errors detected!");
  }

  console.log("=".repeat(60));

  await browser.close();
  await server.close();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Monkey test crashed:", e);
  process.exit(2);
});

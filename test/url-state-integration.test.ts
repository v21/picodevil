/**
 * End-to-end URL state integration tests.
 *
 * Verifies that:
 * 1. Typing in the editor updates the URL hash within the debounce window.
 * 2. Loading the app with a pre-set hash restores code and media correctly.
 * 3. Blob URL entries survive the URL round-trip (present but broken on restore).
 * 4. Wiping the hash and reloading gives default code + empty media.
 * 5. A URL that is too large triggers a visible warning.
 *
 * Usage:
 *   npx tsx test/url-state-integration.test.ts [--headless] [--timeout 30000]
 *
 * Exit code: 0 = all pass, 1 = any failure.
 */

import { chromium, type Browser, type Page } from "playwright";
import { createServer } from "vite";

const args = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HEADLESS = args.includes("--headless") || !args.includes("--headed");
const TIMEOUT_MS = parseInt(flag("timeout", "30000"), 10);
/** Slightly longer than the 500ms debounce in saveToUrl */
const DEBOUNCE_WAIT_MS = 800;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TestPage = { page: Page; errors: string[] };

function isRelevantError(msg: string): boolean {
  // Filter noise from unrelated browser internals
  return !msg.includes("favicon") && !msg.includes("net::ERR_FILE_NOT_FOUND");
}

async function openFreshPage(browser: Browser, appUrl: string, hash = ""): Promise<TestPage> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
  });
  const url = hash ? `${appUrl}#${hash}` : appUrl;
  await page.goto(url);
  await page.waitForFunction(() => typeof (window as any).pdEval === "function", { timeout: 10000 });
  return { page, errors };
}

/** Build a valid URL hash by encoding state in-browser using the app's own encoder. */
async function buildHash(page: Page, code: string, media: { id: string; name: string; url: string; type: string }[]): Promise<string> {
  return page.evaluate(async ({ code, media }) => {
    const mod = await import("/src/url-state.ts");
    return mod.encodeUrlState(code, media as any);
  }, { code, media });
}

/** Get the current URL hash from the page (strips leading #). */
async function getHash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash.replace(/^#/, ""));
}

/** Decode the current hash using the app's own decoder. */
async function decodeCurrentHash(page: Page): Promise<{ code: string; media: any[] } | null> {
  return page.evaluate(async () => {
    const mod = await import("/src/url-state.ts");
    return mod.loadFromUrl();
  });
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

async function testHashUpdatesOnTyping(tp: TestPage, errors: string[]) {
  const { page } = tp;
  const testCode = `$: color("cyan")`;

  // Set code via the exposed setter and wait for debounce
  await page.evaluate((code) => {
    (window as any).pdSetCode(code);
  }, testCode);

  await page.waitForTimeout(DEBOUNCE_WAIT_MS);

  const decoded = await decodeCurrentHash(page);
  if (!decoded) {
    errors.push("Hash was not set after typing — loadFromUrl() returned null");
    return;
  }
  if (decoded.code !== testCode) {
    errors.push(`Hash code mismatch: expected "${testCode}", got "${decoded.code}"`);
  }
}

async function testRestoreFromHash(browser: Browser, appUrl: string, errors: string[]) {
  // Build a hash on a temporary page, then load it on a fresh page.
  const { page: buildPage } = await openFreshPage(browser, appUrl);
  const hash = await buildHash(buildPage, `$: color("magenta")`, [
    { id: "abc-1", name: "myclip", url: "http://localhost:3456/videos/myclip.mp4", type: "video" },
  ]);
  await buildPage.context().close();

  const { page, errors: pageErrors } = await openFreshPage(browser, appUrl, hash);
  errors.push(...pageErrors.filter(isRelevantError));

  const decoded = await decodeCurrentHash(page);
  if (!decoded) {
    errors.push("restoreFromHash: page hash was lost after load");
    await page.context().close();
    return;
  }
  if (decoded.code !== `$: color("magenta")`) {
    errors.push(`restoreFromHash: code mismatch — got "${decoded.code}"`);
  }

  // Check media registry restored
  const mediaNames: string[] = await page.evaluate(async () => {
    const mod = await import("/src/media-registry.ts");
    return mod.getAllEntries().map((e: any) => e.name);
  });
  if (!mediaNames.includes("myclip")) {
    errors.push(`restoreFromHash: "myclip" not found in media registry after restore (got: ${mediaNames.join(", ")})`);
  }

  await page.context().close();
}

async function testBlobEntryPreservedInHash(tp: TestPage, errors: string[]) {
  const { page } = tp;

  // Add a blob entry via the registry
  await page.evaluate(async () => {
    const blobUrl = URL.createObjectURL(new Blob(["fake"], { type: "video/mp4" }));
    (window as any).pdAddMedia(blobUrl, "blobclip");
  });

  await page.waitForTimeout(DEBOUNCE_WAIT_MS);

  const decoded = await decodeCurrentHash(page);
  if (!decoded) {
    errors.push("blobEntry: hash not set after adding blob entry");
    return;
  }
  const blobEntry = decoded.media.find((e: any) => e.name === "blobclip");
  if (!blobEntry) {
    errors.push("blobEntry: blob entry not found in encoded URL state");
  } else if (!blobEntry.url.startsWith("blob:")) {
    errors.push(`blobEntry: expected blob URL, got "${blobEntry.url}"`);
  }
}

async function testWipeHashGivesDefault(browser: Browser, appUrl: string, errors: string[]) {
  // Load with a hash, then navigate to the same URL without the hash.
  const { page: buildPage } = await openFreshPage(browser, appUrl);
  const hash = await buildHash(buildPage, `$: color("red")`, [
    { id: "x1", name: "somevid", url: "http://localhost:3456/videos/x.mp4", type: "video" },
  ]);
  await buildPage.context().close();

  // Load with hash, verify state
  const { page, errors: loadErrors } = await openFreshPage(browser, appUrl, hash);
  errors.push(...loadErrors.filter(isRelevantError));

  const decoded = await decodeCurrentHash(page);
  if (!decoded || decoded.code !== `$: color("red")`) {
    errors.push(`wipeHash: initial state not correctly loaded — got "${decoded?.code}"`);
  }

  // Now navigate to the app without a hash (simulates wiping the hash)
  await page.goto(appUrl);
  await page.waitForFunction(() => typeof (window as any).pdEval === "function", { timeout: 10000 });

  // Media registry should be empty (no stale localStorage bleed)
  const mediaNames: string[] = await page.evaluate(async () => {
    const mod = await import("/src/media-registry.ts");
    return mod.getAllEntries().map((e: any) => e.name);
  });
  if (mediaNames.includes("somevid")) {
    errors.push(`wipeHash: "somevid" found in registry after hash wipe — stale state leaked`);
  }

  // Editor code should be the default
  const editorCode: string = await page.evaluate(() => {
    const editor = document.querySelector(".cm-content");
    return editor?.textContent ?? "";
  });
  if (!editorCode.includes("video(") && !editorCode.includes("color(")) {
    errors.push(`wipeHash: editor code after hash wipe looks unexpected: "${editorCode.slice(0, 80)}"`);
  }
  // Default code should NOT contain our test code
  if (editorCode.includes(`color("red")`)) {
    errors.push(`wipeHash: stale code "${`$: color("red")`}" still present after hash wipe`);
  }

  await page.context().close();
}

async function testLargeStateWarning(tp: TestPage, errors: string[]) {
  const { page } = tp;

  // Add many large entries to exceed the URL_WARN_BYTES limit (8000)
  await page.evaluate(async () => {
    const mod = await import("/src/url-state.ts");
    const { getAllEntries } = await import("/src/media-registry.ts");
    const entries = getAllEntries();
    // Generate a code string large enough to trigger the warning
    const bigCode = "// " + "x".repeat(10000);
    mod.saveToUrl(bigCode, entries);
  });

  await page.waitForTimeout(DEBOUNCE_WAIT_MS);

  // Check for warning element visible in the DOM
  const warningText: string = await page.evaluate(() => {
    const warn = document.querySelector(".pd-warning");
    return (warn as HTMLElement)?.textContent ?? "";
  });

  if (!warningText.match(/large|long/i)) {
    errors.push(`largeState: expected warning about large URL, got: "${warningText.slice(0, 100)}"`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const vite = await createServer({ server: { port: 0 }, logLevel: "warn" });
  await vite.listen();
  const viteAddr = vite.httpServer!.address()!;
  const vitePort = typeof viteAddr === "string" ? 5173 : (viteAddr as any).port;
  const appUrl = `http://localhost:${vitePort}`;

  const browser = await chromium.launch({ headless: HEADLESS });
  const results: { name: string; errors: string[] }[] = [];

  try {
    // Test 1: Hash updates on typing/code change
    {
      const { page, errors: pageErrors } = await openFreshPage(browser, appUrl);
      const errors = [...pageErrors.filter(isRelevantError)];
      await testHashUpdatesOnTyping({ page, errors }, errors);
      await page.context().close();
      results.push({ name: "Hash updates when code changes (debounced)", errors });
    }

    // Test 2: Restore from hash
    {
      const errors: string[] = [];
      await testRestoreFromHash(browser, appUrl, errors);
      results.push({ name: "Code and media restored from URL hash on load", errors });
    }

    // Test 3: Blob entries encoded in hash
    {
      const { page, errors: pageErrors } = await openFreshPage(browser, appUrl);
      const errors = [...pageErrors.filter(isRelevantError)];
      await testBlobEntryPreservedInHash({ page, errors }, errors);
      await page.context().close();
      results.push({ name: "Blob URL entries are preserved in URL hash", errors });
    }

    // Test 4: Wipe hash → default state (no stale localStorage bleed)
    {
      const errors: string[] = [];
      await testWipeHashGivesDefault(browser, appUrl, errors);
      results.push({ name: "Wipe hash → default code, empty registry (no stale state)", errors });
    }

    // Test 5: Large state triggers warning
    {
      const { page, errors: pageErrors } = await openFreshPage(browser, appUrl);
      const errors = [...pageErrors.filter(isRelevantError)];
      await testLargeStateWarning({ page, errors }, errors);
      await page.context().close();
      results.push({ name: "Large URL state shows warning", errors });
    }
  } finally {
    await browser.close();
    await vite.close();
  }

  let anyFailed = false;
  for (const r of results) {
    if (r.errors.length === 0) {
      console.log(`✅ ${r.name}`);
    } else {
      console.error(`❌ ${r.name}`);
      r.errors.forEach((e) => console.error("   •", e));
      anyFailed = true;
    }
  }

  process.exit(anyFailed ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

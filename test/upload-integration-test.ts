/**
 * End-to-end upload integration test.
 *
 * Whether the drag-and-drop upload flow runs is no longer a build-time flag —
 * it's derived at runtime from the server config: an upload is attempted iff
 * `getServerUrl()` is non-null AND the last health probe wasn't `"error"`
 * (see src/media-loader.ts). These two scenarios cover both sides of that gate
 * in a real Chromium browser:
 *
 * 1. Server reachable — point the config at a live (inline) server, drop a
 *    file, expect the entry URL to flip from blob: to a server URL after
 *    upload. Catches CORS bugs and XHR/URL-swap regressions.
 *
 * 2. Server unreachable — point the config at a dead port (probe → "error"),
 *    drop a file, expect the entry URL to stay a blob: URL and NO /upload XHR
 *    to fire. Verifies the no-server fallback path.
 *
 * Usage:
 *   npx tsx test/upload-integration-test.ts [--headless] [--timeout 60000]
 *
 * Exit code: 0 = all pass, 1 = any failure.
 * Requires port 3456 to be free (used by the inline media server).
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as http from "http";
import { chromium, type Browser, type Page } from "playwright";
import { createServer as createViteServer, type ViteDevServer } from "vite";

const args = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HEADLESS = args.includes("--headless") || !args.includes("--headed");
const TIMEOUT_MS = parseInt(flag("timeout", "30000"), 10);

// GL flags that make WebGL2 work in headless Chromium (the app's renderer is
// WebGL2-only and throws on construction without them). Same set as test/harness.ts.
const GL_ARGS = ["--use-gl=angle", "--use-angle=metal", "--enable-unsafe-swiftshader"];

const MEDIA_PORT = 3456;
const MEDIA_URL = `http://localhost:${MEDIA_PORT}`;
/** A closed port — config pointed here probes to "error" (connection refused). */
const DEAD_URL = "http://127.0.0.1:59999";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startMediaServer(port: number): Promise<{ server: http.Server; downloadDir: string }> {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "picodevil-upload-test-"));

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }

      // Health endpoint so the frontend's probeHealth() recognises us as a
      // real picodevil-server and flips the connection status to "ok".
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          name: "picodevil-server", version: "0.0.0-test", apiVersion: 1, port, ok: true,
        }));
      }

      if (req.method === "POST" && url.pathname === "/upload") {
        const rawName = url.searchParams.get("name") ?? "";
        if (!rawName || !/^[\w.-]+$/.test(rawName)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid name" }));
        }
        const stem = rawName.replace(/\.[^.]+$/, "");
        const outPath = path.join(downloadDir, `${stem}.mp4`);
        const actualPort = (server.address() as any).port;
        const ws = fs.createWriteStream(outPath);
        req.pipe(ws);
        ws.on("finish", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ url: `http://localhost:${actualPort}/videos/${stem}.mp4`, ready: true }));
        });
        ws.on("error", (err) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(port, () => resolve({ server, downloadDir }));
    server.on("error", reject);
  });
}

/** Errors we don't care about — the render loop trying to play fake video bytes. */
const IGNORED = [
  "video blob fetch failed",
  "Failed to load resource",
  "no supported source",
  "The element has no supported sources",
  "ERR_REQUEST_RANGE_NOT_SATISFIABLE",
];

function isRelevantError(msg: string) {
  return !IGNORED.some(p => msg.includes(p));
}

/** Point the runtime server config at `url` and probe it; returns the status. */
async function configureServer(page: Page, url: string): Promise<string> {
  return page.evaluate(async (u) => {
    const sc = await import("/src/server-config.ts");
    sc.setServerUrl(u);
    await sc.probeHealth();
    return sc.getServerStatus();
  }, url);
}

async function dropFile(page: Page, filename: string) {
  await page.evaluate((name) => {
    const tab = document.getElementById("tab-videos")!;
    const bytes = new Uint8Array(1024).fill(0xff);
    const file = new File([bytes], name, { type: "video/mp4" });
    const dt = new DataTransfer();
    dt.items.add(file);
    tab.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    tab.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, filename);
}

/** Read the in-memory registry entry for `name` (blob entries never hit localStorage). */
async function getEntry(page: Page, name: string): Promise<{ url: string; type: string } | null> {
  return page.evaluate(async (n) => {
    const reg = await import("/src/media-registry.ts");
    const e = reg.getAllEntries().find((x: any) => x.name === n);
    return e ? { url: e.url, type: e.type } : null;
  }, name);
}

async function openFreshPage(browser: Browser, appUrl: string): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
  });
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.removeItem("picodevil-media-registry"));
  await page.waitForFunction(() => typeof (window as any).pdEval === "function", { timeout: 10000 });
  await page.locator("#tab-videos").waitFor({ state: "attached", timeout: 5000 });
  return { page, errors };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

async function testServerReachable(page: Page, errors: string[]) {
  const status = await configureServer(page, MEDIA_URL);
  if (status !== "ok") {
    errors.push(`server reachable: expected status "ok" after probing ${MEDIA_URL}, got "${status}"`);
    return;
  }

  await dropFile(page, "server-clip.mp4");

  // Poll the in-memory registry for the blob→server URL swap (the upload is
  // async; blob entries aren't persisted to localStorage so we read live state).
  const serverUrlAppeared = await page.waitForFunction(async () => {
    const reg = await import("/src/media-registry.ts");
    return reg.getAllEntries().some(
      (e: any) => e.name === "server-clip" && e.url?.startsWith("http://localhost:3456/videos/")
    );
  }, null, { timeout: TIMEOUT_MS }).then(() => true).catch(() => false);

  if (!serverUrlAppeared) {
    errors.push("server reachable: entry URL never updated to server URL — upload did not complete");
  }

  const corsErrors = errors.filter(e => isRelevantError(e) && /cors|blocked/i.test(e));
  if (corsErrors.length > 0) {
    errors.push(...corsErrors.map(e => `server reachable: CORS error: ${e}`));
  }
}

async function testServerUnreachable(page: Page, errors: string[]) {
  // Track whether any XHR to /upload is opened, so we can prove no upload fired.
  await page.evaluate(() => {
    (window as any).__uploadAttempted = false;
    const origXHR = window.XMLHttpRequest;
    (window as any).XMLHttpRequest = class extends origXHR {
      open(method: string, url: string | URL, ...rest: any[]) {
        if (String(url).includes("/upload")) (window as any).__uploadAttempted = true;
        // @ts-expect-error — forwarding to the native signature
        return super.open(method, url, ...rest);
      }
    };
  });

  const status = await configureServer(page, DEAD_URL);
  if (status !== "error") {
    errors.push(`server unreachable: expected status "error" for ${DEAD_URL}, got "${status}"`);
    return;
  }

  await dropFile(page, "noupload-clip.mp4");
  await page.waitForTimeout(2000); // give any (unwanted) upload time to start

  const entry = await getEntry(page, "noupload-clip");
  if (!entry) {
    errors.push("server unreachable: drop did not add a 'noupload-clip' entry");
  } else if (!entry.url.startsWith("blob:")) {
    errors.push(`server unreachable: expected the entry to stay a blob: URL, got ${entry.url}`);
  }

  const attempted = await page.evaluate(() => (window as any).__uploadAttempted);
  if (attempted) {
    errors.push("server unreachable: an /upload XHR was attempted despite status \"error\"");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const vite = await createViteServer({ server: { port: 0 }, logLevel: "warn" });
  await vite.listen();
  const viteAddr = vite.httpServer!.address()!;
  const vitePort = typeof viteAddr === "string" ? 5173 : (viteAddr as any).port;
  const appUrl = `http://localhost:${vitePort}`;

  let mediaServer: http.Server | null = null;
  let downloadDir = "";
  try {
    ({ server: mediaServer, downloadDir } = await startMediaServer(MEDIA_PORT));
  } catch (e: any) {
    console.error(`Could not start media server on port ${MEDIA_PORT}: ${e.message}`);
    console.error("Kill any running media server and retry.");
    await vite.close();
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS, args: GL_ARGS });
  const results: { name: string; errors: string[] }[] = [];

  try {
    // --- Scenario 1: server reachable ---
    {
      const { page, errors } = await openFreshPage(browser, appUrl);
      await testServerReachable(page, errors);
      await page.context().close();
      results.push({ name: "server reachable: drop uploads file to server", errors: errors.filter(isRelevantError) });
    }

    // --- Scenario 2: server unreachable ---
    {
      const { page, errors } = await openFreshPage(browser, appUrl);
      await testServerUnreachable(page, errors);
      await page.context().close();
      results.push({ name: "server unreachable: drop keeps blob URL, no upload", errors: errors.filter(isRelevantError) });
    }
  } finally {
    await browser.close();
    await vite.close();
    mediaServer!.close();
    if (downloadDir) fs.rmSync(downloadDir, { recursive: true, force: true });
  }

  let anyFailed = false;
  for (const r of results) {
    if (r.errors.length === 0) {
      console.log(`✅ ${r.name}`);
    } else {
      console.error(`❌ ${r.name}`);
      r.errors.forEach(e => console.error("   •", e));
      anyFailed = true;
    }
  }

  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

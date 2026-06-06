/**
 * Shared browser test harness.
 *
 * Boots a Vite dev server + a Playwright Chromium page wired to the picodevil
 * runtime, and provides the helpers every browser-driven harness needs:
 * media seeding, frame-metric collection, and golden pixel capture/compare.
 *
 * Extracted from `stress-test.ts` and `golden-render.ts` (which were carrying
 * near-identical copies of all this) so the example perf/golden harnesses can
 * reuse it. Behaviour is intended to be byte-faithful to the originals.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import sirv from "sirv";
import { resolve } from "path";
import { existsSync } from "fs";

// ============================================================
// CLI flags
// ============================================================

/** Parse `--name value` / `--bool` style flags from an argv slice. */
export function parseFlags(argv: string[] = process.argv.slice(2)) {
  const flag = (name: string, def: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const bool = (name: string): boolean => argv.includes(`--${name}`);
  return { argv, flag, bool };
}

// The GL flags that make WebGL2 work in headless Chromium (ANGLE/Metal with a
// SwiftShader fallback). Kept identical to the original harnesses.
const GL_ARGS = ["--use-gl=angle", "--use-angle=metal", "--enable-unsafe-swiftshader"];

// ============================================================
// Harness lifecycle
// ============================================================

export interface HarnessOptions {
  headless: boolean;
  viewport: { width: number; height: number };
  /**
   * If set and the directory exists, it's mounted (with HTTP Range support, so
   * video seeking works) at `/example-media/`. Used to serve example media
   * straight from the sibling `bunnycdn/content/` with no network fetch.
   */
  mediaDir?: string;
}

export interface Harness {
  server: ViteDevServer;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  url: string;
  /** True iff `mediaDir` was provided and existed, so `/example-media/` is live. */
  mediaMounted: boolean;
  /** Re-navigate and wait for the runtime — clears renderer / FBO / video state. */
  reload(): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(opts: HarnessOptions): Promise<Harness> {
  const plugins: any[] = [];
  let mediaMounted = false;
  if (opts.mediaDir && existsSync(opts.mediaDir)) {
    const dir = resolve(opts.mediaDir);
    const serve = sirv(dir, { dev: true, etag: true });
    mediaMounted = true;
    plugins.push({
      name: "example-media",
      configureServer(s: ViteDevServer) {
        s.middlewares.use("/example-media", serve);
      },
    });
  }

  const server = await createServer({ server: { port: 0 }, logLevel: "warn", plugins });
  await server.listen();
  const addr = server.httpServer!.address()!;
  const port = typeof addr === "string" ? 5173 : addr.port;
  const url = `http://localhost:${port}`;

  const browser = await chromium.launch({ headless: opts.headless, args: GL_ARGS });
  const context = await browser.newContext({ viewport: opts.viewport });
  const page = await context.newPage();

  const reload = async () => {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      () => typeof (window as any).pdEval === "function",
      null,
      { timeout: 10000 },
    );
  };
  await reload();

  const close = async () => {
    await browser.close();
    await server.close();
  };

  return { server, browser, context, page, url, mediaMounted, reload, close };
}

/** Seed the page's media registry with name→url entries (idempotent). */
export async function seedMedia(page: Page, entries: { name: string; url: string }[]): Promise<void> {
  await page.evaluate((es) => {
    const addMedia = (window as any).pdAddMedia;
    if (addMedia) for (const { name, url } of es) addMedia(url, name);
  }, entries);
}

// ============================================================
// Stats helpers
// ============================================================

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export interface PhaseStats { p50: number; p95: number }

export function phaseStats(arr: number[]): PhaseStats {
  const s = [...arr].sort((a, b) => a - b);
  return { p50: percentile(s, 50), p95: percentile(s, 95) };
}

export interface RawMetrics {
  frameTimes: number[];
  seeksHistory: number[];
  poolSize: number;
  freePoolSize: number;
  maxFrameTime: number;
  phaseQuery: number[];
  phaseAssign: number[];
  phaseDraw: number[];
  phasePrewarm: number[];
}

/** Read the live frame metrics out of `window.pdMetrics`. */
export async function collectFrameMetrics(page: Page): Promise<RawMetrics> {
  return page.evaluate(() => {
    const m = (window as any).pdMetrics;
    return {
      frameTimes:   [...m.frameTimes],
      seeksHistory: [...m.seeksHistory],
      poolSize:     m.poolSize,
      freePoolSize: m.freePoolSize,
      maxFrameTime: m.maxFrameTime,
      phaseQuery:   [...m.phaseQuery],
      phaseAssign:  [...m.phaseAssign],
      phaseDraw:    [...m.phaseDraw],
      phasePrewarm: [...m.phasePrewarm],
    };
  });
}

// ============================================================
// Golden pixel capture / compare
// ============================================================

export interface PixelData { width: number; height: number; data: Uint8Array }

/**
 * Render one frame at a fixed cycle and read back the post-composited canvas
 * pixels via a 2D blit (avoids WebGL alpha-mode subtleties).
 *
 * `wallMs`, when provided, is forwarded to `pdRenderAt` so wall-clock-driven
 * playback (`sync()`/`rolling()`) is reproducible across calls. When omitted,
 * `pdRenderAt` uses the live clock — matching the original golden harness.
 */
export async function captureFrame(page: Page, cycle: number, cps: number, wallMs?: number): Promise<PixelData> {
  const r = await page.evaluate(({ cycle, cps, wallMs }) => {
    const w = window as any;
    if (wallMs === undefined) w.pdRenderAt(cycle, cps);
    else w.pdRenderAt(cycle, cps, wallMs);
    const c = document.getElementById("c") as HTMLCanvasElement;
    const cw = c.width, ch = c.height;
    const tmp = document.createElement("canvas");
    tmp.width = cw; tmp.height = ch;
    const ctx = tmp.getContext("2d")!;
    ctx.drawImage(c, 0, 0);
    const img = ctx.getImageData(0, 0, cw, ch);
    return { width: cw, height: ch, data: Array.from(img.data) };
  }, { cycle, cps, wallMs });
  return { width: r.width, height: r.height, data: new Uint8Array(r.data) };
}

function pixelsIdentical(a: PixelData, b: PixelData): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

export interface SettleOptions {
  cycle: number;
  cps: number;
  /** Delay before the first capture (asset load). */
  settleMs: number;
  /** Max render→capture iterations. Default 20. */
  maxAttempts?: number;
  /** Optional pinned wall-clock ms for reproducible sync/rolling. */
  wallMs?: number;
}

export interface SettleResult {
  pixels: PixelData;
  /** True if two consecutive captures matched exactly (render stabilized). */
  settled: boolean;
  attempts: number;
}

/**
 * Render at a fixed cycle repeatedly until two consecutive captures are
 * pixel-identical (assets loaded / playback stable) or `maxAttempts` is hit.
 * This is the original golden harness's settle loop, lifted verbatim.
 */
export async function renderAndSettle(page: Page, o: SettleOptions): Promise<SettleResult> {
  const maxAttempts = o.maxAttempts ?? 20;
  let prev: PixelData | null = null;
  let last: PixelData | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    await page.waitForTimeout(i === 0 ? o.settleMs : 100);
    last = await captureFrame(page, o.cycle, o.cps, o.wallMs);
    if (prev && pixelsIdentical(prev, last)) {
      return { pixels: last, settled: true, attempts: i + 1 };
    }
    prev = last;
  }
  return { pixels: last!, settled: false, attempts: maxAttempts };
}

/** Encode pixels as PNG via the browser (avoids a Node PNG dependency). */
export async function encodePng(page: Page, pixels: PixelData): Promise<Uint8Array> {
  const dataUrl: string = await page.evaluate(({ width, height, data }) => {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(width, height);
    img.data.set(new Uint8ClampedArray(data));
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }, { width: pixels.width, height: pixels.height, data: Array.from(pixels.data) });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/** Decode a PNG back to raw pixels via the browser. */
export async function decodePng(page: Page, pngBytes: Uint8Array, expectedW: number, expectedH: number): Promise<PixelData> {
  const result = await page.evaluate(async ({ b64, w, h }) => {
    const img = new Image();
    const url = `data:image/png;base64,${b64}`;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("png decode failed"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    return { width: data.width, height: data.height, data: Array.from(data.data) };
  }, { b64: Buffer.from(pngBytes).toString("base64"), w: expectedW, h: expectedH });
  return { width: result.width, height: result.height, data: new Uint8Array(result.data) };
}

export interface DiffResult { drifted: number; maxDelta: number; total: number }

export function diffPixels(a: PixelData, b: PixelData, tolerance: number): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    return { drifted: a.width * a.height, maxDelta: 255, total: a.width * a.height };
  }
  let drifted = 0, maxDelta = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelDrifted = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      if (d > maxDelta) maxDelta = d;
      if (d > tolerance) pixelDrifted = true;
    }
    if (pixelDrifted) drifted++;
  }
  return { drifted, maxDelta, total };
}

/**
 * TextureCache lifecycle: per-element release (no leak on pool eviction) and the
 * colour-texture LRU cap (bounded under a colour sweep).
 */
import { describe, it, expect } from "vitest";
import { TextureCache, makeCopyCanvas } from "./texture-cache";
import { flushWarnings, clearWarnings } from "./warnings";
import type { TileSource } from "./renderer-interface";

function makeGL(): WebGL2RenderingContext {
  const canvas = document.createElement("canvas");
  canvas.width = 4; canvas.height = 4;
  return canvas.getContext("webgl2") as WebGL2RenderingContext;
}

/** A tiny ready image element to stand in for a pooled media source. */
function readyImage(): HTMLImageElement {
  const img = new Image(2, 2);
  // 2×2 transparent PNG — decodes synchronously enough for naturalWidth in chromium.
  Object.defineProperty(img, "complete", { value: true });
  Object.defineProperty(img, "naturalWidth", { value: 2 });
  Object.defineProperty(img, "naturalHeight", { value: 2 });
  return img;
}

describe("TextureCache.release", () => {
  it("deletes the element's texture and re-creates a fresh one on next get", () => {
    const gl = makeGL();
    const cache = new TextureCache(gl);
    const el = readyImage();
    const source: TileSource = { kind: "image", el };

    const tex1 = cache.get(source);
    expect(tex1).toBeTruthy();
    expect(gl.isTexture(tex1!)).toBe(true);

    cache.release(el);
    expect(gl.isTexture(tex1!)).toBe(false); // GL texture deleted

    const tex2 = cache.get(source);
    expect(tex2).toBeTruthy();
    expect(tex2).not.toBe(tex1); // fresh handle, not the released one
  });
});

describe("makeCopyCanvas (screen-capture OffscreenCanvas fallback)", () => {
  it("uses OffscreenCanvas when available", () => {
    const c = makeCopyCanvas(8, 8);
    expect(c).toBeInstanceOf(OffscreenCanvas);
    expect(c.width).toBe(8);
  });

  it("falls back to a <canvas> and warns when OffscreenCanvas is missing", () => {
    clearWarnings();
    const saved = (globalThis as any).OffscreenCanvas;
    (globalThis as any).OffscreenCanvas = undefined;
    try {
      const c = makeCopyCanvas(16, 16);
      expect(c).toBeInstanceOf(HTMLCanvasElement);
      expect(c.width).toBe(16);
      expect(flushWarnings().some(m => /OffscreenCanvas/i.test(m))).toBe(true);
    } finally {
      (globalThis as any).OffscreenCanvas = saved;
    }
  });
});

/** A real <video> element (so `instanceof HTMLVideoElement` / isReady pass) with
 *  overridden, reassignable videoWidth/seeking/readyState for the seek tests. */
function mockVideo(opts: { seeking?: boolean; readyState?: number } = {}): HTMLVideoElement {
  const el = document.createElement("video");
  const def = (k: string, v: unknown) => Object.defineProperty(el, k, { value: v, writable: true, configurable: true });
  def("videoWidth", 4); def("videoHeight", 4);
  def("seeking", opts.seeking ?? false);
  def("readyState", opts.readyState ?? 4); // HAVE_ENOUGH_DATA
  return el;
}

describe("TextureCache: hold last frame during a seek/stall", () => {
  // Count texImage2D calls to detect re-uploads (an upload of a not-ready frame
  // would push zeros = black; we want it skipped while seeking).
  function instrument(gl: WebGL2RenderingContext) {
    let uploads = 0;
    const orig = gl.texImage2D.bind(gl);
    (gl as any).texImage2D = (...args: any[]) => { uploads++; return (orig as any)(...args); };
    return () => uploads;
  }

  it("uploads a fresh video frame, then holds it (no re-upload) while seeking", () => {
    const gl = makeGL();
    const cache = new TextureCache(gl);
    const el = mockVideo({ seeking: false, readyState: 4 });
    const uploads = instrument(gl);

    const tex1 = cache.get({ kind: "video", el } as TileSource);
    expect(tex1).toBeTruthy();
    const afterFirst = uploads();
    expect(afterFirst).toBeGreaterThan(0);

    // Now mid-seek: same texture returned, but NO new upload (last frame held).
    (el as any).seeking = true;
    (el as any).readyState = 1; // HAVE_METADATA
    const tex2 = cache.get({ kind: "video", el } as TileSource);
    expect(tex2).toBe(tex1);
    expect(uploads()).toBe(afterFirst); // held — no zeros pushed
  });

  it("returns null (don't draw) for a video that has never decoded a frame", () => {
    const gl = makeGL();
    const cache = new TextureCache(gl);
    const el = mockVideo({ seeking: true, readyState: 1 });
    expect(cache.get({ kind: "video", el } as TileSource)).toBeNull();
  });
});

describe("TextureCache colour LRU cap", () => {
  it("stays bounded under a sweep of distinct colours", () => {
    const gl = makeGL();
    const cache = new TextureCache(gl);
    const live = new Set<WebGLTexture>();
    // Far more distinct colours than the 4096 cap.
    for (let i = 0; i < 5000; i++) {
      const r = (i & 0xff) / 255, g = ((i >> 8) & 0xff) / 255, b = ((i >> 4) & 0xff) / 255;
      const tex = cache.get({ kind: "color", r, g, b })!;
      live.add(tex);
    }
    // Count textures still alive — the cache must have evicted+deleted down to the cap.
    let alive = 0;
    for (const t of live) if (gl.isTexture(t)) alive++;
    expect(alive).toBeLessThanOrEqual(4096);
  });

  it("a recently-used colour survives eviction (LRU touch)", () => {
    const gl = makeGL();
    const cache = new TextureCache(gl);
    const hot = cache.get({ kind: "color", r: 1, g: 0, b: 0 })!;
    // Push 4096 other distinct colours, touching the hot colour each iteration so
    // it stays at the tail and isn't the one evicted.
    for (let i = 1; i <= 4096; i++) {
      cache.get({ kind: "color", r: 1, g: 0, b: 0 }); // touch hot
      cache.get({ kind: "color", r: (i & 0xff) / 255, g: 1, b: ((i >> 8) & 0xff) / 255 });
    }
    expect(gl.isTexture(hot)).toBe(true);
    expect(cache.get({ kind: "color", r: 1, g: 0, b: 0 })).toBe(hot);
  });
});

/**
 * Text tiles must not mint a fresh <canvas> (and therefore a fresh GL texture)
 * every frame. getTextCanvas() caches by render inputs, so a static text tile
 * reuses one canvas for the whole session; the cache is LRU-capped and evicted
 * canvases are handed back to the backend so their GL texture is deleted.
 */
import { describe, it, expect } from "vitest";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { MAX_TEXT_CANVASES } from "./config";
import { text } from "./text-pattern";
import "./visual-controls"; // registers .fontColor() / .fontSize() on Pattern.prototype
import type { Renderer, TileParams } from "./renderer-interface";

class CapturingRenderer implements Renderer {
  tiles: TileParams[] = [];
  released: (HTMLVideoElement | HTMLImageElement | HTMLCanvasElement)[] = [];
  resize() {}
  beginFrame() {}
  drawTile(p: TileParams) { this.tiles.push(p); }
  endFrame() {}
  beginOffscreen() {}
  endOffscreen() {}
  snapshotSoFar() {}
  captureAll() {}
  dispose() {}
  releaseSource(el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) { this.released.push(el); }
  /** Canvases handed to drawTile, in order. */
  canvases(): HTMLCanvasElement[] {
    return this.tiles
      .filter(t => t.source.kind === 'text')
      .map(t => (t.source as { kind: 'text'; canvas: HTMLCanvasElement }).canvas);
  }
}

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (name: string) => name });

function renderFrames(r: CapturingRenderer, screens: any[], frames: number) {
  const fr = new FrameRenderer(r, makePool() as any, createMetrics());
  for (let i = 0; i < frames; i++) fr.render(screens as any, [], i / 60, 0.5, i / 60);
  return fr;
}

describe("text canvas cache", () => {
  it("reuses one canvas across frames for an unchanging text tile", () => {
    const r = new CapturingRenderer();
    renderFrames(r, [text('hello')], 10);

    const canvases = r.canvases();
    expect(canvases.length).toBe(10);
    for (const c of canvases) expect(c).toBe(canvases[0]);
    expect(r.released).toEqual([]);
  });

  it("mints separate canvases for different render inputs", () => {
    const r = new CapturingRenderer();
    renderFrames(r, [text('a'), text('b')], 1);

    const [ca, cb] = r.canvases();
    expect(ca).not.toBe(cb);
  });

  it("distinguishes styling, not just the text string", () => {
    const r = new CapturingRenderer();
    renderFrames(r, [
      text('x'),
      (text('x') as any).fontColor('red'),
      (text('x') as any).fontSize(64),
    ], 1);

    const [plain, red, big] = r.canvases();
    expect(red).not.toBe(plain);
    expect(big).not.toBe(plain);
    expect(big).not.toBe(red);
  });

  it("evicts (and releases) the oldest canvas once past the cache cap", () => {
    const r = new CapturingRenderer();
    const fr = new FrameRenderer(r, makePool() as any, createMetrics());
    const n = MAX_TEXT_CANVASES + 8;
    for (let i = 0; i < n; i++) fr.render([text(`t${i}`)] as any, [], i / 60, 0.5, i / 60);

    // Cache is capped, so the excess canvases must have been released, not leaked.
    expect(r.released.length).toBe(n - MAX_TEXT_CANVASES);
    // The released ones are the least-recently-used, i.e. the earliest drawn.
    expect(r.released[0]).toBe(r.canvases()[0]);
  });

  it("keeps a hot entry alive under LRU pressure", () => {
    const r = new CapturingRenderer();
    const fr = new FrameRenderer(r, makePool() as any, createMetrics());
    const hot = text('hot');
    // 'hot' is re-drawn every frame, so it stays the most-recently-used entry.
    for (let i = 0; i < MAX_TEXT_CANVASES + 8; i++) {
      fr.render([hot, text(`cold${i}`)] as any, [], i / 60, 0.5, i / 60);
    }
    const hotCanvas = r.canvases()[0];
    expect(r.released).not.toContain(hotCanvas);
    // Still the same canvas at the end — never evicted, never re-rendered.
    const last = r.canvases();
    expect(last[last.length - 2]).toBe(hotCanvas);
  });
});

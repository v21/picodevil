/**
 * Render draw-budget guard: a runaway pattern (huge layer/tile count) must not
 * block the main thread indefinitely. The draw loop bails between layer groups
 * once it exceeds maxDrawTimeMs, presents the partial frame, and warns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { color } from "./color-pattern";
import { flushWarnings, clearWarnings } from "./warnings";
import type { Renderer, TileParams } from "./renderer-interface";

function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* spin to burn main-thread time */ }
}

class CountingRenderer implements Renderer {
  drawCount = 0;
  constructor(private perTileMs = 0) {}
  resize() {}
  beginFrame() {}
  drawTile(_p: TileParams) { this.drawCount++; if (this.perTileMs) busyWait(this.perTileMs); }
  endFrame() {}
  beginOffscreen() {}
  endOffscreen() {}
  snapshotSoFar() {}
  captureAll() {}
  dispose() {}
}

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (name: string) => name });
const heavyWarn = (msgs: string[]) => msgs.some(m => /stopped early|too heavy/i.test(m));

describe("render draw-budget guard", () => {
  beforeEach(() => clearWarnings());

  it("draws every layer and does not warn for a normal small pattern", () => {
    const r = new CountingRenderer(0);
    const fr = new FrameRenderer(r, makePool() as any, createMetrics());
    const screens = [color("red"), color("blue"), color("green")];
    fr.render(screens as any, [], 0, 0, 0);
    expect(r.drawCount).toBe(3);
    expect(heavyWarn(flushWarnings())).toBe(false);
  });

  it("bails out and warns once the per-frame draw budget is exceeded", () => {
    const r = new CountingRenderer(5); // 5ms per tile
    const fr = new FrameRenderer(r, makePool() as any, createMetrics());
    fr.maxDrawTimeMs = 8; // budget exceeded after ~2 tiles
    const screens = Array.from({ length: 40 }, () => color("red"));
    fr.render(screens as any, [], 0, 0, 0);
    expect(r.drawCount).toBeGreaterThan(0);
    expect(r.drawCount).toBeLessThan(40); // stopped before drawing them all
    expect(heavyWarn(flushWarnings())).toBe(true);
  });
});

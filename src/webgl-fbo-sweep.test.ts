/**
 * Auto-modulator FBO lifecycle: stale sweep + recycling pool.
 *
 * Auto FBOs (`__auto_mod_*`) that were neither rendered nor resolved as a
 * modulator during a frame are swept after it — but recycled into a small
 * size-keyed pool rather than deleted, so re-eval renumbering (name churn) is
 * a Map move instead of a multi-MB texture realloc. User-named FBOs are never
 * swept.
 */
import { describe, it, expect } from "vitest";
import { makeTile, withRenderer, readPixel } from "./webgl-test-helpers";
import { AUTO_MOD_PREFIX } from "./renderer-interface";
import type { WebGLRenderer } from "./webgl-renderer";

const AUTO0 = `${AUTO_MOD_PREFIX}0`;
const AUTO1 = `${AUTO_MOD_PREFIX}1`;

/** Render one frame: fill the named FBO with white, then draw a consumer tile. */
function frameWithAutoFBO(renderer: WebGLRenderer, name: string, consume: boolean): void {
  renderer.beginFrame();
  renderer.beginOffscreen(name);
  renderer.beginFrame();
  renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 1, b: 1 } }));
  renderer.endFrame();
  renderer.endOffscreen();
  if (consume) {
    renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 }, modSrc: name }));
  }
  renderer.endFrame();
  renderer.sweepAutoFBOs();
}

describe("auto-FBO sweep", () => {
  it("keeps a rendered auto FBO, sweeps it once untouched", () => {
    withRenderer((renderer) => {
      frameWithAutoFBO(renderer, AUTO0, true);
      expect(renderer.getAutoFBOStats().count).toBe(1);

      // Next frame: the auto FBO is neither rendered nor resolved → swept.
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 0, g: 1, b: 0 } }));
      renderer.endFrame();
      renderer.sweepAutoFBOs();
      const stats = renderer.getAutoFBOStats();
      expect(stats.count).toBe(0);
      expect(stats.pooled).toBe(1); // recycled, not deleted
    });
  });

  it("an auto FBO kept alive only by modulator resolution survives the sweep", () => {
    withRenderer((renderer) => {
      frameWithAutoFBO(renderer, AUTO0, true);
      // Next frame: NOT re-rendered, but still resolved as a modulator.
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 }, modSrc: AUTO0 }));
      renderer.endFrame();
      renderer.sweepAutoFBOs();
      expect(renderer.getAutoFBOStats().count).toBe(1);
    });
  });

  it("renumbering steady-state: renames reuse the recycled entry", () => {
    withRenderer((renderer) => {
      frameWithAutoFBO(renderer, AUTO0, true);
      // Rename 1 (frame 2): the new name allocates (the old entry is only
      // recycled at this frame's end) — the one cold-start alloc.
      frameWithAutoFBO(renderer, AUTO1, true);
      expect(renderer.getAutoFBOStats().pooled).toBe(1);
      // Rename 2 (frame 3): pops the pooled entry, pushes the newly-stale one.
      // Pool level stays at 1 — a pure Map move, no allocation.
      frameWithAutoFBO(renderer, `${AUTO_MOD_PREFIX}2`, true);
      const stats = renderer.getAutoFBOStats();
      expect(stats.count).toBe(1);
      expect(stats.pooled).toBe(1);
      // 1 active + 1 pooled, both 100×100 RGBA8.
      expect(stats.bytes).toBe(2 * 100 * 100 * 4);
    });
  });

  it("user-named FBOs are never swept", () => {
    withRenderer((renderer, canvas) => {
      // Populate user FBO once.
      renderer.beginFrame();
      renderer.beginOffscreen("user");
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      renderer.endFrame();
      renderer.endOffscreen();
      renderer.endFrame();
      renderer.sweepAutoFBOs();

      // Frames later, without re-rendering it, its content must still resolve.
      renderer.beginFrame();
      renderer.endFrame();
      renderer.sweepAutoFBOs();
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'user' } }));
      renderer.endFrame();
      const [r, , , a] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(a).toBe(255);
    });
  });

  it("stats report VRAM bytes for active + pooled auto FBOs", () => {
    withRenderer((renderer) => {
      frameWithAutoFBO(renderer, AUTO0, true);
      const stats = renderer.getAutoFBOStats();
      // 100×100 RGBA8 = 40 KB
      expect(stats.bytes).toBe(100 * 100 * 4);
    });
  });
});

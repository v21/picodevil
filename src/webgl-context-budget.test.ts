/**
 * WebGL contexts are a scarce per-page resource (Chrome caps live contexts at
 * ~16; past that getContext('webgl2') returns null and every subsequent renderer
 * construction throws "WebGL2 not supported"). dispose() must therefore hand the
 * context back — deleting GL objects alone leaves the context alive until GC,
 * which is what exhausted the budget and failed whole test files at a time.
 */
import { describe, it, expect } from "vitest";
import { WebGLRenderer } from "./webgl-renderer";
import { makeTile, readPixel, W, H } from "./webgl-test-helpers";
import { clearWarnings, flushWarnings } from "./warnings";

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  return canvas;
}

describe("WebGL context budget", () => {
  it("creates and disposes far more renderers than the context limit", () => {
    for (let i = 0; i < 40; i++) {
      const canvas = makeCanvas();
      const renderer = new WebGLRenderer(canvas);
      renderer.resize(W, H);
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      renderer.endFrame();
      expect(readPixel(canvas, 50, 50)[0], `renderer #${i} drew red`).toBeGreaterThan(200);
      renderer.dispose();
    }
  });

  it("releases the GL context on dispose", () => {
    const canvas = makeCanvas();
    const renderer = new WebGLRenderer(canvas);
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
    expect(gl.isContextLost()).toBe(false);
    renderer.dispose();
    expect(gl.isContextLost()).toBe(true);
  });

  it("does not attempt to restore a disposed renderer", () => {
    clearWarnings();
    const canvas = makeCanvas();
    const renderer = new WebGLRenderer(canvas);
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
    renderer.dispose();
    // A deliberate dispose is not a GPU fault: no "context lost" warning to the
    // user, and no rebuild of GL resources for a renderer nobody is using.
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(gl.isContextLost()).toBe(true);
    expect(flushWarnings()).toEqual([]);
  });
});

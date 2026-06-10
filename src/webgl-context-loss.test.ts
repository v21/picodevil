/**
 * WebGL context loss/restore recovery.
 *
 * On a real context loss every GL handle (program, VAO, buffers, UBO, FBO
 * textures) dies. The renderer must rebuild them on 'webglcontextrestored' so the
 * canvas comes back instead of staying black until a page reload. We drive the
 * loss with the WEBGL_lose_context extension and assert the renderer renders a
 * correct frame afterward.
 */
import { describe, it, expect } from "vitest";
import { WebGLRenderer } from "./webgl-renderer";
import { makeTile, readPixel, W, H } from "./webgl-test-helpers";

// loseContext()/restoreContext() fire the canvas events synchronously in Chromium,
// but allow a tick in case the implementation defers the 'restored' event.
function tick() { return new Promise(r => setTimeout(r, 0)); }

describe("WebGL context loss recovery", () => {
  it("recreates GL resources and renders again after a loss+restore", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const renderer = new WebGLRenderer(canvas);
    renderer.resize(W, H);

    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
    const ext = gl.getExtension("WEBGL_lose_context");
    expect(ext, "WEBGL_lose_context must be available in the test browser").toBeTruthy();

    // Sanity: renders a red frame before the loss.
    renderer.beginFrame();
    renderer.drawTile(makeTile({ source: { kind: "color", r: 1, g: 0, b: 0 } }));
    renderer.endFrame();
    expect(readPixel(canvas, 50, 50)[0]).toBeGreaterThan(200);

    // Lose the context, then restore it. preventDefault on 'lost' (done in the
    // renderer) is what lets 'restored' fire.
    ext!.loseContext();
    await tick();
    expect(gl.isContextLost()).toBe(true);
    ext!.restoreContext();
    await tick();

    // After restore the renderer must produce a correct frame again — green this
    // time so we know it's a fresh draw, not a stale framebuffer.
    renderer.resize(W, H);
    renderer.beginFrame();
    renderer.drawTile(makeTile({ source: { kind: "color", r: 0, g: 1, b: 0 } }));
    renderer.endFrame();

    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(g).toBeGreaterThan(200);
    expect(r).toBeLessThan(60);
    expect(b).toBeLessThan(60);

    renderer.dispose();
  });
});

/**
 * WebGL context loss/restore recovery.
 *
 * On a real context loss every GL handle (program, VAO, buffers, UBO, FBO
 * textures) dies. The renderer must rebuild them on 'webglcontextrestored' so the
 * canvas comes back instead of staying black until a page reload. We drive the
 * loss with the WEBGL_lose_context extension and assert the renderer renders a
 * correct frame afterward.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { WebGLRenderer } from "./webgl-renderer";
import { makeTile, readPixel, W, H } from "./webgl-test-helpers";

// loseContext()/restoreContext() fire the canvas events synchronously in Chromium,
// but allow a tick in case the implementation defers the 'restored' event.
function tick() { return new Promise(r => setTimeout(r, 0)); }

afterEach(() => vi.restoreAllMocks());

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

    // Restore must NOT delete objects from the dead context generation — that
    // throws INVALID_OPERATION ("object does not belong to this context"). The
    // pre-loss red frame created a colour texture, so a clean error state here
    // proves we forgot it instead of deleting it.
    expect(gl.getError()).toBe(gl.NO_ERROR);

    renderer.dispose();
  });

  it("reports isContextLost() across a loss + restore (so the render loop can skip)", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const renderer = new WebGLRenderer(canvas);
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
    const ext = gl.getExtension("WEBGL_lose_context")!;

    expect(renderer.isContextLost()).toBe(false);
    ext.loseContext();
    await tick();
    expect(renderer.isContextLost()).toBe(true);
    ext.restoreContext();
    await tick();
    expect(renderer.isContextLost()).toBe(false);

    renderer.dispose();
  });

  it("invokes onUnrecoverable after too many repeated losses instead of retrying forever", async () => {
    // The renderer logs loudly on every loss/restore — silence it for a clean run.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const onUnrecoverable = vi.fn();
    const renderer = new WebGLRenderer(canvas, { onUnrecoverable });
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
    const ext = gl.getExtension("WEBGL_lose_context")!;

    // First two loss+restore cycles recover fine and must NOT give up (MAX = 3).
    for (let i = 0; i < 2; i++) {
      ext.loseContext();
      await tick();
      expect(onUnrecoverable).not.toHaveBeenCalled();
      ext.restoreContext();
      await tick();
    }
    // Third loss trips the give-up threshold.
    ext.loseContext();
    await tick();
    expect(onUnrecoverable).toHaveBeenCalled();

    ext.restoreContext();
    await tick();
    renderer.dispose();
  });
});

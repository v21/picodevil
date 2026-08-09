/**
 * Shared helpers for WebGL unit tests.
 * Import makeTile / renderTiles / withRenderer / readPixel into each webgl-*.test.ts file.
 */
import { WebGLRenderer } from "./webgl-renderer";
import type { TileParams } from "./renderer-interface";

export const W = 100;
export const H = 100;

/** Build a minimal full-screen TileParams with sensible defaults. */
export function makeTile(overrides: Partial<TileParams> = {}): TileParams {
  return {
    source: { kind: 'color', r: 1, g: 0, b: 0 },
    x: 0.5, y: 0.5, w: 1, h: 1,
    cropx: 0.5, cropy: 0.5, cropw: 1, croph: 1,
    fit: 'fill',
    alpha: 1,
    blend: 'source-over',
    rotateZ: 0, rotateXScale: 1, rotateYScale: 1,
    scaleX: 1, scaleY: 1,
    grey: 0, pixelate: 0,
    huerot: 0, contrast: 1, brightness: 0,
    tintHue: 0, tintStrength: 0,
    barrel: 0,
    smear: 0, smearAngle: 0, smearJitter: 0, smearMode: 0,
    ...overrides,
  };
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  return canvas;
}

// One renderer (and therefore one WebGL context) shared by every renderTiles()
// call in a test file. A context per call would blow through the browser's live-
// context budget (~16) within a single describe block, after which getContext
// returns null and every remaining test in the file dies with "WebGL2 not
// supported". beginFrame() clears, so tests still start from a blank canvas.
// Tests that need pristine FBO state (feedback, snapshots) use withRenderer().
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedRenderer: WebGLRenderer | null = null;

/** Render one or more tiles to a shared 100×100 WebGL canvas and return it. */
export function renderTiles(tiles: TileParams[]): HTMLCanvasElement {
  if (!sharedRenderer) {
    sharedCanvas = makeCanvas();
    sharedRenderer = new WebGLRenderer(sharedCanvas);
  }
  sharedRenderer.resize(W, H);
  sharedRenderer.beginFrame();
  for (const tile of tiles) sharedRenderer.drawTile(tile);
  sharedRenderer.endFrame();
  return sharedCanvas!;
}

/** Convenience wrapper for a single tile. */
export function renderTile(params: TileParams): HTMLCanvasElement {
  return renderTiles([params]);
}

/**
 * Run `fn` against a freshly constructed renderer (empty FBO state), disposing it
 * — and releasing its GL context — afterwards. Read pixels *inside* fn: the
 * context is gone by the time it returns.
 */
export function withRenderer<T>(fn: (renderer: WebGLRenderer, canvas: HTMLCanvasElement) => T): T {
  const canvas = makeCanvas();
  const renderer = new WebGLRenderer(canvas);
  renderer.resize(W, H);
  try {
    return fn(renderer, canvas);
  } finally {
    renderer.dispose();
  }
}

/**
 * Read a single RGBA pixel at screen coords (x, y) from a WebGL canvas.
 * gl.readPixels uses bottom-left origin, so y is flipped.
 */
export function readPixel(canvas: HTMLCanvasElement, x: number, y: number): [number, number, number, number] {
  const gl = canvas.getContext('webgl2')! as WebGL2RenderingContext;
  const buf = new Uint8Array(4);
  gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return [buf[0], buf[1], buf[2], buf[3]];
}

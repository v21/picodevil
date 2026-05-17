/**
 * Shared helpers for WebGL unit tests.
 * Import makeTile / renderTiles / readPixel into each webgl-*.test.ts file.
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
    ...overrides,
  };
}

/** Render one or more tiles to a 100×100 WebGL canvas and return it. */
export function renderTiles(tiles: TileParams[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const renderer = new WebGLRenderer(canvas);
  renderer.resize(W, H);
  renderer.beginFrame();
  for (const tile of tiles) renderer.drawTile(tile);
  renderer.endFrame();
  renderer.dispose();
  return canvas;
}

/** Convenience wrapper for a single tile. */
export function renderTile(params: TileParams): HTMLCanvasElement {
  return renderTiles([params]);
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

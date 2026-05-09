import type { FitMode } from './draw-fit';

/** Minimal interface for a registered screen pattern. */
export type Screen = { queryArc(begin: number, end: number): any[] };

/**
 * The pixel source for a rendered tile.
 * Each kind maps to a different HTML element that provides pixel data.
 */
export type TileSource =
  | { kind: 'video' | 'stream'; el: HTMLVideoElement }
  | { kind: 'image'; el: HTMLImageElement }
  | { kind: 'color'; r: number; g: number; b: number }
  | { kind: 'pattern'; name: string }
  | { kind: 'text'; canvas: HTMLCanvasElement };

/**
 * All parameters needed to render a single tile.
 * Positional values are normalised 0..1 canvas fractions.
 * Rotation scales are pre-computed cosines — renderers don't receive raw angles.
 */
export interface TileParams {
  source: TileSource;
  /** Destination rect on canvas, 0..1 normalised. x/y = centre of tile; w/h = size. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Crop window: centre (cropx, cropy) and size (cropw, croph) in 0..1 source coords. */
  cropx: number;
  cropy: number;
  cropw: number;
  croph: number;
  fit: FitMode;
  alpha: number;
  blend: string;
  /** Z rotation in turns (full rotation = 1). */
  rotateZ: number;
  /** Pre-computed cos(rotateX * TAU): Y-axis scale factor from X-rotation. */
  rotateXScale: number;
  /** Pre-computed cos(rotateY * TAU): X-axis scale factor from Y-rotation. */
  rotateYScale: number;
  scaleX: number;
  scaleY: number;
  /** Greyscale amount: 0 = full colour (default), 1 = fully greyscale. Values outside [0,1] adjust saturation. */
  grey: number;
  /** Pixelation block size in screen pixels. 0 = off (default). */
  pixelate: number;
  /** Hue rotation in [0,1] turns (0 = no rotation, 0.5 = opposite hue). */
  huerot: number;
  /** Contrast multiplier, centred at 0.5: 1 = normal (default), 0 = flat grey, -1 = invert. */
  contrast: number;
  /** Brightness offset added after contrast: 0 = no change (default), positive = brighter, negative = darker. */
  brightness: number;
  /** Tint hue target in [0,1] turns. */
  tintHue: number;
  /** Tint strength: 0 = no tint (default), 1 = full colorise, unclamped for hyper-saturation effects. */
  tintStrength: number;
}

/**
 * Renderer backend interface — Canvas 2D and WebGL both implement this.
 */
export interface Renderer {
  /** Called when the canvas is resized. */
  resize(widthPx: number, heightPx: number): void;
  /** Clear the frame and prepare for drawing. */
  beginFrame(): void;
  /** Draw a single tile with the given parameters. */
  drawTile(params: TileParams): void;
  /** Finalise and present the frame. No-op for Canvas 2D; flushes draw list for WebGL. */
  endFrame(): void;
  /** Bind an offscreen framebuffer for the named pattern. */
  beginOffscreen(name: string): void;
  /** Restore the default (canvas) framebuffer. */
  endOffscreen(): void;
  /** Blit the current canvas output to the "all" FBO for next-frame feedback. */
  captureAll(): void;
  /** Release GPU/canvas resources. */
  dispose(): void;
}

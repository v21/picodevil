export type FitMode = "cover" | "contain" | "fill" | "none" | "tile" | "tilecenter";

/**
 * Shared prefix for every hidden FBO layer picodevil auto-registers (modulate
 * modulators, render bakes). The prefix IS the marker for the shared auto-FBO
 * lifecycle — solo exemption, the renderer's stale sweep + recycle pool, and
 * perf-panel accounting all key off it. Users can never mint one: a leading
 * underscore mutes `.p()` registrations.
 */
export const AUTO_PREFIX = '__auto_';

/** Auto-FBO for a `.modulate()` modulator argument. */
export const AUTO_MOD_PREFIX = '__auto_mod_';

/** Auto-FBO for a `.render()` bake of the effect-chain-so-far. */
export const AUTO_RENDER_PREFIX = '__auto_render_';

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
  | { kind: 'text'; canvas: HTMLCanvasElement }
  | { kind: 'qr'; canvas: HTMLCanvasElement };

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
  /** Barrel (>0) / pincushion (<0) distortion coefficient. 0 = off (default). */
  barrel: number;
  /** Signed smear radius in screen px (9-tap). **Sign = tap shape**: > 0 linear (a
   *  directional line), < 0 circular (a rotated ring — `.dilate`/`.erode`), 0 =
   *  jitter-only. `|value|` is the radius; `smearAngle` is the line direction / ring
   *  rotation. */
  smear: number;
  /** smear direction / ring rotation in turns (0 = horizontal, 0.25 = vertical). */
  smearAngle: number;
  /** smear per-tap positional jitter factor; scatters each tap over a disc of
   *  radius jit·(|amount|+1) screen px — a first-class blur, not just a dither.
   *  Default 0 when smear was never invoked. */
  smearJitter: number;
  /** Reducer over the smear taps (`.smearop`), pre-mapped to an int code by
   *  buildTileParams: 0 = avg (default), 1 = avgl, 2 = max (dilate), 3 = min (erode),
   *  4 = maxl, 5 = minl, 6 = median, 7 = medl, 8 = range, 9 = rangel, 10..18 = sharpen1..9. */
  smearMode: number;
  /** Name of the FBO whose pixels displace this tile's UV lookup (`.modulate`). */
  modSrc?: string;
  /** Modulate displacement amount in source-crop UV units. */
  modAmt?: number;
  /** Where the modulator is sampled: working UV (default), tile-local 0..1, or canvas space. */
  modSpace?: 'uv' | 'tile' | 'screen';
}

/**
 * Renderer backend interface.
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
  /**
   * Bind an offscreen framebuffer for the named pattern.
   * When `doubleBuffer` is true, the FBO ping-pongs between two textures so a
   * tile that samples this same FBO reads the previous frame's content (a
   * self-referential feedback effect) instead of triggering a GL feedback loop.
   * The extra texture is allocated only for FBOs that reference themselves.
   * `reqW`/`reqH` (auto-modulator passes only) request a reduced render
   * resolution — the backend renders into a sub-viewport of a ladder-sized
   * texture and modulate lookups scale accordingly.
   */
  beginOffscreen(name: string, doubleBuffer?: boolean, reqW?: number, reqH?: number): void;
  /** Restore the enclosing framebuffer (canvas, or the outer pass when nested). */
  endOffscreen(): void;
  /** Clear the currently bound target to transparent (prime a bake FBO). Optional. */
  clearTarget?(): void;
  /** Flush pending draws and blit current canvas state to the "all" FBO for mid-frame compositing. */
  snapshotSoFar(): void;
  /** Blit the current canvas output to the "prev" FBO for next-frame feedback. */
  captureAll(): void;
  /** Frame-end maintenance: recycle stale auto-modulator FBOs. Optional —
   *  backends without FBOs omit it. Called after captureAll each frame. */
  sweepAutoFBOs?(): void;
  /** Auto-modulator FBO stats for the perf panel (hidden-allocation visibility). */
  getAutoFBOStats?(): { count: number; bytes: number; pooled: number };
  /** Current render-target pixel dims (canvas). Optional — used by the frame
   *  renderer to plan auto-modulator pass sizing; absent = no auto-sizing. */
  getViewportSize?(): { w: number; h: number };
  /** True while the backing GPU context is lost (WebGL only). Optional — backends
   *  that can't lose a context omit it. The render loop skips frames while it holds. */
  isContextLost?(): boolean;
  /** Release GPU/canvas resources. */
  dispose(): void;
  /**
   * Release the cached GPU texture for a source the frame renderer has permanently
   * discarded — a media element evicted by the video pool, or a text canvas evicted
   * from the text cache. Optional — backends without a texture cache omit it.
   */
  releaseSource?(el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): void;
}

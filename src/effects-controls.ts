/**
 * Pixel-level visual effects registered on Pattern.prototype via createMixParam.
 * Colour effects (grey, tint, huerot) share one OKLab round-trip per frame.
 */
import { Pattern } from "@strudel/core";
import { createMixParam } from "./create-mix-param";
import { nextAutoModName, nextAutoRenderName, registerAutoHidden } from "./pattern-registry";
import { splitEffects } from "./effect-fields";

const PatternProto = Pattern.prototype as any;

/**
 * Sets the transparency of the pattern. 0 = fully transparent, 1 = fully opaque.
 *
 * @param {number | string | Pattern} value alpha value or pattern of alpha values (0–1)
 * @returns {Pattern} pattern with alpha applied
 * @example
 * $: video("clip.mp4").alpha(0.5)
 *
 * // patterned alpha
 * $: color("red").alpha("1 0.5 0")
 *
 * // pulsing transparency
 * $: video("clip.mp4").alpha(sine)
 */
export const alpha = createMixParam("alpha");

/**
 * Alias for alpha. Sets the transparency of the pattern.
 *
 * @param {number | string | Pattern} value opacity value (0–1)
 * @returns {Pattern} pattern with opacity applied
 * @example
 * $: video("clip.mp4").opacity(0.5)
 */
export const opacity = createMixParam("opacity");

/**
 * Applies a pixelation (mosaic) effect to the tile, computed in texture space.
 * The pixelation grid rotates with the tile when `.rotateZ()` is applied.
 *
 * @param {number | string | Pattern} value block size in screen pixels; 0 = off (default)
 * @returns {Pattern} pattern with pixelation applied
 * @example
 * // chunky mosaic
 * $: video("clip.mp4").pixelate(20)
 *
 * // animated pixelation
 * $: video("clip.mp4").pixelate(sine.range(1, 40))
 *
 * // pixelation rotates with tile
 * $: video("clip.mp4").pixelate(10).rotateZ(0.25)
 */
export const pixelate = createMixParam("pixelate");
PatternProto.pixelate = function (value?: any) {
  if (value === undefined) value = 8;
  return pixelate(value, this);
};

/**
 * Desaturates the pattern. 0 = full colour (default), 1 = fully greyscale.
 * Values outside [0,1] adjust saturation: negative boosts chroma, >1 inverts chroma.
 *
 * @param {number | string | Pattern} value desaturation amount (0 = no change, 1 = grey)
 * @returns {Pattern} pattern with grey applied
 * @example
 * // fully greyscale
 * $: video("clip.mp4").grey(1)
 *
 * // half desaturated
 * $: video("clip.mp4").grey(0.5)
 *
 * // pulsing desaturation
 * $: video("clip.mp4").grey(sine)
 *
 * // boosted saturation
 * $: video("clip.mp4").grey(-0.5)
 */
const _greyMix = createMixParam("grey");
PatternProto.grey = function (value?: any) {
  if (value === undefined) value = 1;
  return _greyMix(value, this);
};
export const grey = _greyMix;
PatternProto.gray = PatternProto.grey;

/**
 * Rotates the hue of every pixel. Value is in turns: 0 = no change,
 * 0.5 = opposite hue (red → cyan), 1 = full rotation back to original.
 *
 * @param {number | string | Pattern} value hue rotation in turns (0–1)
 * @returns {Pattern} pattern with hue rotation applied
 * @example
 * // invert hue
 * $: video("clip.mp4").huerot(0.5)
 *
 * // cycling hue
 * $: video("clip.mp4").huerot(sine.range(0, 1))
 *
 * // red → green → blue per cycle
 * $: color("red").huerot("0 0.33 0.67")
 */
export const huerot = createMixParam("huerot");

/**
 * Adjusts contrast, centred at 0.5. 1 = normal (default), 0 = flat 50% grey, -1 = invert.
 * Values above 1 increase contrast; negative values invert the image.
 *
 * @param {number | string | Pattern} value contrast multiplier (default 1)
 * @returns {Pattern} pattern with contrast applied
 * @example
 * // punch up contrast
 * $: video("clip.mp4").contrast(2)
 *
 * // invert
 * $: video("clip.mp4").contrast(-1)
 *
 * // flat 50% grey
 * $: video("clip.mp4").contrast(0)
 *
 * // pulsing contrast
 * $: video("clip.mp4").contrast(sine.range(0.5, 2))
 */
export const contrast = createMixParam("contrast");

/**
 * Adds a brightness offset before contrast. 0 = no change (default),
 * positive = brighter, negative = darker.
 *
 * @param {number | string | Pattern} value brightness offset
 * @returns {Pattern} pattern with brightness applied
 * @example
 * // slightly brighter
 * $: video("clip.mp4").brightness(0.2)
 *
 * // darker
 * $: video("clip.mp4").brightness(-0.3)
 *
 * // pulsing brightness
 * $: video("clip.mp4").brightness(sine.range(-0.3, 0.3))
 *
 * // invert
 * $: video("clip.mp4").contrast(-1).brightness(0)
 */
export const brightness = createMixParam("brightness");

const _tintHue      = createMixParam("tintHue");
const _tintStrength = createMixParam("tintStrength");

/**
 * Colorises the pattern toward a target hue in OKLab space.
 * Blends the pixel's chroma toward a fully-saturated target — no discontinuities.
 * Target chroma scales with strength (strength × 0.25 in OKLab units).
 * Values are unclamped — strength > 1 produces hyper-saturated effects.
 *
 * @param {number | string | Pattern} hue target hue in [0,1] turns (0/1 = red, 0.33 = green, 0.67 = blue)
 * @param {number | string | Pattern} [strength=1] tint amount: 0 = no effect, 1 = full colorise, unclamped for hyper effects
 * @returns {Pattern} pattern with tint applied
 * @example
 * // red tint
 * $: video("clip.mp4").tint(0)
 *
 * // subtle blue tint
 * $: video("clip.mp4").tint(0.67, 0.5)
 *
 * // cycling hue tint at full strength
 * $: video("clip.mp4").tint(sine.range(0, 1))
 *
 * // hyper-green (unclamped)
 * $: video("clip.mp4").tint(0.33, 2)
 *
 * // tint then spin the result
 * $: video("clip.mp4").tint(0.5).huerot(sine)
 */
PatternProto.tint = function (hue: any, strength: any = 1) {
  return _tintStrength(strength, _tintHue(hue, this));
};

/**
 * Applies barrel (positive) or pincushion (negative) lens distortion.
 * Barrel distortion bows the image outward, clipping corners to transparent —
 * the classic CRT curved-screen look. For a subtle CRT effect, try values around 0.3–0.5.
 *
 * Barrel (like every UV effect) works in the drawn cell's own [0,1] frame: it is
 * centred on and scaled to the visible cell, so on a crop — `.cropStack()`, or a
 * `.crop*()`/`.scroll*()` window — each tile warps around its own centre. To warp
 * the whole source *before* it is sliced, put a `.render()` between the effect and
 * the crop — crop is a bake-ordered stage, so a crop after `.render()` crops the
 * already-warped frame: `.barrel(k).render().cropStack(3,3)` = whole-frame warp,
 * then sliced.
 *
 * @param {number | string | Pattern} [value=0.5] distortion coefficient: >0 = barrel, <0 = pincushion
 * @returns {Pattern} pattern with lens distortion applied
 * @example
 * // CRT warp on whole composition
 * $: s('all').barrel(0.4)
 *
 * // barrel on a single video
 * $: s('clip.mp4').objectfit('fill').barrel(0.5)
 *
 * // per-tile warp: each cropStack cell bows around its own centre
 * $: s('clip.mp4').cropStack(3,3).tile().barrel(0.5)
 *
 * // pulsing CRT warp
 * $: s('all').barrel(sine.range(0, 0.6))
 */
export const barrel = createMixParam("barrel");
PatternProto.barrel = function (value?: any) {
  if (value === undefined) value = 0.5;
  return barrel(value, this);
};

const _smear = createMixParam("smear");
const _smearAngle = createMixParam("smearAngle");
const _smearJitter = createMixParam("smearJitter");

/**
 * Directional (1-D) Gaussian blur — a 5-tap motion-blur streak along `angle`.
 * `angle` is in turns (0 = horizontal, 0.25 = vertical) and is patternable, so
 * the streak can sweep. `pixels` is the radius in screen pixels; `jitter`
 * randomises each sample point's position (weighted by strength) to dither
 * aliasing into noise.
 *
 * @param {number | string | Pattern} [angle=0] streak direction in turns (0 = horizontal, 0.25 = vertical)
 * @param {number | string | Pattern} [pixels=8] smear radius in screen pixels; 0 = off
 * @param {number | string | Pattern} [jitter=0.1] per-sample positional jitter (fraction of tap step)
 * @returns {Pattern} pattern with directional smear applied
 * @example
 * // horizontal smear
 * $: video("clip.mp4").smear(0, 30)
 *
 * // rotating streak
 * $: video("clip.mp4").smear(sine, 30)
 *
 * // vertical motion blur
 * $: video("clip.mp4").smear(0.25, 20)
 */
PatternProto.smear = function (angle: any = 0, pixels: any = 20, jitter: any = 0.5) {
  return _smearJitter(jitter, _smearAngle(angle, _smear(pixels, this)));
};

// Internal mix params for .modulate — ev.modSrc always carries an auto-FBO
// name minted by .modulate; there is no user-facing string form.
const _modSrc = createMixParam("modSrc");
const _modAmt = createMixParam("modAmt");
const _modSpace = createMixParam("modSpace");

/**
 * Validation only — every valid argument takes the auto-FBO path. Throws the
 * teaching error for a JS string, a non-Pattern, or a string-valued pattern
 * (a double-quoted arg arrives as mini(...) via the transpiler — the likeliest
 * mistake). An empty/unprobeable pattern passes and fails soft later as a
 * blank modulator.
 */
function assertScreenPattern(src: any, fnName: string): void {
  const teach = `${fnName} takes a pattern — wrap the name: .${fnName}(s('mylayer'), amt)`;
  if (typeof src === 'string' || !(src instanceof Pattern)) throw new Error(teach);
  let firstValue: unknown;
  try {
    firstValue = (src as any).queryArc(0, 1)[0]?.value;
  } catch {
    return; // unprobeable → pass
  }
  if (typeof firstValue === 'string') throw new Error(teach);
}

/**
 * Displaces this pattern's texture lookup with another pattern's rendered
 * pixels (Hydra-style texture modulation). The modulator renders to a hidden
 * auto framebuffer; its red/green channels push the sampling point around:
 * mid-grey means "don't move", white/black displace by ±amount/2, and
 * transparent regions displace nothing. One written call = one shared
 * modulator, even across stacked instances.
 *
 * @param {Pattern} source modulator pattern — always a pattern; wrap names in s(): .modulate(s('mylayer'), 0.1)
 * @param {number | string | Pattern} [amount=0.1] displacement in source-UV units; patternable, negative mirrors
 * @returns {Pattern} pattern with modulation applied
 * @example
 * // displace a clip with a scaled copy of itself
 * $: s("clip.mp4").modulate(s("clip.mp4").scale(0.5), 0.1)
 *
 * // named layer as modulator
 * Hnoise: s("noise.mp4")
 * $: s("clip.mp4").modulate(s("noise"), 0.2)
 *
 * // audio-driven feedback warp
 * $: s("clip.mp4").modulate(s("prev"), fft.bass)
 */
PatternProto.modulate = function (src: any, amt: any = 0.1) {
  assertScreenPattern(src, 'modulate');
  const name = nextAutoModName();
  registerAutoHidden(name, src);
  return _modAmt(amt, _modSrc(name, this));
};

/**
 * Sets where a `.modulate` modulator is sampled. Default `'uv'` follows the
 * tile's working UV (crop/scroll and prior warps included — the Hydra-like
 * default); `'tile'` squeezes the modulator into each tile; `'screen'` fixes
 * the modulator to the canvas so each tile reads the region under itself
 * (differentiates stacked copies; the natural pairing for `s("prev")`).
 *
 * @param {string | Pattern} value 'uv' | 'tile' | 'screen' — patternable
 * @returns {Pattern} pattern with the lookup space applied
 * @example
 * // scene-field look: each grid cell reads its own region
 * $: s("clip.mp4").stackN(9).rowscols(3).gridMod().modulate(s("prev"), .2).modspace('screen')
 *
 * // alternate spaces per cycle
 * $: s("clip.mp4").modulate(s("clip.mp4").scale(.5), .1).modspace("uv screen")
 */
PatternProto.modspace = function (value: any) {
  return _modSpace(value, this);
};

/**
 * Bakes the effect chain so far into a hidden framebuffer and returns a pattern
 * that samples it — a genuine resampling boundary. Everything before `.render()`
 * is rendered into an offscreen texture; everything after applies to that
 * texture as if it were a fresh source.
 *
 * **Per-tile, in place.** Each tile is baked and re-drawn at its own position and
 * size, sampling just its own footprint of the bake — so effects after `.render()`
 * are confined to the tile's frame and don't bleed across the canvas:
 *
 *     s("ducks").w(.5).h(.5).smear(A).render().smear(0, B)
 *
 * bakes the smeared half-size ducks, then the second smear stays inside the .5×.5
 * frame (it can't blur into the surrounding canvas).
 *
 * This buys four things the fixed-slot effect order can't:
 * - **Repeated effects** — `.barrel(.3).render().barrel(.3)` is two barrel
 *   passes; without the boundary the two calls would collapse to one.
 * - **Colour-then-UV order** — normally UV warps (barrel/pixelate) always run
 *   before colour ops; a `.render()` between them flips that for the second half.
 * - **Confined effects** — a smear/barrel after `.render()` respects the tile edges.
 * - **Warp-then-crop** — crop is an ordered stage, so a crop *after* `.render()`
 *   crops the baked (warped) frame: `.barrel(k).render().cropStack(3,3)` warps the
 *   whole frame then slices it, vs `.cropStack(3,3).barrel(k)` which warps per-tile.
 *
 * `.render()` is a **meta-effect**: it doesn't render immediately, it marks that
 * an intermediate framebuffer is needed here. Effects are baked into that FBO;
 * source, playback (`speed`/`begin`/…) and geometry (`x`/`y`/`w`/`h`) stay on the
 * one tile value, so they're transparent to where `.render()` sits — `render().speed(2)`
 * and `speed(2).render()` are the same. Boundaries chain (`.render().render()`) and
 * compose with `.modulate`. The intermediate FBOs share the modulate auto-FBO
 * lifecycle (sweep + recycle).
 *
 * @returns {Pattern} the tile tagged with a bake segment; expanded into FBO passes at draw time
 * @example
 * // two barrel passes — stronger warp than one
 * $: s("clip.mp4").barrel(0.3).render().barrel(0.3)
 *
 * // colour-grade, bake, then pixelate the graded result
 * $: s("clip.mp4").contrast(2).tint(0.6).render().pixelate(20)
 *
 * // a smear after render stays inside the half-size frame
 * $: s("clip.mp4").w(.5).h(.5).render().smear(0, 40)
 */
PatternProto.render = function () {
  // Meta-effect: snapshot the effect fields accumulated so far into a bake
  // segment (rendered into its own intermediate FBO at draw time) and clear
  // them, so effects after this call form a fresh pass. Non-effect fields
  // (source, playback, geometry, crop, alpha, blend) are left untouched on the
  // one value — which is why they stay transparent to `.render()` ordering.
  // The FBO name is minted per call site (stable across re-evals) at
  // construction; the layer itself is expanded lazily by the renderer.
  const name = nextAutoRenderName();
  return this.withValue((v: any) => {
    if (!v || typeof v !== "object") return v;
    const { effects, rest } = splitEffects(v);
    const segments = Array.isArray(rest._bakeSegments) ? rest._bakeSegments.slice() : [];
    segments.push({ name, effects });
    return { ...rest, _bakeSegments: segments };
  });
};

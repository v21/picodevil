/**
 * Pixel-level visual effects registered on Pattern.prototype via createMixParam.
 * Colour effects (grey, tint, huerot) share one OKLab round-trip per frame.
 */
import { Pattern } from "@strudel/core";
import { createMixParam } from "./create-mix-param";

const PatternProto = Pattern.prototype as any;

/**
 * Sets the transparency of the pattern. 0 = fully transparent, 1 = fully opaque.
 *
 * @param {number | string | Pattern} value alpha value or pattern of alpha values (0–1)
 * @returns {Pattern} pattern with alpha applied
 * @example
 * $: video("clip.mp4").alpha(0.5)
 * $: color("red").alpha("1 0.5 0")        // patterned alpha
 * $: video("clip.mp4").alpha(sine)         // pulsing transparency
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
 * $: video("clip.mp4").pixelate(20)                    // chunky mosaic
 * $: video("clip.mp4").pixelate(sine.range(1, 40))     // animated pixelation
 * $: video("clip.mp4").pixelate(10).rotateZ(0.25)      // pixelation rotates with tile
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
 * $: video("clip.mp4").grey(1)           // fully greyscale
 * $: video("clip.mp4").grey(0.5)         // half desaturated
 * $: video("clip.mp4").grey(sine)        // pulsing desaturation
 * $: video("clip.mp4").grey(-0.5)        // boosted saturation
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
 * $: video("clip.mp4").huerot(0.5)                 // invert hue
 * $: video("clip.mp4").huerot(sine.range(0, 1))    // cycling hue
 * $: color("red").huerot("0 0.33 0.67")            // red → green → blue per cycle
 */
export const huerot = createMixParam("huerot");

/**
 * Adjusts contrast, centred at 0.5. 1 = normal (default), 0 = flat 50% grey, -1 = invert.
 * Values above 1 increase contrast; negative values invert the image.
 *
 * @param {number | string | Pattern} value contrast multiplier (default 1)
 * @returns {Pattern} pattern with contrast applied
 * @example
 * $: video("clip.mp4").contrast(2)                        // punch up contrast
 * $: video("clip.mp4").contrast(-1)                       // invert
 * $: video("clip.mp4").contrast(0)                        // flat 50% grey
 * $: video("clip.mp4").contrast(sine.range(0.5, 2))       // pulsing contrast
 */
export const contrast = createMixParam("contrast");

/**
 * Adds a brightness offset after contrast. 0 = no change (default),
 * positive = brighter, negative = darker.
 *
 * @param {number | string | Pattern} value brightness offset
 * @returns {Pattern} pattern with brightness applied
 * @example
 * $: video("clip.mp4").brightness(0.2)                    // slightly brighter
 * $: video("clip.mp4").brightness(-0.3)                   // darker
 * $: video("clip.mp4").brightness(sine.range(-0.3, 0.3))  // pulsing brightness
 * $: video("clip.mp4").contrast(-1).brightness(0)         // invert
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
 * $: video("clip.mp4").tint(0)                         // red tint
 * $: video("clip.mp4").tint(0.67, 0.5)                 // subtle blue tint
 * $: video("clip.mp4").tint(sine.range(0, 1))          // cycling hue tint at full strength
 * $: video("clip.mp4").tint(0.33, 2)                   // hyper-green (unclamped)
 * $: video("clip.mp4").tint(0.5).huerot(sine)          // tint then spin the result
 */
PatternProto.tint = function (hue: any, strength: any = 1) {
  return _tintStrength(strength, _tintHue(hue, this));
};

/**
 * Applies barrel (positive) or pincushion (negative) lens distortion.
 * Barrel distortion bows the image outward, clipping corners to transparent —
 * the classic CRT curved-screen look. Works best on full-frame sources like
 * `s("all")`. For a subtle CRT effect, try values around 0.3–0.5.
 *
 * @param {number | string | Pattern} [value=0.5] distortion coefficient: >0 = barrel, <0 = pincushion
 * @returns {Pattern} pattern with lens distortion applied
 * @example
 * $: s('all').barrel(0.4)                          // CRT warp on whole composition
 * $: s('clip.mp4').objectfit('fill').barrel(0.5)   // barrel on a single video
 * $: s('all').barrel(sine.range(0, 0.6))           // pulsing CRT warp
 */
export const barrel = createMixParam("barrel");
PatternProto.barrel = function (value?: any) {
  if (value === undefined) value = 0.5;
  return barrel(value, this);
};

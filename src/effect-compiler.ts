/**
 * Effect compiler: translates a per-tile DrawCommand into an ordered list of
 * shader ops the fragment-shader VM executes.
 *
 * Canonical op order — reproduces the static-flag fragment shader behaviour
 * 1:1 (verified by the golden harness):
 *   1. BARREL    (UV warp, optional clip-out-of-bounds)
 *   2. PIXELATE  (UV quantisation)
 *   3. WRAP      (tile/non-tile UV wrap)
 *   4. SAMPLE    (texture lookup; required for every tile)
 *   5. CONTRAST  (centred contrast)
 *   6. BRIGHTNESS (additive offset)
 *   7. COLOR_OKLAB (grey + tint + huerot, one OKLab round-trip)
 *   8. ALPHA     (final multiply; always emitted)
 *
 * Op layout: every op is exactly 8 floats (2 vec4s in std140), packed:
 *   [0] kind
 *   [1..7] args (interpretation depends on kind)
 *
 * This keeps shader code uniform — the interpreter reads two consecutive vec4s
 * per op without any continuation logic. 32 bytes/op × 512 ops = 16 KB (the
 * WebGL2 minimum UBO size), so a 512-op cap is safe on all WebGL2 GPUs.
 */

// ---------------------------------------------------------------------------
// Op codes — kept in sync with the GLSL interpreter constants in webgl-renderer.ts
// ---------------------------------------------------------------------------

export const OP_SAMPLE      = 0;
export const OP_BARREL      = 1;
export const OP_PIXELATE    = 2;
export const OP_WRAP        = 3;
export const OP_CONTRAST    = 4;
export const OP_BRIGHTNESS  = 5;
export const OP_COLOR_OKLAB = 6;
export const OP_ALPHA       = 7;

/** Number of floats per op (one kind + 7 args). */
export const OP_FLOATS = 8;

/**
 * Inputs the compiler needs from a DrawCommand. Mirrors the fields the
 * static-flag shader currently consumes per instance.
 */
export interface EffectInputs {
  texIndex:     number;
  alpha:        number;
  grey:         number;
  hueRot:       number;
  pixUVStepX:   number;
  pixUVStepY:   number;
  contrast:     number;
  brightness:   number;
  tintHue:      number;
  tintStrength: number;
  barrel:       number;
  cropOffX:     number;
  cropOffY:     number;
  cropSizeX:    number;
  cropSizeY:    number;
  /** 1 = tile/tilecenter (wrap via fract within crop subregion), 0 = clip out-of-bounds. */
  tileMode:     number;
}

/**
 * Compile a tile's effect parameters into an ordered ops array.
 *
 * Each op consumes OP_FLOATS slots in the output. The caller appends these to
 * the per-frame ops buffer and tracks (offset, count) for each tile.
 *
 * Returns a fresh Float32Array sized exactly to the chain. Callers that want
 * to avoid allocation can reuse a scratch array via compileInto.
 */
export function compile(e: EffectInputs): Float32Array {
  // Worst case: BARREL + PIXELATE + WRAP + SAMPLE + CONTRAST + BRIGHTNESS + COLOR_OKLAB + ALPHA = 8
  const scratch = new Float32Array(8 * OP_FLOATS);
  const count = compileInto(e, scratch, 0);
  return scratch.subarray(0, count * OP_FLOATS);
}

/**
 * Compile into a caller-supplied buffer at the given offset. Returns the
 * number of ops written. The buffer must have at least 8 * OP_FLOATS free
 * slots at `offset`.
 */
export function compileInto(e: EffectInputs, out: Float32Array, offset: number): number {
  let i = offset;
  let count = 0;

  // BARREL: only emit when the parameter is non-zero. The y arg encodes the
  // out-of-bounds behaviour: 0 = clip (alpha 0 outside [0,1]), 1 = wrap.
  if (e.barrel !== 0) {
    out[i] = OP_BARREL;
    out[i + 1] = e.barrel;
    out[i + 2] = e.tileMode;
    out[i + 3] = 0; out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
    i += OP_FLOATS;
    count++;
  }

  // PIXELATE: only emit when step is non-zero. The clamp mode (arg2) is 1 for
  // non-tile fits, 0 for tile fits — matches the existing shader behaviour
  // ("for non-tile modes clamp the upper bound").
  if (e.pixUVStepX > 0 || e.pixUVStepY > 0) {
    out[i] = OP_PIXELATE;
    out[i + 1] = e.pixUVStepX;
    out[i + 2] = e.pixUVStepY;
    out[i + 3] = e.tileMode < 0.5 ? 1 : 0;
    out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
    i += OP_FLOATS;
    count++;
  }

  // WRAP: always emit (every tile needs the final UV wrap step, even if it
  // boils down to fract(uv) in the simplest case). tileMode = 0 → plain fract,
  // tileMode = 1 → fract within crop subregion.
  out[i] = OP_WRAP;
  out[i + 1] = e.cropOffX;
  out[i + 2] = e.cropOffY;
  out[i + 3] = e.cropSizeX;
  out[i + 4] = e.cropSizeY;
  out[i + 5] = e.tileMode;
  out[i + 6] = 0; out[i + 7] = 0;
  i += OP_FLOATS;
  count++;

  // SAMPLE: always emit. Carries the texture-unit index.
  out[i] = OP_SAMPLE;
  out[i + 1] = e.texIndex;
  out[i + 2] = 0; out[i + 3] = 0; out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
  i += OP_FLOATS;
  count++;

  // CONTRAST: only emit when non-identity (1). Matches today's "color.rgb = (color.rgb - 0.5) * contrast + 0.5".
  if (e.contrast !== 1) {
    out[i] = OP_CONTRAST;
    out[i + 1] = e.contrast;
    out[i + 2] = 0; out[i + 3] = 0; out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
    i += OP_FLOATS;
    count++;
  }

  // BRIGHTNESS: only emit when non-zero. Additive offset.
  if (e.brightness !== 0) {
    out[i] = OP_BRIGHTNESS;
    out[i + 1] = e.brightness;
    out[i + 2] = 0; out[i + 3] = 0; out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
    i += OP_FLOATS;
    count++;
  }

  // COLOR_OKLAB: combined grey/tint/huerot, sharing one OKLab round-trip
  // exactly as the static shader does. Emit when any of the three is active.
  if (e.grey !== 0 || e.tintStrength !== 0 || e.hueRot !== 0) {
    out[i] = OP_COLOR_OKLAB;
    out[i + 1] = e.grey;
    out[i + 2] = e.tintHue;
    out[i + 3] = e.tintStrength;
    out[i + 4] = e.hueRot;
    out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
    i += OP_FLOATS;
    count++;
  }

  // ALPHA: always emit. The static shader applies "color.a *= v_alpha"
  // unconditionally on every tile.
  out[i] = OP_ALPHA;
  out[i + 1] = e.alpha;
  out[i + 2] = 0; out[i + 3] = 0; out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
  i += OP_FLOATS;
  count++;

  return count;
}

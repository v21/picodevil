/**
 * Effect compiler: translates a per-tile DrawCommand into an ordered list of
 * shader ops the fragment-shader VM executes.
 *
 * Canonical op order — reproduces the static-flag fragment shader behaviour
 * 1:1 (verified by the golden harness):
 *   1. BARREL    (UV warp, optional clip-out-of-bounds)
 *   2. MODULATE  (UV displacement from a modulator texture)
 *   3. PIXELATE  (UV quantisation)
 *   4. WRAP      (tile/non-tile UV wrap)
 *   5. SAMPLE    (texture lookup; required for every tile — the "pivot" slot.
 *                 OP_SMEAR or OP_DILATE take this slot instead when active, so
 *                 there is always exactly one sampling op)
 *   6. BRIGHTNESS (additive offset)
 *   7. CONTRAST  (centred contrast)
 *   8. COLOR_OKLAB (grey + tint + huerot, one OKLab round-trip)
 *   9. ALPHA     (final multiply; always emitted)
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
export const OP_MODULATE    = 8;
/** Directional smear: a multi-tap sample that replaces SAMPLE in the pivot slot
 *  when smear is active (a tile has exactly one sampling op, so this never
 *  coexists with SAMPLE). Its reducer is selectable via `smearMode` (`.smearop`)
 *  — avg (default) / min / max / median / range / sharpen etc. */
export const OP_SMEAR       = 9;
/** Ring morphology (`.dilate`): a 9-tap circular max/min sample that also
 *  replaces SAMPLE in the pivot slot. Emitted ahead of SMEAR, so when both are
 *  set on one tile dilate wins the single sampling slot (combine via `.render()`).
 *  A distinct op code, but it occupies the pivot rather than lengthening the
 *  chain, so MAX_OPS is unchanged. */
export const OP_DILATE      = 10;

/** Number of floats per op (one kind + 7 args). */
export const OP_FLOATS = 8;

/** Maximum ops one tile can compile to (the fully-loaded chain). Sizes every
 *  scratch buffer that holds a single chain — compile(), the renderer's
 *  opsScratch, and the UBO-overflow retry all rely on it. SMEAR occupies the
 *  SAMPLE slot rather than adding one, so the ceiling is unchanged. */
export const MAX_OPS = 9;

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
  /** Texture unit of the modulator FBO texture; -1 = no modulate op. */
  modTexIndex:  number;
  /** Displacement amount in source-crop UV units (centred: mid-grey = no move). */
  modAmt:       number;
  /** Lookup space: 0 = uv (working UV at this slot), 1 = tile (v_local), 2 = screen (gl_FragCoord). */
  modSpace:     number;
  /** Modulator lookup scale (auto-sizing sub-viewport: view/tex). 1 = full texture. */
  modUVScaleX:  number;
  modUVScaleY:  number;
  /** 1 when the consumer's working UV space is y-down (element-texture source),
   *  0 for FBO-source consumers (y-up). Controls the uv-space lookup mirror and
   *  the visual-Y displacement sign so green > 0.5 displaces visually the same
   *  way for both consumer kinds. */
  modYDown:     number;
  // Smear (source UV units, computed CPU-side from screen pixels).
  /** Directional smear per-tap offset vector (dir × step). 0,0 = no smear. */
  smearOffX?:   number;
  smearOffY?:   number;
  /** Per-tap positional jitter half-extent in UV, per axis (jit·smear·|uvPerPx|)
   *  — a constant screen-pixel dither regardless of the fit's per-axis scale. */
  smearJitAmpX?: number;
  smearJitAmpY?: number;
  /** Reducer applied over the smear taps (`.smearop`): 0 = avg (default, today's
   *  smear), 1 = avgl, 2 = max, 3 = min, 4 = maxl, 5 = minl, 6 = median,
   *  7 = medl, 8 = range, 9 = rangel, 10..18 = sharpen1..9. Rides OP_SMEAR only. */
  smearMode?:   number;
  // Ring dilate/erode (source UV units, computed CPU-side from screen pixels).
  /** Per-axis ring radius in UV (|amount|·uvPerPx). 0,0 = no dilate. */
  dilRadUVx?:   number;
  dilRadUVy?:   number;
  /** Per-axis ring jitter half-extent in UV (jit·|amount|·|uvPerPx|). */
  dilJitAmpX?:  number;
  dilJitAmpY?:  number;
  /** Reduction mode / sign: +1 = dilate (per-channel max), -1 = erode (min). */
  dilMode?:     number;
  /** 1 when the main source is an FBO texture (a `.render()` bake, `s("name")`,
   *  `s("all")`/`s("prev")`) — its content is **premultiplied** (source-over
   *  baking writes rgb·a into a transparent target). The straight-alpha pipeline
   *  (colour ops + SRC_ALPHA blend) must un-premultiply it on read, else every
   *  antialiased / partially-transparent edge is darkened by alpha a second time
   *  (a `.render()` on an image/video visibly erodes its edges). Element textures
   *  are straight-alpha → 0. */
  sourceIsFbo?: number;
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
  const scratch = new Float32Array(MAX_OPS * OP_FLOATS);
  const count = compileInto(e, scratch, 0);
  return scratch.subarray(0, count * OP_FLOATS);
}

/**
 * Compile into a caller-supplied buffer at the given offset. Returns the
 * number of ops written. The buffer must have at least MAX_OPS * OP_FLOATS
 * free slots at `offset`.
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

  // MODULATE: emit whenever a modulator texture is bound — NOT gated on amt.
  // A patterned amt crossing zero must not toggle the op in and out (it would
  // churn the UBO chain identity); a zero-amt read is a cheap no-op.
  // The 0.5 displacement bias is hardcoded in the shader branch, not packed.
  if (e.modTexIndex >= 0) {
    out[i] = OP_MODULATE;
    out[i + 1] = e.modTexIndex;
    out[i + 2] = e.modAmt;
    out[i + 3] = e.modSpace;
    out[i + 4] = e.modUVScaleX;
    out[i + 5] = e.modUVScaleY;
    out[i + 6] = e.modYDown;
    out[i + 7] = 0;
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

  // SAMPLE / SMEAR / DILATE: exactly one sampling op per tile. A multi-tap read
  // (smear or dilate) replaces the single-tap OP_SAMPLE in this same pivot slot
  // when active — so the chain length (and MAX_OPS) is unchanged and the common
  // path stays a single tap. Precedence: DILATE > SMEAR > SAMPLE, so when both a
  // ring dilate and a smear land on one tile, dilate wins the slot (they compose
  // only across a `.render()` boundary). `|| 0` guards partial test inputs.
  const drx = e.dilRadUVx || 0, dry = e.dilRadUVy || 0;
  const sx = e.smearOffX || 0, sy = e.smearOffY || 0;
  const sjx = e.smearJitAmpX || 0, sjy = e.smearJitAmpY || 0;
  if (drx !== 0 || dry !== 0) {
    out[i] = OP_DILATE;
    out[i + 1] = e.texIndex;
    out[i + 2] = drx;
    out[i + 3] = dry;
    // b.x = jitter amp X, b.y = source-is-FBO, b.z = jitter amp Y, b.w = mode
    // (+1 dilate / -1 erode). Confine window derived in-shader from OP_WRAP.
    out[i + 4] = e.dilJitAmpX || 0;
    out[i + 5] = e.sourceIsFbo ? 1 : 0;
    out[i + 6] = e.dilJitAmpY || 0;
    out[i + 7] = e.dilMode || 0;
    // Emit SMEAR when the directional offset OR the jitter is non-zero: a smear
    // with pixels 0 but jitter > 0 is a valid jitter-only stochastic sample (d1 = 0,
    // the 5 taps differ only by their per-tap random displacement).
  } else if (sx !== 0 || sy !== 0 || sjx !== 0 || sjy !== 0) {
    out[i] = OP_SMEAR;
    out[i + 1] = e.texIndex;
    out[i + 2] = sx;
    out[i + 3] = sy;
    // b.x = jitter amp X, b.y = source-is-FBO, b.z = jitter amp Y, b.w = reducer
    // mode. (The tap confine window is derived in-shader from OP_WRAP's window.)
    out[i + 4] = e.smearJitAmpX || 0;
    out[i + 5] = e.sourceIsFbo ? 1 : 0;
    out[i + 6] = e.smearJitAmpY || 0;
    out[i + 7] = e.smearMode || 0;
  } else {
    out[i] = OP_SAMPLE;
    out[i + 1] = e.texIndex;
    // a.z = source-is-FBO flag (un-premultiply the sample back to straight alpha).
    out[i + 2] = e.sourceIsFbo ? 1 : 0;
    out[i + 3] = 0; out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
  }
  i += OP_FLOATS;
  count++;

  // BRIGHTNESS: only emit when non-zero. Additive offset, applied before contrast.
  if (e.brightness !== 0) {
    out[i] = OP_BRIGHTNESS;
    out[i + 1] = e.brightness;
    out[i + 2] = 0; out[i + 3] = 0; out[i + 4] = 0; out[i + 5] = 0; out[i + 6] = 0; out[i + 7] = 0;
    i += OP_FLOATS;
    count++;
  }

  // CONTRAST: only emit when non-identity (1). Matches today's "color.rgb = (color.rgb - 0.5) * contrast + 0.5".
  if (e.contrast !== 1) {
    out[i] = OP_CONTRAST;
    out[i + 1] = e.contrast;
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

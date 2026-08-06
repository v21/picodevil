import { AUTO_PREFIX, type Renderer, type TileParams, type TileSource } from './renderer-interface';
import { ladderStep } from './modulate-sizing';
import { TextureCache } from './texture-cache';
import { warn } from './warnings';
import {
  compileInto, OP_FLOATS, MAX_OPS,
  OP_SAMPLE, OP_BARREL, OP_PIXELATE, OP_WRAP,
  OP_CONTRAST, OP_BRIGHTNESS, OP_COLOR_OKLAB, OP_ALPHA,
  OP_MODULATE, OP_SMEAR,
} from './effect-compiler';

// ---------------------------------------------------------------------------
// Startup failure types
// ---------------------------------------------------------------------------
// The renderer can fail to initialise in two distinct ways, and the user needs
// different advice for each (see rendererFailureMessage in fatal-overlay.ts):
//   1. No WebGL2 context at all — the GPU path isn't available.
//   2. Context exists but a shader won't compile/link — the driver rejected our
//      GLSL (classically ANGLE→Direct3D on Windows).
// Both carry a distinct `.name` so the overlay can branch without importing this
// module (keeps the fatal-overlay safety net dependency-free).

/** Thrown when `canvas.getContext('webgl2')` returns null: no WebGL2 support,
 *  hardware acceleration disabled, or a blocklisted GPU/driver. */
export class WebGL2UnavailableError extends Error {
  constructor(message = 'WebGL2 not supported') {
    super(message);
    this.name = 'WebGL2UnavailableError';
  }
}

/** Thrown when a shader fails to compile or a program fails to link. The context
 *  exists, but the GPU/driver couldn't build our GLSL. Message carries the driver
 *  info-log (also dumped to console at the throw site). */
export class ShaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShaderError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Upper bound for sampler slots. The actual count is clamped to
// gl.MAX_TEXTURE_IMAGE_UNITS at runtime and the shader is compiled with that value.
//
// 15, NOT 16, and not the device maximum — this works around an ANGLE/D3D11 bug
// that killed picodevil on every Windows machine. A fragment shader that declares
// BOTH a sampler array of exactly MAX_TEXTURE_IMAGE_UNITS (16 on all D3D11 feature
// levels >= 11.0) AND a std140 block whose single field is an array of >= 50
// elements (our Effects block: vec4 ops[1024]) loses the WebGL2 context after 2-3
// frames, with no GL error. Chrome then blocks the origin — "Web page caused
// context loss and was blocked" — after which getContext('webgl2') returns null
// browser-wide until the browser is fully restarted, not just the tab.
//
// Why the two interact: at >= 50 elements ANGLE translates the block from an HLSL
// cbuffer to a StructuredBuffer on a `t` register (kMinArraySizeUseStructuredBuffer
// in RecordUniformBlocksWithLargeArrayMember.cpp), and samplers share that register
// counter (mSRVRegister, ResourcesHLSL.cpp) — so 16 samplers push it to t16, one
// past ANGLE's own 16-entry SRV cache. Dropping to 15 leaves it a slot.
//
// Measured on GTX 1660 SUPER / driver 32.0.15.9186 / Windows 11: 15 samplers
// survives, 16 dies, and vec4[49] survives where vec4[50] dies — both boundaries
// exact and deterministic. To re-derive: declare u_tex[16] + a std140 block with
// one array field of >= 50 elements, reference both, draw a quad; the context
// dies in 2-3 frames. Costs us almost nothing — only ~15% of devices report more
// than 16 units anyway (Web3D Survey), so this is marginally more draw calls.
export const MAX_TEX_UNITS = 15;

/**
 * Build the diagnostic for a failed `getContext('webgl2')`.
 *
 * `statusMessage` is the browser's own explanation, captured from the
 * 'webglcontextcreationerror' event. `hasWebGL1` is the key discriminator: if
 * WebGL1 is dead too, GPU acceleration is off wholesale (hardware acceleration
 * disabled, or Chrome retired the GPU process after repeated crashes — which is
 * what a run of context losses eventually escalates to). If WebGL1 works and only
 * WebGL2 was refused, it really is a WebGL2 capability/blocklist problem.
 */
export function describeContextCreationFailure(statusMessage: string, hasWebGL1: boolean): string {
  const cause = hasWebGL1
    ? 'WebGL1 still works, so the GPU is present and WebGL2 was refused specifically. ' +
      'The usual cause is NOT an old GPU: Chrome disables GPU-backed WebGL2 browser-wide ' +
      'after roughly three GPU-process crashes, and it stays disabled until the browser ' +
      'is fully restarted (reloading the tab will not clear it). If picodevil crashed the ' +
      'GPU earlier in this browser session, that is what you are seeing.'
    : 'WebGL1 is unavailable too, so this is not a WebGL2-specific problem: hardware ' +
      'acceleration is off entirely, or the GPU process is unusable.';
  return (
    "could not create a WebGL2 context — canvas.getContext('webgl2') returned null. " +
    `Browser reason: "${statusMessage || '(none)'}". ${cause} ` +
    'Diagnose at chrome://gpu (Chromium/Edge) or about:support → Graphics (Firefox).'
  );
}

// Give up on automatic context-loss recovery after this many losses in a session
// and surface the fatal overlay — a Windows GPU stuck in a TDR reset loop would
// otherwise just flash black forever.
const MAX_CONTEXT_LOSSES = 3;

// Log the GPU identity only once (production has a single renderer; this just keeps
// the test suite, which builds many, from repeating the line).
let gpuInfoLogged = false;

// Per-instance Float32Array layout (26 floats = 104 bytes):
//   [0..1]   destOffset   (vec2)
//   [2..3]   destSize     (vec2)
//   [4..5]   uvOffset     (vec2)
//   [6..7]   uvSize       (vec2)
//   [8..23]  transform    (mat4, column-major)
//   [24]     effectStart  (float; index into ops[] in pairs of vec4)
//   [25]     effectCount  (float; number of ops in this tile's chain)
const INSTANCE_FLOATS = 26;
const INSTANCE_STRIDE = INSTANCE_FLOATS * 4; // bytes

// Attribute locations (fixed via layout(location=N) in shader)
const LOC_POSITION    = 0;
const LOC_UV          = 1;
const LOC_DEST_OFFSET = 2;
const LOC_DEST_SIZE   = 3;
const LOC_UV_OFFSET   = 4;
const LOC_UV_SIZE     = 5;
const LOC_TRANSFORM   = 6; // mat4 occupies 6, 7, 8, 9
const LOC_EFFECTS     = 10; // vec2: (effectStart, effectCount)

// UBO size (vec4 slots). Each op = 2 vec4s. 1024 vec4s = 512 ops.
// 16 KB is the WebGL2-guaranteed MAX_UNIFORM_BLOCK_SIZE minimum, so this works
// everywhere. With per-batch dedup, 512 ops is plenty for typical patterns
// (cropStack(25,25) with uniform effects collapses to a single ~3-op chain).
const UBO_VEC4_CAPACITY = 1024;

// ---------------------------------------------------------------------------
// GLSL shaders
// ---------------------------------------------------------------------------

const VERT_SRC = /* glsl */`#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;

layout(location = 2) in vec2 a_destOffset;
layout(location = 3) in vec2 a_destSize;
layout(location = 4) in vec2 a_uvOffset;
layout(location = 5) in vec2 a_uvSize;
layout(location = 6) in mat4 a_transform; // locations 6-9
layout(location = 10) in vec2 a_effects;  // x=effectStart, y=effectCount

flat out int v_effectStart;
flat out int v_effectCount;
out vec2 v_uv;
out vec2 v_local;

void main() {
  v_uv = a_uvOffset + a_uv * a_uvSize;
  v_local = a_uv;
  v_effectStart = int(a_effects.x);
  v_effectCount = int(a_effects.y);

  vec2 pos = a_destOffset + (a_position - 0.5) * a_destSize;
  vec2 clip = pos * 2.0 - 1.0;
  clip.y = -clip.y;

  gl_Position = a_transform * vec4(clip, 0.0, 1.0);
}`;

// Build the fragment shader source for a given number of texture units.
export function buildFragSrc(n: number): string {
  // sampleAny dispatches to one of N texture units via an if/else chain
  // (GLSL can't dynamically index sampler arrays; constant indexing inside a
  // function is legal in ES 3.0). Shared by OP_SAMPLE and OP_MODULATE.
  const sampleChain = Array.from({ length: n }, (_, i) =>
    `if (texIdx == ${i}) return texture(u_tex[${i}], uv);`
  ).join('\n  ');

  return /* glsl */`#version 300 es
precision mediump float;

uniform sampler2D u_tex[${n}];
// Pixel dims of the ACTIVE render target (canvas or FBO pass), not a canvas
// constant — screen-space modulate lookups must be 0..1 across the current target.
uniform vec2 u_resolution;

layout(std140) uniform Effects {
  // Packed ops: each op is 2 consecutive vec4s.
  //   ops[i*2].x = kind
  //   ops[i*2].yzw, ops[i*2+1].xyzw = args (interpretation per kind)
  vec4 ops[${UBO_VEC4_CAPACITY}];
};

flat in int v_effectStart;
flat in int v_effectCount;
in vec2 v_uv;
in vec2 v_local;
out vec4 fragColor;

#define OP_SAMPLE      ${OP_SAMPLE}
#define OP_BARREL      ${OP_BARREL}
#define OP_PIXELATE    ${OP_PIXELATE}
#define OP_WRAP        ${OP_WRAP}
#define OP_CONTRAST    ${OP_CONTRAST}
#define OP_BRIGHTNESS  ${OP_BRIGHTNESS}
#define OP_COLOR_OKLAB ${OP_COLOR_OKLAB}
#define OP_ALPHA       ${OP_ALPHA}
#define OP_MODULATE    ${OP_MODULATE}
#define OP_SMEAR       ${OP_SMEAR}

vec4 sampleAny(int texIdx, vec2 uv) {
  ${sampleChain}
  return texture(u_tex[0], uv);
}

// Per-pixel hash → [0,1). Jitters smear sample positions so wide offsets dither
// into noise instead of aliasing. From
// http://amindforeverprogramming.blogspot.com/2013/07/random-floats-in-glsl-330.html
uint pdHash(uint x) {
  x += (x << 10u); x ^= (x >> 6u); x += (x << 3u); x ^= (x >> 11u); x += (x << 15u);
  return x;
}
uint pdHash(uvec2 v) { return pdHash(v.x ^ pdHash(v.y)); }
float pdRandom(highp vec2 v) {
  uint h = pdHash(floatBitsToUint(v));
  h &= 0x007FFFFFu; h |= 0x3F800000u;
  return uintBitsToFloat(h) - 1.0;
}
// Two decorrelated draws → a random point in the unit square.
vec2 pdRandom2(highp vec2 v) { return vec2(pdRandom(v), pdRandom(v + 19.19)); }
// Per-(fragment,tap) x/y displacement of half-extent amp. k is a running tap
// counter; the irrational multipliers avoid axis/diagonal seed collisions
// between neighbouring fragments.
vec2 pdJit(vec2 fc, float k, vec2 amp) {
  return (pdRandom2(fc + vec2(k * 0.7548, k * 1.3821)) - 0.5) * amp;
}

// Directional smear: a 5-tap 1-D Gaussian [1 4 6 4 1]/16 along d1. Every
// sampling point — the centre included — is displaced by its own random x/y
// jitter of half-extent j·|d1|, so the jitter is weighted by strength and turns
// wide-offset aliasing into noise. Each tap wraps via fract.
//   d1 = smear per-tap UV offset (taps at -2..2 · d1)
vec4 smearSample(int texIdx, vec2 uv, vec2 d1, float j) {
  if (d1.x == 0.0 && d1.y == 0.0) return sampleAny(texIdx, uv);

  vec2 fc = gl_FragCoord.xy;
  vec2 amp = vec2(j * length(d1));   // isotropic jitter half-extent
  float w5[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
  vec4 s = vec4(0.0);
  for (int t = 0; t < 5; ++t)
    s += sampleAny(texIdx, fract(uv + d1 * float(t - 2) + pdJit(fc, float(t), amp))) * w5[t];
  return s / 16.0;
}

// Sign-preserving sRGB gamma encode/decode — handles out-of-gamut values from
// extreme contrast/tint without NaN from negative pow().
float srgb_to_linear_ch(float c) {
  float a = abs(c);
  return sign(c) * (a <= 0.04045 ? a / 12.92 : pow((a + 0.055) / 1.055, 2.4));
}
float linear_to_srgb_ch(float c) {
  float a = abs(c);
  return sign(c) * (a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 1.0/2.4) - 0.055);
}
vec3 srgb_to_linear(vec3 c) {
  return vec3(srgb_to_linear_ch(c.r), srgb_to_linear_ch(c.g), srgb_to_linear_ch(c.b));
}
vec3 linear_to_srgb(vec3 c) {
  return vec3(linear_to_srgb_ch(c.r), linear_to_srgb_ch(c.g), linear_to_srgb_ch(c.b));
}
float scbrt(float x) { return sign(x) * pow(abs(x), 1.0/3.0); }

vec3 linear_rgb_to_oklab(vec3 c) {
  float l = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;
  float m = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;
  float s = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;
  float l_ = scbrt(l), m_ = scbrt(m), s_ = scbrt(s);
  return vec3(
    0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
    1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
    0.0259040371*l_ + 0.4072402616*m_ - 0.4329829013*s_
  );
}
vec3 oklab_to_linear_rgb(vec3 lab) {
  float l_ = lab.x + 0.3963377774*lab.y + 0.2158037573*lab.z;
  float m_ = lab.x - 0.1055613458*lab.y - 0.0638541728*lab.z;
  float s_ = lab.x - 0.0894841775*lab.y - 1.2914855480*lab.z;
  float l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
  return vec3(
     4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
  );
}

void main() {
  vec2 uv = v_uv;
  vec4 color = vec4(0.0);
  bool discarded = false;

  // effectStart is already in vec4 slots; each op spans 2 vec4 slots.
  for (int i = 0; i < v_effectCount; ++i) {
    if (discarded) break;
    int idx = v_effectStart + i * 2;
    vec4 a = ops[idx];
    vec4 b = ops[idx + 1];
    int kind = int(a.x);

    if (kind == OP_BARREL) {
      // Barrel/pincushion: warp UV around centre; r²=0.25 is fixed.
      // a.y = strength, a.z = clipMode (0 = clip out-of-bounds, 1 = wrap)
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      d *= 1.0 + a.y * (r2 - 0.25);
      uv = d + 0.5;
      if (a.z < 0.5 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) {
        discarded = true;
      }
    } else if (kind == OP_PIXELATE) {
      // a.yz = pixUVStep, a.w = clampMode (1 = clamp upper bound for non-tile)
      vec2 step = a.yz;
      uv = (floor(uv / step) + 0.5) * step;
      if (a.w > 0.5) {
        uv = min(uv, 1.0 - step * 0.5);
      }
    } else if (kind == OP_WRAP) {
      // a.yz = cropOff, a.w/b.x = cropSize.x/y, b.y = tileMode (1 = wrap within crop subregion)
      if (b.y > 0.5) {
        vec2 cropOff = a.yz;
        vec2 cropSize = vec2(a.w, b.x);
        uv = cropOff + fract((uv - cropOff) / cropSize) * cropSize;
      } else {
        uv = fract(uv);
      }
    } else if (kind == OP_MODULATE) {
      // UV displacement driven by a modulator texture (always an FBO: y-up texels).
      // a.y = texIdx, a.z = amt, a.w = space (0 uv / 1 tile / 2 screen)
      // b.xy = lookup scale (auto-sizing sub-viewport), b.z = consumer-UV-y-down flag
      vec2 L;
      if (a.w > 1.5) {
        // screen: gl_FragCoord and FBO texels are both y-up — no flip.
        L = gl_FragCoord.xy / u_resolution;
      } else if (a.w > 0.5) {
        // tile: v_local is y-down across the quad; mirror into y-up texels.
        L = vec2(v_local.x, 1.0 - v_local.y);
      } else {
        // uv: the working UV at this slot. Element-source consumers carry y-down
        // UVs — mirror them; FBO-source consumers are already y-up. fract gives
        // tile-wrap semantics (CLAMP_TO_EDGE would smear at crop-tiled edges).
        L = uv;
        if (b.z > 0.5) L.y = 1.0 - L.y;
        L = fract(L);
      }
      L *= b.xy;
      vec4 m = sampleAny(int(a.y), L);
      // Centred displacement: mid-grey = no move (the 0.5 bias is fixed here by
      // design); alpha-weighted so empty FBO regions displace nothing.
      vec2 disp = (m.rg - 0.5) * a.z * m.a;
      // Green > 0.5 samples visually downward for both consumer UV handednesses.
      if (b.z < 0.5) disp.y = -disp.y;
      uv += disp;
    } else if (kind == OP_SAMPLE) {
      color = sampleAny(int(a.y), uv);
    } else if (kind == OP_SMEAR) {
      // a.y = texIdx, a.zw = smear offset, b.x = smear jitter.
      color = smearSample(int(a.y), uv, a.zw, b.x);
    } else if (kind == OP_CONTRAST) {
      // Contrast centred at 0.5.
      color.rgb = (color.rgb - 0.5) * a.y + 0.5;
    } else if (kind == OP_BRIGHTNESS) {
      color.rgb += a.y;
    } else if (kind == OP_COLOR_OKLAB) {
      // a.y = grey, a.z = tintHue, a.w = tintStrength, b.x = hueRot
      float grey = a.y;
      float tintHue = a.z;
      float tintStrength = a.w;
      float hueRot = b.x;
      vec3 lab = linear_rgb_to_oklab(srgb_to_linear(color.rgb));
      if (tintStrength != 0.0) {
        float targetH = tintHue * 6.28318530718;
        vec2 tinted_ab = abs(tintStrength) * 0.125 * vec2(cos(targetH), sin(targetH));
        lab.yz = mix(lab.yz, tinted_ab, tintStrength);
      }
      lab.yz *= (1.0 - grey);
      if (hueRot != 0.0) {
        float angle = hueRot * 6.28318530718;
        float cosA = cos(angle), sinA = sin(angle);
        lab.yz = vec2(cosA * lab.yz.x - sinA * lab.yz.y,
                      sinA * lab.yz.x + cosA * lab.yz.y);
      }
      color.rgb = linear_to_srgb(oklab_to_linear_rgb(lab));
    } else if (kind == OP_ALPHA) {
      color.a *= a.y;
    }
  }

  fragColor = discarded ? vec4(0.0) : color;
}`;
}

// ---------------------------------------------------------------------------
// Blend mode mapping
// ---------------------------------------------------------------------------

// Each entry: [eqRGB, eqAlpha, srcRGB, dstRGB, srcAlpha, dstAlpha]
// Alpha channel uses ONE, ONE_MINUS_SRC_ALPHA (Porter-Duff source-over for alpha)
// so the canvas accumulates opacity correctly and composites cleanly against the page.
// Using blendEquationSeparate + blendFuncSeparate.
// MIN/MAX equations ignore blend factors entirely.
const GL = WebGL2RenderingContext;
const BLEND_MODES: Record<string, [GLenum, GLenum, GLenum, GLenum, GLenum, GLenum]> = {
  'source-over':    [GL.FUNC_ADD,      GL.FUNC_ADD, GL.SRC_ALPHA,  GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  'lighter':        [GL.FUNC_ADD,      GL.FUNC_ADD, GL.SRC_ALPHA,  GL.ONE,                 GL.ONE, GL.ONE],
  'add':            [GL.FUNC_ADD,      GL.FUNC_ADD, GL.SRC_ALPHA,  GL.ONE,                 GL.ONE, GL.ONE],
  'multiply':       [GL.FUNC_ADD,      GL.FUNC_ADD, GL.DST_COLOR,  GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  'screen':         [GL.FUNC_ADD,      GL.FUNC_ADD, GL.ONE,        GL.ONE_MINUS_SRC_COLOR, GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  'destination-out':[GL.FUNC_ADD,      GL.FUNC_ADD, GL.ZERO,       GL.ONE_MINUS_SRC_ALPHA, GL.ZERO, GL.ONE_MINUS_SRC_ALPHA],
  'subtract':       [GL.FUNC_REVERSE_SUBTRACT, GL.FUNC_ADD, GL.SRC_ALPHA, GL.ONE,            GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  'min':            [GL.MIN,           GL.FUNC_ADD, GL.ONE,        GL.ONE,                 GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  'max':            [GL.MAX,           GL.FUNC_ADD, GL.ONE,        GL.ONE,                 GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
};

// ---------------------------------------------------------------------------
// UV computation (CPU-side)
// ---------------------------------------------------------------------------

interface UVRect { uvOffsetX: number; uvSizeX: number; uvOffsetY: number; uvSizeY: number; }

/**
 * Compute the UV rect for a tile, given source pixel dimensions and cell pixel dimensions.
 * Returns signed sizes — negative means flip that axis.
 * Supports 'cover' and 'fill'. Other fit modes fall back to 'cover'.
 */
function computeUV(p: TileParams, srcW: number, srcH: number, cellW: number, cellH: number): UVRect {
  const absCropw = Math.abs(p.cropw);
  const absCroph = Math.abs(p.croph);

  // Clamp to 1 source pixel minimum (cropw=0 samples a single pixel colour)
  const vsw = Math.max(1, absCropw * srcW);
  const vsh = Math.max(1, absCroph * srcH);

  // Crop window origin in normalised source coords
  const cropLeft = p.cropx - absCropw / 2;
  const cropTop  = p.cropy - absCroph / 2;

  let fitW: number;
  let fitH: number;

  if (p.fit === 'tile' || p.fit === 'tilecenter' || p.fit === 'none') {
    // Native resolution, repeating — UV size = cell size / source size;
    // fract() in the shader handles GL_REPEAT-style tiling for UVs outside [0,1].
    // tile: crop origin (cropLeft,cropTop) anchored to cell top-left
    // tilecenter / none: cropx,cropy centred on cell centre
    fitW = cellW / srcW;
    fitH = cellH / srcH;
    const isTile = p.fit === 'tile';
    const left = isTile ? cropLeft       : p.cropx - fitW / 2;
    const top  = isTile ? cropTop        : p.cropy - fitH / 2;
    const uvOffsetX = p.cropw >= 0 ? left        : left + fitW;
    const uvSizeX   = p.cropw >= 0 ? fitW        : -fitW;
    const uvOffsetY = p.croph >= 0 ? top         : top + fitH;
    const uvSizeY   = p.croph >= 0 ? fitH        : -fitH;
    return { uvOffsetX, uvSizeX, uvOffsetY, uvSizeY };
  }

  if (p.fit === 'fill') {
    fitW = absCropw;
    fitH = absCroph;
  } else {
    // cover: scale virtual source to fill cell, centred crop
    if (cellW / vsw >= cellH / vsh) {
      // width-limited: show full crop width, crop height
      fitW = absCropw;
      fitH = absCropw * (cellH * srcW) / (cellW * srcH);
    } else {
      // height-limited: show full crop height, crop width
      fitH = absCroph;
      fitW = absCroph * (cellW * srcH) / (cellH * srcW);
    }
  }

  // Centre the sampled region within the crop window
  const fitLeft = cropLeft + (absCropw - fitW) / 2;
  const fitTop  = cropTop  + (absCroph - fitH) / 2;

  // Negative cropw/h = flip. Set origin to far edge, size negative → UV scans backwards.
  // Values stay within or near [0,1] so fract() is a no-op unless also tiling.
  const uvOffsetX = p.cropw >= 0 ? fitLeft : fitLeft + fitW;
  const uvSizeX   = p.cropw >= 0 ? fitW    : -fitW;
  const uvOffsetY = p.croph >= 0 ? fitTop  : fitTop + fitH;
  const uvSizeY   = p.croph >= 0 ? fitH    : -fitH;

  return { uvOffsetX, uvSizeX, uvOffsetY, uvSizeY };
}

// ---------------------------------------------------------------------------
// Transform matrix (CPU-side, column-major for WebGL)
// ---------------------------------------------------------------------------

const IDENTITY = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

/**
 * Build a 4×4 column-major transform matrix that applies rotation and scale
 * around the cell centre in clip space.
 *
 * The current params encode rotations as pre-computed cosine scales
 * (rotateXScale = cos(rotateX * TAU), applied to the Y axis; vice versa).
 * scaleX / scaleY are applied on top of those.
 */
function buildTransform(p: TileParams): Float32Array {
  const hasRotation = p.rotateZ !== 0 || p.rotateXScale !== 1 || p.rotateYScale !== 1;
  const hasScale    = p.scaleX !== 1 || p.scaleY !== 1;
  if (!hasRotation && !hasScale) return IDENTITY;

  const TAU = Math.PI * 2;
  const θ = p.rotateZ * TAU;
  const cosZ = Math.cos(θ);
  const sinZ = Math.sin(θ);

  // Combined scale per axis
  const Sx = p.rotateYScale * p.scaleX;
  const Sy = p.rotateXScale * p.scaleY;

  // Cell centre in clip space (canvas 0..1 → clip -1..1, Y flipped)
  const cx =  2 * p.x - 1;
  const cy = -(2 * p.y - 1);

  // T(cx,cy) * S(Sx,Sy) * R(θ) * T(-cx,-cy)
  const a  =  cosZ * Sx;
  const b  = -sinZ * Sy;
  const c  =  sinZ * Sx;
  const d  =  cosZ * Sy;
  const tx = cx - a * cx - b * cy;
  const ty = cy - c * cx - d * cy;

  // Column-major: [col0, col1, col2, col3]
  return new Float32Array([
    a,  c,  0, 0,   // col 0
    b,  d,  0, 0,   // col 1
    0,  0,  1, 0,   // col 2
    tx, ty, 0, 1,   // col 3
  ]);
}

// ---------------------------------------------------------------------------
// Source natural dimensions
// ---------------------------------------------------------------------------

type MediaTileSource = Exclude<TileSource, { kind: 'pattern' }>;

function srcSize(source: MediaTileSource): [number, number] {
  if (source.kind === 'color') return [1, 1];
  if (source.kind === 'text') return [source.canvas.width, source.canvas.height];
  if (source.kind === 'image') return [source.el.naturalWidth, source.el.naturalHeight];
  return [source.el.videoWidth, source.el.videoHeight];
}

// ---------------------------------------------------------------------------
// DrawCommand — intermediate representation accumulated per frame
// ---------------------------------------------------------------------------

interface DrawCommand {
  texture: WebGLTexture;
  blend:   string;
  destOffsetX: number;
  destOffsetY: number;
  destSizeX:   number;
  destSizeY:   number;
  uvOffsetX:   number;
  uvOffsetY:   number;
  uvSizeX:     number;
  uvSizeY:     number;
  // Effect parameters (consumed by the effect-compiler when packing the batch).
  alpha:       number;
  grey:        number;
  pixUVStepX:  number;
  pixUVStepY:  number;
  hueRot:      number;
  contrast:     number;
  brightness:   number;
  tintHue:      number;
  tintStrength: number;
  barrel:       number;
  cropOffX:     number;
  cropOffY:     number;
  cropSizeX:    number;
  cropSizeY:    number;
  tileMode:     number; // 1 = tile/tilecenter (wrap via fract), 0 = clip out-of-bounds
  // Modulate: second sampled texture (an FBO tex) + op args. null = no modulate.
  modTexture:   WebGLTexture | null;
  modAmt:       number;
  modSpace:     number; // 0 uv / 1 tile / 2 screen
  modUVScaleX:  number;
  modUVScaleY:  number;
  modYDown:     number; // 1 = element-source consumer (y-down UVs), 0 = FBO-source
  // Smear (source UV units, converted from screen pixels in drawTile).
  smearOffX:    number;
  smearOffY:    number;
  smearJitter:  number;
  transform:    Float32Array; // 16 floats, column-major
}

// ---------------------------------------------------------------------------
// WebGLRenderer
// ---------------------------------------------------------------------------

/**
 * WebGL2 rendering backend.
 *
 * Tiles are accumulated into a DrawCommand list each frame, then flushed in
 * batches via drawArraysInstanced. A batch breaks when the blend mode changes,
 * a 17th unique source texture would be needed, or the per-tile ops would
 * overflow the UBO (rare in practice — tiles with identical effect chains
 * dedupe to a shared UBO slot, so e.g. cropStack(25,25) still fits one batch).
 *
 * The fragment shader is a small VM: each tile carries (effectStart,
 * effectCount) instance attributes pointing into a UBO of packed ops. The
 * shader loops over its tile's chain, dispatching on op-code. This makes the
 * effect pipeline extensible (adding a new effect = one new shader branch +
 * one new op-emitter in effect-compiler.ts) without per-instance attribute
 * changes.
 */
// `back` is the ping-pong partner, allocated only for self-referencing FBOs.
// While such an FBO renders, `back` is bound as the write target and `tex`
// (the front) holds the previous frame for self-reads; endOffscreen() swaps them.
// `touched` marks per-frame liveness for auto-modulator FBOs: set when the FBO
// is rendered or resolved as a modulator, cleared by sweepAutoFBOs().
// `viewW`/`viewH` are the rendered sub-viewport dims (≤ w/h); modulate lookups
// scale by view/tex. Full-size for everything but auto-modulator passes.
interface FBOEntry {
  fbo: WebGLFramebuffer; tex: WebGLTexture;
  w: number; h: number;
  viewW: number; viewH: number;
  back?: FBOEntry;
  touched?: boolean;
  /** Consecutive frames the requested ladder size was below the allocated one. */
  shrinkFrames?: number;
}

// Recycled auto-FBO entries kept beyond this count are deleted for real.
const FBO_POOL_CAP = 4;

// Shrink an auto FBO's ladder allocation only after this many consecutive
// frames below half use — no realloc churn under size(sine).
const FBO_SHRINK_FRAMES = 30;

export class WebGLRenderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  // GL resources are recreated on context restore (see restoreContext), so they
  // aren't readonly — definite-assignment via initGLResources() in the constructor.
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private instanceVBO!: WebGLBuffer;
  private opsUBO!: WebGLBuffer;
  private readonly texCache: TextureCache;
  private readonly maxTexUnits: number;
  private readonly fbos = new Map<string, FBOEntry>();
  /** Recycled auto-modulator FBO entries. Re-eval renumbers auto FBOs (name
   *  churn); popping a same-size entry here makes that a Map move instead of a
   *  multi-MB texImage2D realloc — no eval-time hitch. */
  private readonly fboFreePool: FBOEntry[] = [];

  private instanceData = new Float32Array(256 * INSTANCE_FLOATS);
  // Per-batch ops buffer. UBO_VEC4_CAPACITY vec4 slots × 4 floats = the upload size.
  private readonly opsBuffer = new Float32Array(UBO_VEC4_CAPACITY * 4);
  // Scratch buffer for compileInto so we don't allocate per-tile.
  private readonly opsScratch = new Float32Array(MAX_OPS * OP_FLOATS);
  /** u_resolution location; re-queried on context restore. */
  private uResolutionLoc: WebGLUniformLocation | null = null;

  private readonly pendingDraws: DrawCommand[] = [];
  /** The currently bound offscreen FBO (null = default canvas framebuffer). */
  private currentFBO: WebGLFramebuffer | null = null;
  /** Name of the offscreen pass in progress, and whether it ping-pongs. Used by endOffscreen() to swap. */
  private offscreenName: string | null = null;
  private offscreenDoubleBuffered = false;
  /** Viewport dims of the currently bound target (canvas or FBO sub-viewport). */
  private currentViewW = 0;
  private currentViewH = 0;
  /** Saved targets for NESTED offscreen passes — a `.render()` bake chain runs
   *  inside a named layer's pass, so endOffscreen must restore the enclosing
   *  target, not hard-reset to the canvas. */
  private readonly targetStack: Array<{
    fbo: WebGLFramebuffer | null; viewW: number; viewH: number;
    name: string | null; doubleBuffered: boolean;
  }> = [];

  private w = 0;
  private h = 0;

  /** How many times the GPU has dropped our context this session (Windows TDR / OOM). */
  private contextLossCount = 0;
  /** Frames drawn since construction. Stamped on every GPU diagnostic line: dying on
   *  frame 3 (bad shader/resource configuration — fails immediately and every time)
   *  and dying on frame 40000 (gradual resource exhaustion) look identical in the
   *  console otherwise, and they need completely different investigations. */
  private framesRendered = 0;
  /** GPU vendor/renderer string, captured at startup for loss diagnostics. */
  private gpuInfo = '(unknown)';
  /** Invoked when the context is lost too many times, or can't be restored. */
  private readonly onUnrecoverable?: () => void;
  /** Set by dispose(). Suppresses the loss/restore handlers for a deliberate teardown. */
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: { onUnrecoverable?: () => void } = {}) {
    this.onUnrecoverable = opts.onUnrecoverable;
    // `?pdpreserve` keeps the drawing buffer so an offscreen capture harness can
    // read the live frame directly (no extra render that would double-advance
    // feedback FBOs). Off by default — preserveDrawingBuffer costs perf.
    const preserve = typeof location !== 'undefined' &&
      new URLSearchParams(location.search).has('pdpreserve');
    // The browser explains *why* creation failed via 'webglcontextcreationerror',
    // but only to a listener attached before getContext. Without this all we ever
    // learn is "returned null", which is the same symptom for a dozen causes.
    let creationStatus = '';
    const onCreationError = (e: Event) => {
      creationStatus = (e as WebGLContextEvent).statusMessage || '';
    };
    canvas.addEventListener('webglcontextcreationerror', onCreationError);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: preserve });
    canvas.removeEventListener('webglcontextcreationerror', onCreationError);
    if (!gl) {
      // Probe WebGL1 on a *fresh* canvas — a canvas that's already been asked for
      // one context type won't hand out another, so reusing `canvas` here would
      // always report "no WebGL1" and slander a healthy GPU.
      const hasWebGL1 = !!document.createElement('canvas').getContext('webgl');
      console.error(`[picodevil] Fatal: ${describeContextCreationFailure(creationStatus, hasWebGL1)}`);
      throw new WebGL2UnavailableError();
    }
    this.gl = gl;

    // Capture the GPU identity once, up front — it's the single most useful datum
    // for diagnosing a later context loss (which vendor/driver reset).
    this.gpuInfo = queryGpuInfo(gl);
    if (!gpuInfoLogged) {
      console.log(
        `[picodevil] WebGL2 ready on frame ${this.framesRendered} — GPU: ${this.gpuInfo}`,
      );
      gpuInfoLogged = true;
    }

    // Query the device limit before compiling the shader so we don't declare
    // more samplers than the hardware supports (causes a link error on some GPUs).
    this.maxTexUnits = Math.min(MAX_TEX_UNITS, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number);
    this.texCache    = new TextureCache(gl);
    this.initGLResources();

    // Handle context loss + restore. On a real loss (mobile tab-switch, GPU reset,
    // memory pressure) every GL handle dies; preventDefault on the lost event lets
    // the browser fire 'restored', where we rebuild the program/buffers/VAO/UBO and
    // drop the now-dead FBO + texture caches so they re-create lazily. Without this
    // the canvas stays black until a full page reload.
    // dispose() releases the context on purpose (via WEBGL_lose_context), which
    // fires the same events — that's a teardown, not a GPU fault, so both handlers
    // no-op once disposed: no user-facing warning, and no rebuilding GL resources
    // for a renderer nobody holds any more.
    canvas.addEventListener('webglcontextlost', (e) => {
      if (this.disposed) return;
      // preventDefault is what lets the browser fire 'restored'.
      e.preventDefault();
      this.contextLossCount++;
      const statusMessage = (e as WebGLContextEvent).statusMessage || '(none)';
      console.error(
        `[picodevil] WebGL context lost (#${this.contextLossCount}) on frame ` +
        `${this.framesRendered} — statusMessage: "${statusMessage}". ` +
        `GPU: ${this.gpuInfo}. Attempting to recover…`,
      );
      warn('Graphics context lost — attempting to recover. If the screen stays black, reload the page.');
      if (this.contextLossCount >= MAX_CONTEXT_LOSSES) {
        console.error(
          `[picodevil] context lost ${this.contextLossCount}× this session ` +
          `(latest on frame ${this.framesRendered}) — giving up on automatic recovery.`,
        );
        this.onUnrecoverable?.();
      }
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.disposed) return;
      try {
        this.restoreContext();
        console.log(
          `[picodevil] WebGL context restored on frame ${this.framesRendered} — ` +
          `recovered (after loss #${this.contextLossCount}).`,
        );
      } catch (err) {
        console.error(
          `[picodevil] WebGL context restore FAILED on frame ${this.framesRendered}`, err,
        );
        this.onUnrecoverable?.();
      }
    });
  }

  /**
   * Create (or recreate) all GL resources that die with the context: the program,
   * instance VBO, VAO, and the Effects UBO, plus the one-time sampler-unit bindings.
   * Called from the constructor and again on context restore.
   */
  private initGLResources(): void {
    const { gl } = this;
    this.program     = createProgram(gl, VERT_SRC, buildFragSrc(this.maxTexUnits));
    this.instanceVBO = gl.createBuffer()!;
    this.opsUBO      = gl.createBuffer()!;
    this.vao         = createVAO(gl, this.instanceVBO);

    // Bind texture units 0..N-1 to u_tex[0..N-1] once at init
    gl.useProgram(this.program);
    for (let i = 0; i < this.maxTexUnits; i++) {
      const loc = gl.getUniformLocation(this.program, `u_tex[${i}]`);
      if (loc) gl.uniform1i(loc, i);
    }
    // Per-pass resolution for screen-space modulate lookups. Re-established here
    // so a context restore (the classically forgotten site) gets it too.
    this.uResolutionLoc = gl.getUniformLocation(this.program, 'u_resolution');
    this.setResolution(this.w, this.h);

    // Set up the Effects UBO: allocate, bind to point 0, link program block to point 0.
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.opsUBO);
    gl.bufferData(gl.UNIFORM_BUFFER, UBO_VEC4_CAPACITY * 16, gl.DYNAMIC_DRAW);
    const blockIdx = gl.getUniformBlockIndex(this.program, 'Effects');
    gl.uniformBlockBinding(this.program, blockIdx, 0);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.opsUBO);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }

  /** Rebuild everything after the WebGL2 context is restored. */
  private restoreContext(): void {
    // Program/buffers/VAO/UBO are dead — recreate them.
    this.initGLResources();
    // FBO handles are dead too; drop the map so getOrCreateFBO rebuilds them at the
    // current size on next use. (No deleteFramebuffer — the old context is gone.)
    this.fbos.clear();
    this.fboFreePool.length = 0;
    this.currentFBO = null;
    this.currentViewW = this.w;
    this.currentViewH = this.h;
    this.targetStack.length = 0;
    this.offscreenName = null;
    // Drop cached textures so the next frame re-uploads onto fresh handles. Use
    // forget() not clear(): the old textures died with the lost context, and
    // deleting them on the restored context throws INVALID_OPERATION.
    this.texCache.forget();
    // Reapply the viewport for the restored context.
    if (this.w && this.h) this.gl.viewport(0, 0, this.w, this.h);
  }

  /** True while the GPU context is lost (between 'lost' and 'restored'). The render
   *  loop skips frames while this holds — GL calls on a dead context error out and
   *  can starve the browser's chance to restore it. */
  isContextLost(): boolean {
    return this.gl.isContextLost();
  }

  /** Canvas pixel dims — the frame renderer plans auto-modulator sizing from these. */
  getViewportSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  /** Set u_resolution to the active render target's viewport dims. Must track
   *  every target switch — screen-space modulate lookups divide by it. */
  private setResolution(w: number, h: number): void {
    const { gl } = this;
    gl.useProgram(this.program);
    gl.uniform2f(this.uResolutionLoc, Math.max(1, w), Math.max(1, h));
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    if (this.currentFBO === null) { this.currentViewW = w; this.currentViewH = h; }
    this.gl.viewport(0, 0, w, h);
    this.setResolution(w, h);
    // Resize existing FBOs to match new canvas dimensions
    const { gl } = this;
    const resizeEntry = (entry: FBOEntry) => {
      entry.w = w; entry.h = h;
      entry.viewW = w; entry.viewH = h;
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    };
    for (const [name, entry] of this.fbos) {
      // Auto FBOs (modulators on a size ladder, render bakes at canvas size)
      // are stateless — their old textures are meaningless after a resize.
      // Drop them and let the next frame's pass recreate them at the new size.
      if (name.startsWith(AUTO_PREFIX)) {
        this.fbos.delete(name);
        this.deleteFBOEntry(entry);
        continue;
      }
      resizeEntry(entry);
      if (entry.back) resizeEntry(entry.back);
    }
    // Pooled auto-FBO entries are now the wrong size — drop them rather than
    // resizing textures nothing references.
    for (const entry of this.fboFreePool) this.deleteFBOEntry(entry);
    this.fboFreePool.length = 0;
  }

  beginFrame(): void {
    const { gl } = this;
    this.framesRendered++;
    this.pendingDraws.length = 0;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    this.setBlend('source-over');
  }

  /** Clear the currently bound target to transparent. Used to prime a bake FBO
   *  before rendering into it. Unlike beginFrame it doesn't reset frame state. */
  clearTarget(): void {
    const { gl } = this;
    this.flushPending();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  drawTile(p: TileParams): void {
    let tex: WebGLTexture | null;
    let srcW: number, srcH: number;
    let fboSource = false;

    // For a sub-viewport FBO source (a footprint-sized `.render()` bake), the
    // rendered content occupies only [0,viewW]×[0,viewH] of the texture's
    // bottom-left. Scale the sampled UV by view/tex so we read that region.
    let fboUVScaleX = 1, fboUVScaleY = 1;
    if (p.source.kind === 'pattern') {
      const entry = this.fbos.get(p.source.name);
      if (!entry) return;
      // Sampling the FBO that is currently bound as the render target is a
      // GL feedback loop (undefined behaviour — typically zeroes the whole
      // batch, blacking out the frame). Skip the tile and warn. This catches
      // any self-reference, e.g. `Hquack: s("quack")` where the token resolves
      // back to the layer's own FBO. Deduped by message in warn().
      if (entry.fbo === this.currentFBO) {
        warn(`s("${p.source.name}") references the framebuffer it is being rendered into — skipped to avoid a feedback loop. Use s("prev") for previous-frame feedback, or rename the layer.`);
        return;
      }
      tex = entry.tex;
      srcW = this.w; srcH = this.h;
      fboSource = true;
      entry.touched = true; // liveness (also keeps a sampled render bake alive)
      fboUVScaleX = entry.viewW / entry.w;
      fboUVScaleY = entry.viewH / entry.h;
    } else {
      tex = this.texCache.get(p.source);
      if (!tex) return;
      [srcW, srcH] = srcSize(p.source);
    }

    const cellW = p.w * this.w;
    const cellH = p.h * this.h;

    // Modulator resolution. A miss is impossible by construction (the auto FBO
    // registers and renders before its consumer in the same frame), as is the
    // modulator being the current render target (auto FBOs are never consumers'
    // targets) — both are internal bugs: warn + draw unmodulated, never drop
    // the tile. Deduped by message in warn().
    let modTexture: WebGLTexture | null = null;
    let modUVScaleX = 1, modUVScaleY = 1;
    if (p.modSrc !== undefined) {
      const modEntry = this.fbos.get(p.modSrc);
      if (!modEntry) {
        warn(`internal: modulator FBO "${p.modSrc}" missing at draw time — tile drawn unmodulated`);
      } else if (modEntry.fbo === this.currentFBO) {
        warn(`internal: modulator FBO "${p.modSrc}" is the current render target — tile drawn unmodulated`);
      } else {
        modTexture = modEntry.tex;
        modEntry.touched = true; // liveness for the auto-FBO sweep
        modUVScaleX = modEntry.viewW / modEntry.w;
        modUVScaleY = modEntry.viewH / modEntry.h;
      }
    }
    const modAmt    = p.modAmt ?? 0.1;
    const modSpace  = p.modSpace === 'screen' ? 2 : p.modSpace === 'tile' ? 1 : 0;
    const modYDown  = fboSource ? 0 : 1;

    // Smear: convert the screen-pixel radius to a source-UV per-tap offset. The
    // px→UV scale differs per fit branch (below), so this closure takes it as an
    // argument. The angle is in turns (0 = horizontal, .25 = vertical). Same
    // convention as `pixelate` (screen pixels, texture space).
    const smear = p.smear ?? 0;
    const smearAng = (smear > 0 ? (p.smearAngle ?? 0) : 0) * 2 * Math.PI;
    const smearCos = Math.cos(smearAng), smearSin = Math.sin(smearAng);
    const smearFields = (uvPerPxX: number, uvPerPxY: number) => ({
      smearOffX:   smear > 0 ? smear * smearCos * uvPerPxX : 0,
      smearOffY:   smear > 0 ? smear * smearSin * uvPerPxY : 0,
      smearJitter: p.smearJitter ?? 0.1,
    });

    // contain / none: shrink dest rect to the display area, UV covers the crop window.
    // The area outside the dest rect is simply not drawn → transparent letterbox.
    if (p.fit === 'contain' || p.fit === 'none') {
      // Colors have no natural pixel size — treat the cell as the source so they fill it.
      if (p.source.kind === 'color') { srcW = cellW; srcH = cellH; }
      const absCropw = Math.abs(p.cropw);
      const absCroph = Math.abs(p.croph);
      const vsw = Math.max(1, absCropw * srcW);
      const vsh = Math.max(1, absCroph * srcH);
      const scale = p.fit === 'contain' ? Math.min(cellW / vsw, cellH / vsh) : 1;
      const dispW = vsw * scale;
      const dispH = vsh * scale;
      const cropLeft = p.cropx - absCropw / 2;
      const cropTop  = p.cropy - absCroph / 2;
      let uvOffX = p.cropw >= 0 ? cropLeft          : cropLeft + absCropw;
      let uvSzX  = p.cropw >= 0 ? absCropw          : -absCropw;
      let uvOffY = p.croph >= 0 ? cropTop           : cropTop + absCroph;
      let uvSzY  = p.croph >= 0 ? absCroph          : -absCroph;
      if (fboSource) {
        uvOffY = 1 - uvOffY; uvSzY = -uvSzY;
        uvOffX *= fboUVScaleX; uvSzX *= fboUVScaleX;
        uvOffY *= fboUVScaleY; uvSzY *= fboUVScaleY;
      }
      this.pendingDraws.push({
        texture: tex, blend: p.blend ?? 'source-over',
        destOffsetX: p.x, destOffsetY: p.y,
        destSizeX: dispW / this.w, destSizeY: dispH / this.h,
        uvOffsetX: uvOffX, uvOffsetY: uvOffY,
        uvSizeX: uvSzX, uvSizeY: uvSzY,
        alpha:        p.alpha,
        grey:         p.grey ?? 0,
        pixUVStepX:   p.pixelate > 0 ? p.pixelate * absCropw / dispW : 0,
        pixUVStepY:   p.pixelate > 0 ? p.pixelate * absCroph / dispH : 0,
        hueRot:       p.huerot ?? 0,
        contrast:     p.contrast ?? 1,
        brightness:   p.brightness ?? 0,
        tintHue:      p.tintHue      ?? 0,
        tintStrength: p.tintStrength ?? 0,
        barrel:       p.barrel       ?? 0,
        cropOffX: 0, cropOffY: 0, cropSizeX: 1, cropSizeY: 1,
        tileMode:     0,
        modTexture, modAmt, modSpace,
        modUVScaleX, modUVScaleY, modYDown,
        ...smearFields(absCropw / dispW, absCroph / dispH),
        transform:    buildTransform(p),
      });
      return;
    }

    let { uvOffsetX, uvSizeX, uvOffsetY, uvSizeY } = computeUV(p, srcW, srcH, cellW, cellH);

    // FBO textures are Y-flipped relative to HTML element textures.
    // WebGL renders with Y=0 at bottom, so the visual top of the FBO is at UV y=1.
    // Mirror V across 0.5 so the image appears right-side up. Must be a true
    // mirror (1 - V), not a within-window flip (uvOffsetY + uvSizeY) — the latter
    // is only correct for a full-frame / V=0.5-centred window and samples the
    // wrong half for off-centre crops (e.g. cropStack tiles).
    if (fboSource) {
      uvOffsetY = 1 - uvOffsetY; uvSizeY = -uvSizeY;
      // Restrict to the rendered sub-viewport region (footprint-sized bakes).
      uvOffsetX *= fboUVScaleX; uvSizeX *= fboUVScaleX;
      uvOffsetY *= fboUVScaleY; uvSizeY *= fboUVScaleY;
    }

    const isTile = p.fit === 'tile' || p.fit === 'tilecenter';
    const tileAw = Math.abs(p.cropw), tileAh = Math.abs(p.croph);
    const cropOffX  = isTile ? p.cropx - tileAw / 2 : 0;
    let cropOffY    = isTile ? p.cropy - tileAh / 2 : 0;
    const cropSizeX = isTile ? Math.max(1e-6, tileAw) : 1;
    const cropSizeY = isTile ? Math.max(1e-6, tileAh) : 1;
    // The OP_WRAP repeat subregion (cropOffY..cropOffY+cropSizeY) must live in the
    // same V space as the sampled uv — which was mirrored above for FBO sources.
    // Mirror the window too (no-op for the default full [0,1] window).
    if (fboSource && isTile) cropOffY = 1 - cropOffY - cropSizeY;

    this.pendingDraws.push({
      texture:     tex,
      blend:       p.blend ?? 'source-over',
      destOffsetX: p.x,
      destOffsetY: p.y,
      destSizeX:   p.w,
      destSizeY:   p.h,
      uvOffsetX,
      uvOffsetY,
      uvSizeX,
      uvSizeY,
      alpha:       p.alpha,
      grey:        p.grey ?? 0,
      pixUVStepX:  p.pixelate > 0 ? p.pixelate * Math.abs(uvSizeX) / cellW : 0,
      pixUVStepY:  p.pixelate > 0 ? p.pixelate * Math.abs(uvSizeY) / cellH : 0,
      hueRot:      p.huerot ?? 0,
      contrast:     p.contrast ?? 1,
      brightness:   p.brightness ?? 0,
      tintHue:      p.tintHue      ?? 0,
      tintStrength: p.tintStrength ?? 0,
      barrel:       p.barrel       ?? 0,
      cropOffX, cropOffY, cropSizeX, cropSizeY,
      tileMode:     (p.fit === 'tile' || p.fit === 'tilecenter') ? 1 : 0,
      modTexture, modAmt, modSpace,
      modUVScaleX, modUVScaleY, modYDown,
      ...smearFields(Math.abs(uvSizeX) / cellW, Math.abs(uvSizeY) / cellH),
      transform:    buildTransform(p),
    });
  }

  endFrame(): void {
    this.flushPending();
  }

  private flushPending(): void {
    const { gl } = this;
    const draws = this.pendingDraws;
    if (draws.length === 0) return;

    // Compile-and-dedup state lives per batch. We compile each draw's effects
    // into a packed ops chain, key it by exact float-buffer content, and reuse
    // the same UBO offset for tiles with identical chains. cropStack(25, 25)
    // collapses to one shared chain → 625 instances point to the same offset.
    let batchStart = 0;
    let texUnits   = new Map<WebGLTexture, number>();
    let blendMode  = draws[0].blend;
    let opsLen    = 0;          // current vec4 offset into opsBuffer
    let opsDedup  = new Map<string, { offset: number; count: number }>();
    // Per-instance effect pointers, accumulated for the current batch.
    const effectStart  = new Int32Array(draws.length);
    const effectCount  = new Int32Array(draws.length);

    const flush = (end: number) => {
      if (end <= batchStart) return;
      const count = end - batchStart;

      // Bind each texture to its assigned unit
      for (const [tex, unit] of texUnits) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
      }

      // Upload ops UBO for this batch (only the used range).
      if (opsLen > 0) {
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.opsUBO);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.opsBuffer.subarray(0, opsLen * 4));
        gl.bindBuffer(gl.UNIFORM_BUFFER, null);
      }

      // Grow instance buffer if needed
      const floatsNeeded = count * INSTANCE_FLOATS;
      if (this.instanceData.length < floatsNeeded) {
        this.instanceData = new Float32Array(floatsNeeded * 2);
      }

      // Pack instance data
      const d = this.instanceData;
      for (let k = 0; k < count; k++) {
        const cmd = draws[batchStart + k];
        const base = k * INSTANCE_FLOATS;
        d[base + 0]  = cmd.destOffsetX;
        d[base + 1]  = cmd.destOffsetY;
        d[base + 2]  = cmd.destSizeX;
        d[base + 3]  = cmd.destSizeY;
        d[base + 4]  = cmd.uvOffsetX;
        d[base + 5]  = cmd.uvOffsetY;
        d[base + 6]  = cmd.uvSizeX;
        d[base + 7]  = cmd.uvSizeY;
        d.set(cmd.transform, base + 8);
        d[base + 24] = effectStart[batchStart + k];
        d[base + 25] = effectCount[batchStart + k];
      }

      this.setBlend(blendMode);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, floatsNeeded), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.bindVertexArray(null);

      // Unbind all textures used in this batch so they are never bound when their
      // FBO is later used as a render target (prevents feedback loop errors).
      for (const [, unit] of texUnits) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    };

    /** Compile cmd's effects with the supplied texIdx/modTexIdx, dedup against
     *  this batch's ops buffer, and write the result's (offset, count) into the
     *  per-instance arrays. Returns false if ops would overflow the UBO. */
    const tryCompileForBatch = (i: number, cmd: DrawCommand, texIdx: number, modTexIdx: number): boolean => {
      // Compile into scratch with the batch-local texIdx.
      const opCount = compileInto({
        texIndex:     texIdx,
        alpha:        cmd.alpha,
        grey:         cmd.grey,
        hueRot:       cmd.hueRot,
        pixUVStepX:   cmd.pixUVStepX,
        pixUVStepY:   cmd.pixUVStepY,
        contrast:     cmd.contrast,
        brightness:   cmd.brightness,
        tintHue:      cmd.tintHue,
        tintStrength: cmd.tintStrength,
        barrel:       cmd.barrel,
        cropOffX:     cmd.cropOffX,
        cropOffY:     cmd.cropOffY,
        cropSizeX:    cmd.cropSizeX,
        cropSizeY:    cmd.cropSizeY,
        tileMode:     cmd.tileMode,
        modTexIndex:  modTexIdx,
        modAmt:       cmd.modAmt,
        modSpace:     cmd.modSpace,
        modUVScaleX:  cmd.modUVScaleX,
        modUVScaleY:  cmd.modUVScaleY,
        modYDown:     cmd.modYDown,
        smearOffX:    cmd.smearOffX,
        smearOffY:    cmd.smearOffY,
        smearJitter:  cmd.smearJitter,
      }, this.opsScratch, 0);

      // Build dedup key. Float-array join is allocation-y but cheap enough for
      // realistic tile counts; can be replaced with a numeric hash later.
      const len = opCount * OP_FLOATS;
      let key = '';
      for (let j = 0; j < len; j++) key += this.opsScratch[j] + ',';

      const existing = opsDedup.get(key);
      if (existing) {
        effectStart[i] = existing.offset;
        effectCount[i] = existing.count;
        return true;
      }

      // Each op uses 2 vec4 slots. Will it fit?
      const vec4sNeeded = opCount * 2;
      if (opsLen + vec4sNeeded > UBO_VEC4_CAPACITY) return false;

      // Append to ops buffer (each op = 8 floats = 2 vec4s).
      this.opsBuffer.set(this.opsScratch.subarray(0, len), opsLen * 4);
      const offset = opsLen;
      opsLen += vec4sNeeded;
      opsDedup.set(key, { offset, count: opCount });
      effectStart[i] = offset;
      effectCount[i] = opCount;
      return true;
    };

    for (let i = 0; i < draws.length; i++) {
      const cmd = draws[i];
      const blendChange  = cmd.blend !== blendMode;
      // A modulated tile needs TWO units (source + modulator) — count how many
      // of them are new to this batch before deciding whether they still fit.
      const newUnits =
        (texUnits.has(cmd.texture) ? 0 : 1) +
        (cmd.modTexture && cmd.modTexture !== cmd.texture && !texUnits.has(cmd.modTexture) ? 1 : 0);
      const needsNewUnit = texUnits.size + newUnits > this.maxTexUnits;

      if (blendChange || needsNewUnit) {
        flush(i);
        batchStart = i;
        texUnits   = new Map();
        blendMode  = cmd.blend;
        opsLen     = 0;
        opsDedup   = new Map();
      }

      if (!texUnits.has(cmd.texture)) {
        texUnits.set(cmd.texture, texUnits.size);
      }
      if (cmd.modTexture && !texUnits.has(cmd.modTexture)) {
        texUnits.set(cmd.modTexture, texUnits.size);
      }
      const texIdx = texUnits.get(cmd.texture)!;
      const modTexIdx = cmd.modTexture ? texUnits.get(cmd.modTexture)! : -1;

      // Try to compile this command's ops into the current batch's UBO.
      // If it overflows, flush the batch and retry with a fresh ops buffer.
      if (!tryCompileForBatch(i, cmd, texIdx, modTexIdx)) {
        flush(i);
        batchStart = i;
        texUnits   = new Map();
        blendMode  = cmd.blend;
        opsLen     = 0;
        opsDedup   = new Map();
        // Seed the fresh batch with BOTH of this tile's textures.
        texUnits.set(cmd.texture, 0);
        if (cmd.modTexture && !texUnits.has(cmd.modTexture)) {
          texUnits.set(cmd.modTexture, texUnits.size);
        }
        const retryTexIdx = texUnits.get(cmd.texture)!;
        const retryModTexIdx = cmd.modTexture ? texUnits.get(cmd.modTexture)! : -1;
        // Should always succeed on retry — a single tile can produce at most
        // MAX_OPS ops = 2·MAX_OPS vec4s, far under UBO_VEC4_CAPACITY=1024.
        tryCompileForBatch(i, cmd, retryTexIdx, retryModTexIdx);
      }
    }

    flush(draws.length);
    draws.length = 0;
  }

  beginOffscreen(name: string, doubleBuffer = false, reqW?: number, reqH?: number): void {
    const { gl } = this;
    this.flushPending(); // commit any pending draws to the current framebuffer before switching

    // Save the enclosing target so endOffscreen restores it (nesting: a bake
    // chain inside a named layer's pass).
    this.targetStack.push({
      fbo: this.currentFBO, viewW: this.currentViewW, viewH: this.currentViewH,
      name: this.offscreenName, doubleBuffered: this.offscreenDoubleBuffered,
    });

    // Reduced-resolution auto-modulator pass: allocate the texture on the
    // quantised ladder, render into a sub-viewport of it. Fill cost scales
    // with viewport, not texture size, so the ladder avoids realloc churn.
    let entry: FBOEntry;
    if (reqW !== undefined && reqH !== undefined) {
      const canvasW = this.w || 1, canvasH = this.h || 1;
      const viewW = Math.max(1, Math.min(Math.round(reqW), canvasW));
      const viewH = Math.max(1, Math.min(Math.round(reqH), canvasH));
      const wantW = ladderStep(viewW, canvasW);
      const wantH = ladderStep(viewH, canvasH);
      entry = this.getOrCreateFBO(name, wantW, wantH);
      if (wantW > entry.w || wantH > entry.h) {
        // Grow immediately — an under-sized modulator is visibly blurry.
        this.resizeFBOTexture(entry, Math.max(wantW, entry.w), Math.max(wantH, entry.h));
        entry.shrinkFrames = 0;
      } else if (wantW < entry.w || wantH < entry.h) {
        // Shrink only after sustained low use (hysteresis).
        entry.shrinkFrames = (entry.shrinkFrames ?? 0) + 1;
        if (entry.shrinkFrames >= FBO_SHRINK_FRAMES) {
          this.resizeFBOTexture(entry, wantW, wantH);
          entry.shrinkFrames = 0;
        }
      } else {
        entry.shrinkFrames = 0;
      }
      entry.viewW = Math.min(viewW, entry.w);
      entry.viewH = Math.min(viewH, entry.h);
    } else {
      entry = this.getOrCreateFBO(name);
      entry.viewW = entry.w;
      entry.viewH = entry.h;
    }
    entry.touched = true; // liveness for the auto-FBO sweep

    // For a self-referencing FBO, render into the back buffer while the front
    // (entry.fbo/tex) stays readable as the previous frame. endOffscreen swaps.
    const target = doubleBuffer ? this.getOrCreateBack(entry) : entry;
    const vw = target === entry ? entry.viewW : target.w;
    const vh = target === entry ? entry.viewH : target.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, vw, vh);
    this.setResolution(vw, vh);
    this.currentFBO = target.fbo;
    this.currentViewW = vw;
    this.currentViewH = vh;
    this.offscreenName = name;
    this.offscreenDoubleBuffered = doubleBuffer;
  }

  /** Reallocate an FBO entry's texture storage at new ladder dims. */
  private resizeFBOTexture(entry: FBOEntry, w: number, h: number): void {
    const { gl } = this;
    entry.w = w; entry.h = h;
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  endOffscreen(): void {
    const { gl } = this;
    // Swap front/back so the just-written buffer becomes the readable one for
    // the rest of this frame (and the old front becomes next frame's previous).
    if (this.offscreenDoubleBuffered && this.offscreenName !== null) {
      const e = this.fbos.get(this.offscreenName);
      if (e?.back) {
        const b = e.back;
        [e.fbo, b.fbo] = [b.fbo, e.fbo];
        [e.tex, b.tex] = [b.tex, e.tex];
      }
    }
    // Restore the enclosing target (canvas if the stack is empty).
    const prev = this.targetStack.pop();
    const fbo = prev ? prev.fbo : null;
    const vw = prev ? prev.viewW : this.w;
    const vh = prev ? prev.viewH : this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, vw, vh);
    this.setResolution(vw, vh);
    this.currentFBO = fbo;
    this.currentViewW = vw;
    this.currentViewH = vh;
    this.offscreenName = prev ? prev.name : null;
    this.offscreenDoubleBuffered = prev ? prev.doubleBuffered : false;
  }

  snapshotSoFar(): void {
    const { gl, w, h } = this;
    this.flushPending();
    const entry = this.getOrCreateFBO('all');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, entry.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    // Restore whatever was bound before (null during main pass, named FBO during pre-pass)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.currentFBO);
  }

  captureAll(): void {
    const { gl, w, h } = this;
    const entry = this.getOrCreateFBO('prev');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, entry.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  /**
   * Frame-end maintenance: recycle auto FBOs (modulate modulators, render
   * bakes) that were neither rendered nor resolved this frame — stale after a
   * re-eval renumbered their call site. User-named FBOs are never swept. Safe
   * because auto FBOs are stateless: recreating one gets correct content the
   * first frame it's referenced.
   */
  sweepAutoFBOs(): void {
    for (const [name, entry] of this.fbos) {
      if (!name.startsWith(AUTO_PREFIX)) continue;
      if (entry.touched) { entry.touched = false; continue; }
      this.fbos.delete(name);
      this.recycleFBOEntry(entry);
    }
  }

  /** Auto-FBO visibility for the perf panel: active count and VRAM bytes held
   *  by auto FBOs (modulators + render bakes), including the recycled pool. */
  getAutoFBOStats(): { count: number; bytes: number; pooled: number } {
    let count = 0, bytes = 0;
    for (const [name, e] of this.fbos) {
      if (!name.startsWith(AUTO_PREFIX)) continue;
      count++;
      bytes += e.w * e.h * 4;
    }
    for (const e of this.fboFreePool) bytes += e.w * e.h * 4;
    return { count, bytes, pooled: this.fboFreePool.length };
  }

  /** Return a swept auto-FBO entry to the free pool; past the cap, delete it. */
  private recycleFBOEntry(entry: FBOEntry): void {
    if (this.fboFreePool.length < FBO_POOL_CAP) {
      this.fboFreePool.push(entry);
      return;
    }
    this.deleteFBOEntry(entry);
  }

  private deleteFBOEntry(entry: FBOEntry): void {
    const { gl } = this;
    if (gl.isContextLost()) return; // handles already dead; deleting would throw
    gl.deleteFramebuffer(entry.fbo);
    gl.deleteTexture(entry.tex);
    if (entry.back) {
      gl.deleteFramebuffer(entry.back.fbo);
      gl.deleteTexture(entry.back.tex);
    }
  }

  /** Free the cached texture for a discarded source: a pool-evicted media element, or an evicted text canvas. */
  releaseSource(el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): void {
    this.texCache.release(el);
  }

  /**
   * Release every GPU resource this renderer owns, including the WebGL context.
   *
   * Deleting the GL objects isn't enough: the context itself is a scarce per-page
   * resource (Chrome keeps ~16 alive, then starts killing the oldest — after which
   * `getContext('webgl2')` can return null and the *next* renderer fails to
   * construct at all). Dropping our reference doesn't help either, since the canvas
   * holds the context and release would wait on GC. WEBGL_lose_context hands it
   * back immediately.
   */
  dispose(): void {
    const { gl } = this;
    this.disposed = true;
    this.texCache.clear();
    // A lost context has already freed every handle; deleting them now would throw
    // INVALID_OPERATION. Just drop our references and let GC handle the wrappers.
    if (!gl.isContextLost()) {
      for (const entry of this.fbos.values()) {
        gl.deleteFramebuffer(entry.fbo);
        gl.deleteTexture(entry.tex);
        if (entry.back) {
          gl.deleteFramebuffer(entry.back.fbo);
          gl.deleteTexture(entry.back.tex);
        }
      }
      for (const entry of this.fboFreePool) this.deleteFBOEntry(entry);
      gl.deleteProgram(this.program);
      gl.deleteVertexArray(this.vao);
      gl.deleteBuffer(this.instanceVBO);
      gl.deleteBuffer(this.opsUBO);
    }
    this.fbos.clear();
    this.fboFreePool.length = 0;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Allocate a fresh RGBA8 texture + framebuffer (canvas-sized by default). */
  private createFBOEntry(texW = this.w || 1, texH = this.h || 1): FBOEntry {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w: texW, h: texH, viewW: texW, viewH: texH };
  }

  private getOrCreateFBO(name: string, texW = this.w || 1, texH = this.h || 1): FBOEntry {
    let entry = this.fbos.get(name);
    if (entry) return entry;
    // Auto FBOs prefer a recycled same-size entry over allocating.
    if (name.startsWith(AUTO_PREFIX)) {
      const idx = this.fboFreePool.findIndex(e => e.w === texW && e.h === texH);
      if (idx >= 0) {
        entry = this.fboFreePool.splice(idx, 1)[0];
        this.fbos.set(name, entry);
        return entry;
      }
    }
    entry = this.createFBOEntry(texW, texH);
    this.fbos.set(name, entry);
    return entry;
  }

  /** Lazily allocate the ping-pong back buffer for a self-referencing FBO. */
  private getOrCreateBack(entry: FBOEntry): FBOEntry {
    if (!entry.back) entry.back = this.createFBOEntry();
    return entry.back;
  }

  private setBlend(mode: string): void {
    const { gl } = this;
    if (!BLEND_MODES[mode]) {
      console.warn(`WebGLRenderer: unsupported blend mode "${mode}", falling back to source-over`);
    }
    const [eqRGB, eqA, srcRGB, dstRGB, srcA, dstA] = BLEND_MODES[mode] ?? BLEND_MODES['source-over'];
    gl.blendEquationSeparate(eqRGB, eqA);
    gl.blendFuncSeparate(srcRGB, dstRGB, srcA, dstA);
  }
}

// ---------------------------------------------------------------------------
// GL helpers
// ---------------------------------------------------------------------------

/** Read the GPU vendor/renderer for diagnostics. Uses the unmasked strings when
 *  WEBGL_debug_renderer_info is available, else the (often generic) masked ones. */
function queryGpuInfo(gl: WebGL2RenderingContext): string {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor   = gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL   : gl.VENDOR);
    const renderer = gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return `${vendor} / ${renderer}`;
  } catch {
    return '(unknown)';
  }
}

export function compileShader(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    console.error(
      `[picodevil] Fatal: ${stage} shader failed to compile. The GPU/driver ` +
      `rejected our GLSL (e.g. ANGLE→Direct3D on Windows). Driver log:\n` +
      `${log ?? '(no log)'}\n\n--- ${stage} shader source ---\n${src}`,
    );
    throw new ShaderError(`${stage} shader compile error:\n${log ?? ''}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER,   vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    console.error(
      `[picodevil] Fatal: shader program failed to link. Driver log:\n${log ?? '(no log)'}`,
    );
    throw new ShaderError(`Program link error:\n${log ?? ''}`);
  }
  return prog;
}

/**
 * Create a VAO containing:
 *   - a static quad VBO (a_position, a_uv) with divisor 0
 *   - per-instance attrib pointers into instanceVBO with divisor 1
 *     (buffer is filled each frame in endFrame; only the layout is set up here)
 */
function createVAO(
  gl: WebGL2RenderingContext,
  instanceVBO: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // --- Static quad geometry (divisor 0) ---
  // 6 vertices (2 triangles), interleaved [x, y, u, v]
  const verts = new Float32Array([
    0, 0, 0, 0,
    1, 0, 1, 0,
    0, 1, 0, 1,
    1, 0, 1, 0,
    1, 1, 1, 1,
    0, 1, 0, 1,
  ]);

  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const quadStride = 4 * 4;  // 4 floats × 4 bytes
  gl.enableVertexAttribArray(LOC_POSITION);
  gl.vertexAttribPointer(LOC_POSITION, 2, gl.FLOAT, false, quadStride, 0);
  gl.vertexAttribDivisor(LOC_POSITION, 0);

  gl.enableVertexAttribArray(LOC_UV);
  gl.vertexAttribPointer(LOC_UV, 2, gl.FLOAT, false, quadStride, 2 * 4);
  gl.vertexAttribDivisor(LOC_UV, 0);

  // --- Per-instance attribs (divisor 1) ---
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceVBO);

  const s = INSTANCE_STRIDE;

  gl.enableVertexAttribArray(LOC_DEST_OFFSET);
  gl.vertexAttribPointer(LOC_DEST_OFFSET, 2, gl.FLOAT, false, s, 0);
  gl.vertexAttribDivisor(LOC_DEST_OFFSET, 1);

  gl.enableVertexAttribArray(LOC_DEST_SIZE);
  gl.vertexAttribPointer(LOC_DEST_SIZE, 2, gl.FLOAT, false, s, 8);
  gl.vertexAttribDivisor(LOC_DEST_SIZE, 1);

  gl.enableVertexAttribArray(LOC_UV_OFFSET);
  gl.vertexAttribPointer(LOC_UV_OFFSET, 2, gl.FLOAT, false, s, 16);
  gl.vertexAttribDivisor(LOC_UV_OFFSET, 1);

  gl.enableVertexAttribArray(LOC_UV_SIZE);
  gl.vertexAttribPointer(LOC_UV_SIZE, 2, gl.FLOAT, false, s, 24);
  gl.vertexAttribDivisor(LOC_UV_SIZE, 1);

  // mat4: 4 consecutive vec4 attrib slots (offsets 32..32+48)
  for (let col = 0; col < 4; col++) {
    const loc = LOC_TRANSFORM + col;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, s, 32 + col * 16);
    gl.vertexAttribDivisor(loc, 1);
  }

  gl.enableVertexAttribArray(LOC_EFFECTS);
  gl.vertexAttribPointer(LOC_EFFECTS, 2, gl.FLOAT, false, s, 96); // vec2: (effectStart, effectCount)
  gl.vertexAttribDivisor(LOC_EFFECTS, 1);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return vao;
}

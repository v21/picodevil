import type { Renderer, TileParams, TileSource } from './renderer-interface';
import { TextureCache } from './texture-cache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Default upper bound for sampler slots. The actual count is clamped to
// gl.MAX_TEXTURE_IMAGE_UNITS at runtime and the shader is compiled with that value.
const MAX_TEX_UNITS = 64;

// Per-instance Float32Array layout (32 floats = 128 bytes):
//   [0..1]   destOffset  (vec2)
//   [2..3]   destSize    (vec2)
//   [4..5]   uvOffset    (vec2)
//   [6..7]   uvSize      (vec2)
//   [8]      alpha       (float) ─┐
//   [9]      texIndex    (float)  │ packed as vec4 a_scalars (loc 6)
//   [10]     grey        (float)  │
//   [11]     hueRot      (float) ─┘
//   [12..13] pixUVStep   (vec2: UV-space step for pixelation; 0 = off)
//   [14..29] transform   (mat4, column-major)
//   [30]     contrast    (float: centred-contrast multiplier; 1 = identity)
//   [31]     brightness  (float: additive brightness offset; 0 = identity)
//   [32..33] tint        (vec2: x=tintHue [0,1 turns], y=tintStrength [unclamped])
//   Loc 15: free for future effects
const INSTANCE_FLOATS = 34;
const INSTANCE_STRIDE = INSTANCE_FLOATS * 4; // bytes

// Attribute locations (fixed via layout(location=N) in shader)
const LOC_POSITION    = 0;
const LOC_UV          = 1;
const LOC_DEST_OFFSET = 2;
const LOC_DEST_SIZE   = 3;
const LOC_UV_OFFSET   = 4;
const LOC_UV_SIZE     = 5;
const LOC_SCALARS     = 6; // vec4: (alpha, texIndex, grey, hueRot)
const LOC_PIX_UV_STEP = 7; // vec2
const LOC_TRANSFORM   = 8; // mat4 occupies 8, 9, 10, 11
const LOC_CONTRAST    = 12; // float
const LOC_BRIGHTNESS  = 13; // float
const LOC_TINT        = 14; // vec2: (tintHue, tintStrength)
// loc 15: free

// ---------------------------------------------------------------------------
// GLSL shaders
// ---------------------------------------------------------------------------

const VERT_SRC = /* glsl */`#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;

// Per-instance attributes (divisor = 1)
layout(location = 2) in vec2 a_destOffset;
layout(location = 3) in vec2 a_destSize;
layout(location = 4) in vec2 a_uvOffset;
layout(location = 5) in vec2 a_uvSize;
layout(location = 6) in vec4 a_scalars;  // x=alpha, y=texIndex, z=grey, w=hueRot
layout(location = 7) in vec2 a_pixUVStep;
layout(location = 8) in mat4 a_transform; // uses locations 8-11
layout(location = 12) in float a_contrast;
layout(location = 13) in float a_brightness;
layout(location = 14) in vec2 a_tint;  // x=tintHue, y=tintStrength
// location 15: free

flat out int v_texIndex;
out vec2 v_uv;
out float v_alpha;
out float v_grey;
out vec2 v_pixUVStep;
flat out float v_hueRot;
flat out float v_contrast;
flat out float v_brightness;
flat out vec2 v_tint;

void main() {
  // Interpolate UV across the crop window (signed size handles flipping)
  v_uv = a_uvOffset + a_uv * a_uvSize;
  v_texIndex = int(a_scalars.y);
  v_alpha = a_scalars.x;
  v_grey = a_scalars.z;
  v_pixUVStep = a_pixUVStep;
  v_hueRot = a_scalars.w;
  v_contrast = a_contrast;
  v_brightness = a_brightness;
  v_tint = a_tint;

  // Position the quad in 0..1 canvas coords, then convert to clip space
  vec2 pos = a_destOffset + (a_position - 0.5) * a_destSize;
  vec2 clip = pos * 2.0 - 1.0;
  clip.y = -clip.y;  // canvas Y is down; clip Y is up

  gl_Position = a_transform * vec4(clip, 0.0, 1.0);
}`;

// Build the fragment shader source for a given number of texture units.
function buildFragSrc(n: number): string {
  const ifChain = Array.from({ length: n }, (_, i) =>
    `${i === 0 ? 'if' : 'else if'} (v_texIndex == ${i}) color = texture(u_tex[${i}], uv);`
  ).join('\n  ');
  return /* glsl */`#version 300 es
precision mediump float;

uniform sampler2D u_tex[${n}];

flat in int v_texIndex;
in vec2 v_uv;
in float v_alpha;
in float v_grey;
in vec2 v_pixUVStep;
flat in float v_hueRot;
flat in float v_contrast;
flat in float v_brightness;
flat in vec2 v_tint;
out vec4 fragColor;

vec3 rgb2hsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float delta = maxC - minC;
  float l = (maxC + minC) * 0.5;
  float s = delta == 0.0 ? 0.0 : delta / (1.0 - abs(2.0 * l - 1.0));
  float h = 0.0;
  if (delta > 0.0) {
    if (maxC == c.r)      h = mod((c.g - c.b) / delta, 6.0);
    else if (maxC == c.g) h = (c.b - c.r) / delta + 2.0;
    else                  h = (c.r - c.g) / delta + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5)     return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hue2rgb(p, q, hsl.x + 1.0/3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0/3.0));
}

void main() {
  // Pixelation: quantise UV to a grid in texture space (before fract so
  // tiling still works). The step is 0 when pixelation is off.
  vec2 raw = v_uv;
  if (v_pixUVStep.x > 0.0) {
    raw = floor(raw / v_pixUVStep + 0.5) * v_pixUVStep;
  }
  // fract() gives GL_REPEAT-style tiling for out-of-bounds UV;
  // for normal in-bounds UVs it is a no-op.
  vec2 uv = fract(raw);
  vec4 color;
  ${ifChain}
  else color = texture(u_tex[0], uv);
  // Apply greyscale: mix between original and luminance-based grey.
  // Rec. 601 luma weights.
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(color.rgb, vec3(luma), v_grey);
  // Tint (hue attraction + saturation pull) and hue rotation share one HSL round-trip.
  if (v_tint.y != 0.0 || v_hueRot != 0.0) {
    vec3 hsl = rgb2hsl(color.rgb);
    if (v_tint.y != 0.0) {
      float d = v_tint.x - hsl.x;
      d = d - floor(d + 0.5);                        // shortest arc [-0.5, 0.5]
      hsl.x = fract(hsl.x + v_tint.y * d);
      hsl.y = hsl.y + v_tint.y * (1.0 - hsl.y);     // pull saturation toward 1, unclamped
    }
    hsl.x = fract(hsl.x + v_hueRot);
    color.rgb = hsl2rgb(hsl);
  }
  // Contrast (centred at 0.5) then brightness.
  color.rgb = (color.rgb - 0.5) * v_contrast + 0.5 + v_brightness;
  // Modulate alpha only — blend func uses SRC_ALPHA so multiplying
  // RGB here too would apply alpha twice and darken the result.
  color.a *= v_alpha;
  fragColor = color;
}`;
}

// ---------------------------------------------------------------------------
// Blend mode mapping
// ---------------------------------------------------------------------------

// Each entry: [srcRGB, dstRGB, srcAlpha, dstAlpha]
// Alpha channel uses ONE, ONE_MINUS_SRC_ALPHA (Porter-Duff source-over for alpha)
// so the canvas accumulates opacity correctly and composites cleanly against the page.
// Using blendFuncSeparate — same RGB behaviour as before, correct alpha accumulation.
const BLEND_MODES: Record<string, [GLenum, GLenum, GLenum, GLenum]> = {
  'source-over':    [WebGL2RenderingContext.SRC_ALPHA,  WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA, WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA],
  'lighter':        [WebGL2RenderingContext.SRC_ALPHA,  WebGL2RenderingContext.ONE,                 WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE],
  'add':            [WebGL2RenderingContext.SRC_ALPHA,  WebGL2RenderingContext.ONE,                 WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE],
  'multiply':       [WebGL2RenderingContext.DST_COLOR,  WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA, WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA],
  'screen':         [WebGL2RenderingContext.ONE,        WebGL2RenderingContext.ONE_MINUS_SRC_COLOR, WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA],
  'destination-out':[WebGL2RenderingContext.ZERO,       WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA, WebGL2RenderingContext.ZERO, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA],
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

  // Clamp to 1 source pixel minimum (replicates drawFit's zero-crop colour fill)
  const vsw = Math.max(1, absCropw * srcW);
  const vsh = Math.max(1, absCroph * srcH);

  // Crop window origin in normalised source coords
  const cropLeft = p.cropx - absCropw / 2;
  const cropTop  = p.cropy - absCroph / 2;

  let fitW: number;
  let fitH: number;

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
  if (source.kind === 'image') return [source.el.naturalWidth, source.el.naturalHeight];
  return [source.el.videoWidth, source.el.videoHeight];
}

// ---------------------------------------------------------------------------
// DrawCommand — intermediate representation accumulated per frame
// ---------------------------------------------------------------------------

interface DrawCommand {
  texture: WebGLTexture;
  blend:   string;
  // Pre-computed, ready to pack into Float32Array
  destOffsetX: number;
  destOffsetY: number;
  destSizeX:   number;
  destSizeY:   number;
  uvOffsetX:   number;
  uvOffsetY:   number;
  uvSizeX:     number;
  uvSizeY:     number;
  alpha:       number;
  grey:        number;
  pixUVStepX:  number;
  pixUVStepY:  number;
  hueRot:      number;
  contrast:     number;
  brightness:   number;
  tintHue:      number;
  tintStrength: number;
  transform:    Float32Array; // 16 floats, column-major
}

// ---------------------------------------------------------------------------
// WebGLRenderer
// ---------------------------------------------------------------------------

/**
 * WebGL2 rendering backend.
 * Implements Renderer — drop-in replacement for Canvas2DRenderer.
 *
 * Tiles are accumulated into a DrawCommand list each frame, then flushed in
 * batches via drawArraysInstanced. A batch breaks only when the blend mode
 * changes or a 17th unique source texture would be needed. This reduces GPU
 * command buffer pressure dramatically for patterns with many tiles
 * (e.g. cropStack(25,25) = 625 tiles → 1 draw call).
 */
interface FBOEntry { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; }

export class WebGLRenderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texCache: TextureCache;
  private readonly instanceVBO: WebGLBuffer;
  private readonly maxTexUnits: number;
  private readonly fbos = new Map<string, FBOEntry>();

  private instanceData = new Float32Array(256 * INSTANCE_FLOATS);
  private readonly pendingDraws: DrawCommand[] = [];

  private w = 0;
  private h = 0;
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    // Query the device limit before compiling the shader so we don't declare
    // more samplers than the hardware supports (causes a link error on some GPUs).
    this.maxTexUnits = Math.min(MAX_TEX_UNITS, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number);
    this.program     = createProgram(gl, VERT_SRC, buildFragSrc(this.maxTexUnits));
    this.instanceVBO = gl.createBuffer()!;
    this.vao         = createVAO(gl, this.program, this.instanceVBO);
    this.texCache    = new TextureCache(gl);

    // Bind texture units 0..N-1 to u_tex[0..N-1] once at init
    gl.useProgram(this.program);
    for (let i = 0; i < this.maxTexUnits; i++) {
      const loc = gl.getUniformLocation(this.program, `u_tex[${i}]`);
      if (loc) gl.uniform1i(loc, i);
    }

    // Handle context loss
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('WebGL context restored — re-initialising');
      this.texCache.clear();
    });
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.gl.viewport(0, 0, w, h);
    // Resize existing FBOs to match new canvas dimensions
    const { gl } = this;
    for (const entry of this.fbos.values()) {
      entry.w = w; entry.h = h;
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  beginFrame(): void {
    const { gl } = this;
    this.pendingDraws.length = 0;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    this.setBlend('source-over');
  }

  drawTile(p: TileParams): void {
    let tex: WebGLTexture | null;
    let srcW: number, srcH: number;
    let fboSource = false;

    if (p.source.kind === 'pattern') {
      const entry = this.fbos.get(p.source.name);
      if (!entry) return;
      tex = entry.tex;
      srcW = this.w; srcH = this.h;
      fboSource = true;
    } else {
      tex = this.texCache.get(p.source);
      if (!tex) return;
      [srcW, srcH] = srcSize(p.source);
    }

    const cellW = p.w * this.w;
    const cellH = p.h * this.h;
    let { uvOffsetX, uvSizeX, uvOffsetY, uvSizeY } = computeUV(p, srcW, srcH, cellW, cellH);

    // FBO textures are Y-flipped relative to HTML element textures.
    // WebGL renders with Y=0 at bottom, so the visual top of the FBO is at UV y=1.
    // Flip the Y axis so the image appears right-side up.
    if (fboSource) { uvOffsetY = uvOffsetY + uvSizeY; uvSizeY = -uvSizeY; }

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
      alpha:       Math.max(0, Math.min(1, p.alpha)),
      grey:        p.grey ?? 0,
      pixUVStepX:  p.pixelate > 0 ? p.pixelate * Math.abs(uvSizeX) / cellW : 0,
      pixUVStepY:  p.pixelate > 0 ? p.pixelate * Math.abs(uvSizeY) / cellH : 0,
      hueRot:      p.huerot ?? 0,
      contrast:     p.contrast ?? 1,
      brightness:   p.brightness ?? 0,
      tintHue:      p.tintHue ?? 0,
      tintStrength: p.tintStrength ?? 0,
      transform:    buildTransform(p),
    });
  }

  endFrame(): void {
    const { gl } = this;
    const draws = this.pendingDraws;
    if (draws.length === 0) return;

    // Greedily batch consecutive commands by blend mode, flushing when blend
    // changes or a 17th unique texture would be needed.
    let batchStart = 0;
    let texUnits   = new Map<WebGLTexture, number>();
    let blendMode  = draws[0].blend;

    const flush = (end: number) => {
      if (end <= batchStart) return;
      const count = end - batchStart;

      // Bind each texture to its assigned unit
      for (const [tex, unit] of texUnits) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
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
        d[base + 8]  = cmd.alpha;
        d[base + 9]  = texUnits.get(cmd.texture)!;
        d[base + 10] = cmd.grey;
        d[base + 11] = cmd.hueRot;
        d[base + 12] = cmd.pixUVStepX;
        d[base + 13] = cmd.pixUVStepY;
        d.set(cmd.transform, base + 14);
        d[base + 30] = cmd.contrast;
        d[base + 31] = cmd.brightness;
        d[base + 32] = cmd.tintHue;
        d[base + 33] = cmd.tintStrength;
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

    for (let i = 0; i < draws.length; i++) {
      const cmd = draws[i];
      const blendChange  = cmd.blend !== blendMode;
      const needsNewUnit = !texUnits.has(cmd.texture) && texUnits.size === this.maxTexUnits;

      if (blendChange || needsNewUnit) {
        flush(i);
        batchStart = i;
        texUnits   = new Map();
        blendMode  = cmd.blend;
      }

      if (!texUnits.has(cmd.texture)) {
        texUnits.set(cmd.texture, texUnits.size);
      }
    }

    flush(draws.length);
    draws.length = 0;
  }

  beginOffscreen(name: string): void {
    const { gl } = this;
    const entry = this.getOrCreateFBO(name);
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
    gl.viewport(0, 0, entry.w, entry.h);
  }

  endOffscreen(): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
  }

  captureAll(): void {
    const { gl, w, h } = this;
    const entry = this.getOrCreateFBO('all');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, entry.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  dispose(): void {
    const { gl } = this;
    this.texCache.clear();
    for (const entry of this.fbos.values()) {
      gl.deleteFramebuffer(entry.fbo);
      gl.deleteTexture(entry.tex);
    }
    this.fbos.clear();
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.instanceVBO);
  }

  private getOrCreateFBO(name: string): FBOEntry {
    const { gl, w, h } = this;
    let entry = this.fbos.get(name);
    if (entry) return entry;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w || 1, h || 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    entry = { fbo, tex, w: w || 1, h: h || 1 };
    this.fbos.set(name, entry);
    return entry;
  }

  private setBlend(mode: string): void {
    const { gl } = this;
    if (!BLEND_MODES[mode]) {
      console.warn(`WebGLRenderer: unsupported blend mode "${mode}", falling back to source-over`);
    }
    const [srcRGB, dstRGB, srcA, dstA] = BLEND_MODES[mode] ?? BLEND_MODES['source-over'];
    gl.blendFuncSeparate(srcRGB, dstRGB, srcA, dstA);
  }
}

// ---------------------------------------------------------------------------
// GL helpers
// ---------------------------------------------------------------------------

function compileShader(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
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
    throw new Error(`Program link error:\n${log}`);
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
  _program: WebGLProgram,
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

  // scalars vec4: (alpha, texIndex, grey, hueRot) packed at offset 32
  gl.enableVertexAttribArray(LOC_SCALARS);
  gl.vertexAttribPointer(LOC_SCALARS, 4, gl.FLOAT, false, s, 32);
  gl.vertexAttribDivisor(LOC_SCALARS, 1);

  gl.enableVertexAttribArray(LOC_PIX_UV_STEP);
  gl.vertexAttribPointer(LOC_PIX_UV_STEP, 2, gl.FLOAT, false, s, 48);
  gl.vertexAttribDivisor(LOC_PIX_UV_STEP, 1);

  // mat4: 4 consecutive vec4 attrib slots
  for (let col = 0; col < 4; col++) {
    const loc = LOC_TRANSFORM + col;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, s, 56 + col * 16);
    gl.vertexAttribDivisor(loc, 1);
  }

  gl.enableVertexAttribArray(LOC_CONTRAST);
  gl.vertexAttribPointer(LOC_CONTRAST, 1, gl.FLOAT, false, s, 120);
  gl.vertexAttribDivisor(LOC_CONTRAST, 1);

  gl.enableVertexAttribArray(LOC_BRIGHTNESS);
  gl.vertexAttribPointer(LOC_BRIGHTNESS, 1, gl.FLOAT, false, s, 124);
  gl.vertexAttribDivisor(LOC_BRIGHTNESS, 1);

  gl.enableVertexAttribArray(LOC_TINT);
  gl.vertexAttribPointer(LOC_TINT, 2, gl.FLOAT, false, s, 128);
  gl.vertexAttribDivisor(LOC_TINT, 1);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return vao;
}

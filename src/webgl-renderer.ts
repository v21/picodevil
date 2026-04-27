import type { Renderer, TileParams, TileSource } from './renderer-interface';
import { TextureCache } from './texture-cache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Default upper bound for sampler slots. The actual count is clamped to
// gl.MAX_TEXTURE_IMAGE_UNITS at runtime and the shader is compiled with that value.
const MAX_TEX_UNITS = 64;

// Per-instance Float32Array layout (26 floats = 104 bytes):
//   [0..1]   destOffset  (vec2)
//   [2..3]   destSize    (vec2)
//   [4..5]   uvOffset    (vec2)
//   [6..7]   uvSize      (vec2)
//   [8]      alpha       (float)
//   [9]      texIndex    (float)
//   [10..25] transform   (mat4, column-major)
const INSTANCE_FLOATS = 26;
const INSTANCE_STRIDE = INSTANCE_FLOATS * 4; // bytes

// Attribute locations (fixed via layout(location=N) in shader)
const LOC_POSITION    = 0;
const LOC_UV          = 1;
const LOC_DEST_OFFSET = 2;
const LOC_DEST_SIZE   = 3;
const LOC_UV_OFFSET   = 4;
const LOC_UV_SIZE     = 5;
const LOC_ALPHA       = 6;
const LOC_TEX_INDEX   = 7;
const LOC_TRANSFORM   = 8; // mat4 occupies 8, 9, 10, 11

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
layout(location = 6) in float a_alpha;
layout(location = 7) in float a_texIndex;
layout(location = 8) in mat4 a_transform; // uses locations 8-11

flat out int v_texIndex;
out vec2 v_uv;
out float v_alpha;

void main() {
  // Interpolate UV across the crop window (signed size handles flipping)
  v_uv = a_uvOffset + a_uv * a_uvSize;
  v_texIndex = int(a_texIndex);
  v_alpha = a_alpha;

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
out vec4 fragColor;

void main() {
  // fract() gives GL_REPEAT-style tiling for out-of-bounds UV;
  // for normal in-bounds UVs it is a no-op.
  vec2 uv = fract(v_uv);
  vec4 color;
  ${ifChain}
  else color = texture(u_tex[0], uv);
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

function srcSize(source: TileSource): [number, number] {
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
  transform:   Float32Array; // 16 floats, column-major
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
export class WebGLRenderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texCache: TextureCache;
  private readonly instanceVBO: WebGLBuffer;
  private readonly maxTexUnits: number;

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
    const tex = this.texCache.get(p.source);
    if (!tex) return;  // source not ready

    const [srcW, srcH] = srcSize(p.source);
    const cellW = p.w * this.w;
    const cellH = p.h * this.h;
    const { uvOffsetX, uvSizeX, uvOffsetY, uvSizeY } = computeUV(p, srcW, srcH, cellW, cellH);

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
      transform:   buildTransform(p),
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
        d.set(cmd.transform, base + 10);
      }

      this.setBlend(blendMode);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, floatsNeeded), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.bindVertexArray(null);
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

  dispose(): void {
    const { gl } = this;
    this.texCache.clear();
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.instanceVBO);
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

  gl.enableVertexAttribArray(LOC_ALPHA);
  gl.vertexAttribPointer(LOC_ALPHA, 1, gl.FLOAT, false, s, 32);
  gl.vertexAttribDivisor(LOC_ALPHA, 1);

  gl.enableVertexAttribArray(LOC_TEX_INDEX);
  gl.vertexAttribPointer(LOC_TEX_INDEX, 1, gl.FLOAT, false, s, 36);
  gl.vertexAttribDivisor(LOC_TEX_INDEX, 1);

  // mat4: 4 consecutive vec4 attrib slots
  for (let col = 0; col < 4; col++) {
    const loc = LOC_TRANSFORM + col;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, s, 40 + col * 16);
    gl.vertexAttribDivisor(loc, 1);
  }

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return vao;
}

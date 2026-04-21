import type { Renderer, TileParams, TileSource } from './renderer-interface';
import { TextureCache } from './texture-cache';

// ---------------------------------------------------------------------------
// GLSL shaders
// ---------------------------------------------------------------------------

const VERT_SRC = /* glsl */`#version 300 es
in vec2 a_position;   // 0..1 quad corner
in vec2 a_uv;         // 0..1 (matches a_position; remapped to source UV by uniforms)

uniform vec2 u_destOffset;  // dest rect top-left in 0..1 canvas coords
uniform vec2 u_destSize;    // dest rect size in 0..1 canvas coords
uniform vec2 u_uvOffset;    // UV rect origin in normalised texture coords
uniform vec2 u_uvSize;      // UV rect size (signed — negative = flip axis)
uniform mat4 u_transform;   // rotation / scale around cell centre (in clip space)

out vec2 v_uv;

void main() {
  // Interpolate UV across the crop window (signed size handles flipping)
  v_uv = u_uvOffset + a_uv * u_uvSize;

  // Position the quad in 0..1 canvas coords, then convert to clip space
  vec2 pos = u_destOffset + a_position * u_destSize;
  vec2 clip = pos * 2.0 - 1.0;
  clip.y = -clip.y;  // canvas Y is down; clip Y is up

  gl_Position = u_transform * vec4(clip, 0.0, 1.0);
}`;

const FRAG_SRC = /* glsl */`#version 300 es
precision mediump float;

uniform sampler2D u_texture;
uniform float u_alpha;

in vec2 v_uv;
out vec4 fragColor;

void main() {
  // fract() gives GL_REPEAT-style tiling for out-of-bounds UV;
  // for normal in-bounds UVs it is a no-op.
  vec2 uv = fract(v_uv);
  fragColor = texture(u_texture, uv);
  // Modulate alpha only — blend func uses SRC_ALPHA so multiplying
  // RGB here too would apply alpha twice and darken the result.
  fragColor.a *= u_alpha;
}`;

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
  const cx =  2 * (p.x + p.w / 2) - 1;
  const cy = -(2 * (p.y + p.h / 2) - 1);

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
// WebGLRenderer
// ---------------------------------------------------------------------------

/**
 * WebGL2 rendering backend.
 * Implements Renderer — drop-in replacement for Canvas2DRenderer.
 *
 * Each tile is a textured quad drawn with UV-encoded crop and fit.
 * Video frames are uploaded as GPU textures once per frame (no CPU readback).
 * Colour fills use a cached 1×1 RGBA texture.
 */
export class WebGLRenderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texCache: TextureCache;

  // Uniform locations
  private readonly uDestOffset:  WebGLUniformLocation;
  private readonly uDestSize:    WebGLUniformLocation;
  private readonly uUvOffset:    WebGLUniformLocation;
  private readonly uUvSize:      WebGLUniformLocation;
  private readonly uTransform:   WebGLUniformLocation;
  private readonly uTexture:     WebGLUniformLocation;
  private readonly uAlpha:       WebGLUniformLocation;

  private w = 0;
  private h = 0;
  private currentBlend = 'source-over';

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.program  = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.vao      = createQuadVAO(gl, this.program);
    this.texCache = new TextureCache(gl);

    gl.useProgram(this.program);
    this.uDestOffset  = gl.getUniformLocation(this.program, 'u_destOffset')!;
    this.uDestSize    = gl.getUniformLocation(this.program, 'u_destSize')!;
    this.uUvOffset    = gl.getUniformLocation(this.program, 'u_uvOffset')!;
    this.uUvSize      = gl.getUniformLocation(this.program, 'u_uvSize')!;
    this.uTransform   = gl.getUniformLocation(this.program, 'u_transform')!;
    this.uTexture     = gl.getUniformLocation(this.program, 'u_texture')!;
    this.uAlpha       = gl.getUniformLocation(this.program, 'u_alpha')!;

    gl.uniform1i(this.uTexture, 0);  // texture unit 0

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
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    this.setBlend('source-over');
  }

  drawTile(p: TileParams): void {
    const { gl } = this;

    const tex = this.texCache.get(p.source);
    if (!tex) return;  // source not ready

    // Switch blend mode only when it changes
    if (p.blend !== this.currentBlend) this.setBlend(p.blend);

    // UV rect: fit + crop → signed UV offset/size
    const [srcW, srcH] = srcSize(p.source);
    const cellW = p.w * this.w;
    const cellH = p.h * this.h;
    const { uvOffsetX, uvSizeX, uvOffsetY, uvSizeY } = computeUV(p, srcW, srcH, cellW, cellH);

    // Upload uniforms
    gl.uniform2f(this.uDestOffset, p.x, p.y);
    gl.uniform2f(this.uDestSize,   p.w, p.h);
    gl.uniform2f(this.uUvOffset,   uvOffsetX, uvOffsetY);
    gl.uniform2f(this.uUvSize,     uvSizeX,   uvSizeY);
    gl.uniform1f(this.uAlpha,      Math.max(0, Math.min(1, p.alpha)));
    gl.uniformMatrix4fv(this.uTransform, false, buildTransform(p));

    // Bind texture and draw the quad (6 vertices = 2 triangles)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  endFrame(): void {
    // WebGL auto-presents via the canvas — nothing to do.
  }

  dispose(): void {
    const { gl } = this;
    this.texCache.clear();
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }

  private setBlend(mode: string): void {
    const { gl } = this;
    if (!BLEND_MODES[mode]) {
      console.warn(`WebGLRenderer: unsupported blend mode "${mode}", falling back to source-over`);
    }
    const [srcRGB, dstRGB, srcA, dstA] = BLEND_MODES[mode] ?? BLEND_MODES['source-over'];
    gl.blendFuncSeparate(srcRGB, dstRGB, srcA, dstA);
    this.currentBlend = mode;
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
 * Create a VAO containing two triangles forming a unit quad.
 * Position and UV both span 0..1.
 */
function createQuadVAO(gl: WebGL2RenderingContext, program: WebGLProgram): WebGLVertexArrayObject {
  // 6 vertices (2 triangles), interleaved [x, y, u, v]
  const verts = new Float32Array([
    0, 0, 0, 0,
    1, 0, 1, 0,
    0, 1, 0, 1,
    1, 0, 1, 0,
    1, 1, 1, 1,
    0, 1, 0, 1,
  ]);

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const stride = 4 * 4;  // 4 floats × 4 bytes
  const aPos = gl.getAttribLocation(program, 'a_position');
  const aUV  = gl.getAttribLocation(program, 'a_uv');

  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);

  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 2 * 4);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return vao;
}

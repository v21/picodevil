import type { TileSource } from './renderer-interface';

type SourceElement = HTMLVideoElement | HTMLImageElement;

/**
 * Manages WebGL textures for tile sources.
 *
 * Videos and streams are re-uploaded every frame (frames change).
 * Images and colours are uploaded once and cached permanently.
 * Colour fills use a 1×1 RGBA texture — no canvas needed.
 */
export class TextureCache {
  private readonly gl: WebGL2RenderingContext;
  /** Texture per media element. */
  private readonly elementTextures = new Map<SourceElement, WebGLTexture>();
  /** Whether a static source (image) has had its first upload. */
  private readonly uploaded = new Set<SourceElement>();
  /** Colour textures, keyed by "r,g,b" integer string. */
  private readonly colorTextures = new Map<string, WebGLTexture>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /**
   * Return a valid WebGLTexture for the given source, uploading pixel data as needed.
   * Returns null if the source element isn't ready yet.
   */
  get(source: TileSource): WebGLTexture | null {
    if (source.kind === 'color') {
      return this.getColor(source.r, source.g, source.b);
    }
    const { el } = source;
    if (!this.isReady(el)) return null;

    let tex = this.elementTextures.get(el);
    if (!tex) {
      tex = this.createTexture();
      this.elementTextures.set(el, tex);
    }

    const isDynamic = source.kind === 'video' || source.kind === 'stream';
    if (isDynamic || !this.uploaded.has(el)) {
      this.upload(tex, el);
      this.uploaded.add(el);
    }
    return tex;
  }

  /** Release all GL resources (call on context loss or disposal). */
  clear(): void {
    const { gl } = this;
    for (const tex of this.elementTextures.values()) gl.deleteTexture(tex);
    for (const tex of this.colorTextures.values()) gl.deleteTexture(tex);
    this.elementTextures.clear();
    this.colorTextures.clear();
    this.uploaded.clear();
  }

  private getColor(r: number, g: number, b: number): WebGLTexture {
    const key = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
    let tex = this.colorTextures.get(key);
    if (!tex) {
      const { gl } = this;
      tex = this.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255]),
      );
      this.colorTextures.set(key, tex);
    }
    return tex;
  }

  private createTexture(): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private upload(tex: WebGLTexture, el: SourceElement): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
  }

  private isReady(el: SourceElement): boolean {
    if (el instanceof HTMLVideoElement) {
      // Match Canvas2DRenderer: only require videoWidth > 0 (metadata available).
      // Checking readyState >= 2 causes one-frame black flickers when the video
      // briefly drops below HAVE_CURRENT_DATA at loop boundaries.
      return el.videoWidth > 0;
    }
    return (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0;
  }
}

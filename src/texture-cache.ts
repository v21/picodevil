import type { TileSource } from './renderer-interface';

type SourceElement = HTMLVideoElement | HTMLImageElement;

// Separate WeakMap for canvas elements (text tiles). Using WeakMap so evicted
// cache entries from FrameRenderer.textCanvasCache are collected naturally.
// WeakSet tracks which canvases have already been uploaded (they never change).

/**
 * Manages WebGL textures for tile sources.
 *
 * Videos and streams are re-uploaded every frame (frames change).
 * Images and colours are uploaded once and cached permanently.
 * Colour fills use a 1×1 RGBA texture — no canvas needed.
 */
// Upper bound on cached colour textures (each a 1×1 RGBA). Colours are minted per
// distinct quantised "r,g,b", so a hue sweep / FFT-driven colour can otherwise grow
// the cache without bound. 4096 distinct colours on screen is already implausible,
// so the LRU cap never bites real patterns; it just stops the slow leak.
const MAX_COLOR_TEXTURES = 4096;

export class TextureCache {
  private readonly gl: WebGL2RenderingContext;
  // Texture per media element — WeakMap so a discarded <video>/<img> (and its
  // decoder buffers) can be GC'd even if release() is somehow missed. The GL
  // texture is freed deterministically by release() (pool eviction calls it);
  // WeakMap collection is heap-only insurance since a WebGLTexture has no finalizer.
  private elementTextures = new WeakMap<SourceElement, WebGLTexture>();
  /** Whether a static source (image) has had its first upload. */
  private uploaded = new WeakSet<SourceElement>();
  /** Colour textures, keyed by "r,g,b" integer string. Insertion-ordered for LRU. */
  private readonly colorTextures = new Map<string, WebGLTexture>();
  private canvasTextures = new WeakMap<HTMLCanvasElement, WebGLTexture>();
  private uploadedCanvases = new WeakSet<HTMLCanvasElement>();

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
    if (source.kind === 'text') {
      const { canvas } = source;
      let tex = this.canvasTextures.get(canvas);
      if (!tex) {
        tex = this.createTexture();
        this.canvasTextures.set(canvas, tex);
      }
      if (!this.uploadedCanvases.has(canvas)) {
        const { gl } = this;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        this.uploadedCanvases.add(canvas);
      }
      return tex;
    }
    const { el } = source;
    if (!this.isReady(el)) return null;

    let tex = this.elementTextures.get(el);
    if (!tex) {
      tex = this.createTexture();
      this.elementTextures.set(el, tex);
    }

    // A <video> mid-seek (or stalled) has no decodable current frame: texImage2D
    // would push zeros (a black tile). During reverse playback that means every
    // seek gap blanks the tile. Instead, skip the upload and keep the last good
    // frame on the texture — the tile shows a frozen frame until the seek lands.
    // (Streams never seek and are always live, so they always upload. Mocks have
    // no `seeking`/`readyState`, so `undefined < 2` is false → they still upload.)
    const frameStale = el.seeking === true || (el as HTMLVideoElement).readyState < 2; // < HAVE_CURRENT_DATA
    if (source.kind === 'video') {
      if (!frameStale) {
        this.upload(tex, el);
        this.uploaded.add(el);
      } else if (!this.uploaded.has(el)) {
        // Never decoded a frame yet — nothing to hold, so don't draw a blank texture.
        return null;
      }
      return tex;
    }

    const isDynamic = source.kind === 'stream';
    if (isDynamic || !this.uploaded.has(el)) {
      this.upload(tex, el, source.kind === 'stream');
      this.uploaded.add(el);
    }
    return tex;
  }

  /**
   * Release the texture for a single media element. Call when the video pool
   * permanently discards the element (eviction) so its GL texture is freed and the
   * element is dropped from the cache — otherwise both leak for the session.
   */
  release(el: SourceElement): void {
    const tex = this.elementTextures.get(el);
    if (tex) this.gl.deleteTexture(tex);
    this.elementTextures.delete(el);
    this.uploaded.delete(el);
  }

  /** Release all GL resources (call on context loss or disposal). */
  clear(): void {
    const { gl } = this;
    for (const tex of this.colorTextures.values()) gl.deleteTexture(tex);
    this.colorTextures.clear();
    // elementTextures/uploaded are Weak (can't iterate to delete) — individual GL
    // textures are freed by release() during normal churn; here we just swap in
    // fresh collections. On context loss the old textures are dead anyway; on
    // dispose the context is going away. Same trade-off as the canvas caches.
    this.elementTextures = new WeakMap();
    this.uploaded = new WeakSet();
    this.canvasTextures = new WeakMap();
    this.uploadedCanvases = new WeakSet();
  }

  private getColor(r: number, g: number, b: number): WebGLTexture {
    const key = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
    const existing = this.colorTextures.get(key);
    if (existing) {
      // LRU touch: re-insert so the most-recently-used colour sits at the tail.
      this.colorTextures.delete(key);
      this.colorTextures.set(key, existing);
      return existing;
    }
    const { gl } = this;
    // Evict the least-recently-used colour(s) before inserting past the cap.
    while (this.colorTextures.size >= MAX_COLOR_TEXTURES) {
      const oldest = this.colorTextures.keys().next().value as string;
      gl.deleteTexture(this.colorTextures.get(oldest)!);
      this.colorTextures.delete(oldest);
    }
    const tex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255]),
    );
    this.colorTextures.set(key, tex);
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

  private upload(tex: WebGLTexture, el: SourceElement, useCanvas = false): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (useCanvas && el instanceof HTMLVideoElement && el.videoWidth > 0) {
      // Screen/window capture streams use cross-process GPU textures that Chrome
      // cannot upload via texImage2D directly. Force a CPU-side copy via canvas.
      const cvs = new OffscreenCanvas(el.videoWidth, el.videoHeight);
      cvs.getContext('2d')!.drawImage(el, 0, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cvs);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    }
  }

  private isReady(el: SourceElement): boolean {
    if (el instanceof HTMLVideoElement) {
      // Only require videoWidth > 0 (metadata available).
      // Checking readyState >= 2 causes one-frame black flickers when the video
      // briefly drops below HAVE_CURRENT_DATA at loop boundaries.
      return el.videoWidth > 0;
    }
    return (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0;
  }
}

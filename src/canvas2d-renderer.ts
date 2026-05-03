import type { Renderer, TileParams } from './renderer-interface';
import { drawFit } from './draw-fit';

const TAU = Math.PI * 2;

/**
 * Canvas 2D rendering backend.
 * Implements Renderer using CanvasRenderingContext2D — the current live backend.
 * WebGL will replace this once built; the interface stays identical.
 */
export class Canvas2DRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  beginFrame(): void {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  drawTile(p: TileParams): void {
    // TODO: p.pixelate not implemented in Canvas2D renderer (WebGL only)
    const { ctx, w, h } = this;

    const hasRotation = p.rotateZ !== 0 || p.rotateXScale !== 1 || p.rotateYScale !== 1;
    if (hasRotation) {
      const cx = p.x * w;
      const cy = p.y * h;
      ctx.save();
      ctx.translate(cx, cy);
      if (p.rotateXScale !== 1 || p.rotateYScale !== 1) ctx.scale(p.rotateYScale, p.rotateXScale);
      if (p.rotateZ !== 0) ctx.rotate(p.rotateZ * TAU);
      ctx.translate(-cx, -cy);
    }

    const hasPosition = p.x !== 0 || p.y !== 0 || p.w !== 1 || p.h !== 1;
    if (hasPosition) {
      ctx.save();
      ctx.beginPath();
      ctx.rect((p.x - p.w / 2) * w, (p.y - p.h / 2) * h, p.w * w, p.h * h);
      ctx.clip();
      ctx.translate((p.x - p.w / 2) * w, (p.y - p.h / 2) * h);
      ctx.scale(p.w, p.h);
    }

    ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));

    const hasBlend = p.blend !== 'source-over';
    if (hasBlend) ctx.globalCompositeOperation = p.blend as GlobalCompositeOperation;

    const hasScale = p.scaleX !== 1 || p.scaleY !== 1;
    if (hasScale) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(p.scaleX, p.scaleY);
      ctx.translate(-w / 2, -h / 2);
    }

    const src = p.source;
    if (src.kind === 'color') {
      ctx.fillStyle = `rgb(${src.r * 255},${src.g * 255},${src.b * 255})`;
      ctx.fillRect(0, 0, w, h);
    } else if (src.kind === 'video' || src.kind === 'stream') {
      const { el } = src;
      if (el.videoWidth > 0) {
        drawFit(ctx, el, el.videoWidth, el.videoHeight, w, h, p.fit,
          p.cropx, p.cropy, p.cropw, p.croph);
      }
    } else {
      const { el } = src;
      if (el.naturalWidth > 0) {
        drawFit(ctx, el, el.naturalWidth, el.naturalHeight, w, h, p.fit,
          p.cropx, p.cropy, p.cropw, p.croph);
      }
    }

    if (hasScale) ctx.restore();
    ctx.globalAlpha = 1;
    if (hasBlend) ctx.globalCompositeOperation = 'source-over';
    if (hasPosition) ctx.restore();
    if (hasRotation) ctx.restore();
  }

  endFrame(): void {
    // Canvas 2D presents automatically — nothing to do.
  }

  dispose(): void {
    // Nothing to release.
  }
}

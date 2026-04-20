export type FitMode = "cover" | "contain" | "fill" | "none";

/**
 * Draw `source` into the canvas context at the given fit mode, optionally
 * cropping to a normalized sub-rectangle of the source.
 *
 * @param cropx  Left edge of crop in [0,1] normalized source coords (default 0)
 * @param cropy  Top edge of crop (default 0)
 * @param cropw  Width of crop (default 1). Negative values mirror horizontally.
 * @param croph  Height of crop (default 1). Negative values mirror vertically.
 *
 * When the crop rectangle extends outside [0,1], the source is tiled to fill
 * the destination (like CSS background-repeat). When it stays within [0,1] a
 * fast-path 9-argument drawImage is used instead.
 */
export function drawFit(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number, sh: number,
  cw: number, ch: number,
  fit: FitMode,
  cropx = 0, cropy = 0, cropw = 1, croph = 1,
): void {
  const flipX = cropw < 0;
  const flipY = croph < 0;
  // Effective source dimensions use absolute crop size
  const vsw = Math.abs(cropw) * sw;
  const vsh = Math.abs(croph) * sh;

  let dx: number, dy: number, dw: number, dh: number;

  switch (fit) {
    case "contain": {
      const scale = Math.min(cw / vsw, ch / vsh);
      dw = vsw * scale;
      dh = vsh * scale;
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
      break;
    }
    case "fill":
      dx = 0; dy = 0; dw = cw; dh = ch;
      break;
    case "none":
      dw = vsw; dh = vsh;
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
      break;
    case "cover":
    default: {
      const scale = Math.max(cw / vsw, ch / vsh);
      dw = vsw * scale;
      dh = vsh * scale;
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
      break;
    }
  }

  const needsTiling = cropx < 0 || cropy < 0 || cropx + Math.abs(cropw) > 1 || cropy + Math.abs(croph) > 1;

  if (!needsTiling) {
    // Fast path: 9-arg drawImage. Flip via negative dest dimensions.
    const actualDx = flipX ? dx + dw : dx;
    const actualDw = flipX ? -dw : dw;
    const actualDy = flipY ? dy + dh : dy;
    const actualDh = flipY ? -dh : dh;
    ctx.drawImage(source, cropx * sw, cropy * sh, vsw, vsh, actualDx, actualDy, actualDw, actualDh);
  } else {
    // Tiling path: createPattern with a transform that accounts for flip.
    const pat = ctx.createPattern(source, "repeat");
    if (!pat) return;
    const absScaleX = dw / vsw;
    const absScaleY = dh / vsh;
    // For flip, anchor shifts to the far edge so the image mirrors within the dest rect.
    const tx = flipX ? dx + dw + cropx * sw * absScaleX : dx - cropx * sw * absScaleX;
    const ty = flipY ? dy + dh + cropy * sh * absScaleY : dy - cropy * sh * absScaleY;
    pat.setTransform(
      new DOMMatrix()
        .translate(tx, ty)
        .scale(flipX ? -absScaleX : absScaleX, flipY ? -absScaleY : absScaleY),
    );
    ctx.save();
    (ctx as any).fillStyle = pat;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  }
}

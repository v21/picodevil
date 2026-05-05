export type FitMode = "cover" | "contain" | "fill" | "none" | "tile" | "tilecenter";

/**
 * Draw `source` into the canvas context at the given fit mode, optionally
 * cropping to a sub-rectangle of the source.
 *
 * @param cropx  Horizontal centre of crop in [0,1] normalised source coords (default 0.5)
 * @param cropy  Vertical centre of crop (default 0.5)
 * @param cropw  Width of crop as fraction of source width (default 1). Negative values mirror horizontally.
 * @param croph  Height of crop as fraction of source height (default 1). Negative values mirror vertically.
 *
 * cropx/cropy refer to the *centre* of the crop window, not the top-left corner.
 * cropw=0 (or croph=0) samples a single pixel at the centre — fills with that colour.
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
  cropx = 0.5, cropy = 0.5, cropw = 1, croph = 1,
): void {
  const flipX = cropw < 0;
  const flipY = croph < 0;
  const halfW = Math.abs(cropw) / 2;
  const halfH = Math.abs(croph) / 2;

  // Clamp to at least 1 source pixel so cropw=0 samples a single colour
  const vsw = Math.max(1, halfW * 2 * sw);
  const vsh = Math.max(1, halfH * 2 * sh);

  // Source top-left in source pixels (centre ± half-size)
  const sxOrigin = (cropx - halfW) * sw;
  const syOrigin = (cropy - halfH) * sh;

  if (fit === 'tile' || fit === 'tilecenter' || fit === 'none') {
    // Native resolution, always tiled via createPattern — scale=1 (1 source px = 1 dest px)
    // tile: crop origin anchored to cell top-left
    // tilecenter / none: cropx,cropy centred on cell centre
    const pat = ctx.createPattern(source, "repeat");
    if (!pat) return;
    const tx = fit === 'tile' ? -sxOrigin : cw / 2 - cropx * sw;
    const ty = fit === 'tile' ? -syOrigin : ch / 2 - cropy * sh;
    pat.setTransform(new DOMMatrix().translate(tx, ty));
    ctx.save();
    ctx.translate(flipX ? cw : 0, flipY ? ch : 0);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    (ctx as any).fillStyle = pat;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
    return;
  }

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

  const needsTiling =
    sxOrigin < 0 || syOrigin < 0 ||
    sxOrigin + vsw > sw || syOrigin + vsh > sh;

  if (!needsTiling) {
    ctx.save();
    ctx.translate(flipX ? dx + dw : dx, flipY ? dy + dh : dy);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(source, sxOrigin, syOrigin, vsw, vsh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    const pat = ctx.createPattern(source, "repeat");
    if (!pat) return;
    const scaleX = dw / vsw;
    const scaleY = dh / vsh;
    pat.setTransform(
      new DOMMatrix()
        .translate(-sxOrigin * scaleX, -syOrigin * scaleY)
        .scale(scaleX, scaleY),
    );
    ctx.save();
    ctx.translate(flipX ? dx + dw : dx, flipY ? dy + dh : dy);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    (ctx as any).fillStyle = pat;
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();
  }
}

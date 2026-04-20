export type FitMode = "cover" | "contain" | "fill" | "none";

/**
 * Draw `source` into the canvas context at the given fit mode, optionally
 * cropping to a normalized sub-rectangle of the source.
 *
 * @param cropx  Left edge of crop in [0,1] normalized source coords (default 0)
 * @param cropy  Top edge of crop (default 0)
 * @param cropw  Width of crop (default 1)
 * @param croph  Height of crop (default 1)
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
  // Effective source dimensions after applying crop
  const vsw = cropw * sw;
  const vsh = croph * sh;

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

  const needsTiling = cropx < 0 || cropy < 0 || cropx + cropw > 1 || cropy + croph > 1;

  if (!needsTiling) {
    // Fast path: source stays within bounds — use 9-arg drawImage
    ctx.drawImage(source, cropx * sw, cropy * sh, vsw, vsh, dx, dy, dw, dh);
  } else {
    // Tiling path: source repeats when crop extends outside [0,1]
    const pat = ctx.createPattern(source, "repeat");
    if (!pat) return;
    // Scale a single source tile so the crop region fills the destination rect
    const scaleX = dw / vsw;
    const scaleY = dh / vsh;
    pat.setTransform(
      new DOMMatrix()
        .translate(dx - cropx * sw * scaleX, dy - cropy * sh * scaleY)
        .scale(scaleX, scaleY),
    );
    ctx.save();
    (ctx as any).fillStyle = pat;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  }
}

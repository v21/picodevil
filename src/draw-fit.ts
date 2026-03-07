import type { FitMode } from "./screen-pattern";

export function drawFit(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number, sh: number,
  cw: number, ch: number,
  fit: FitMode,
): void {
  let dx: number, dy: number, dw: number, dh: number;

  switch (fit) {
    case "contain": {
      const scale = Math.min(cw / sw, ch / sh);
      dw = sw * scale;
      dh = sh * scale;
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
      break;
    }
    case "fill":
      dx = 0; dy = 0; dw = cw; dh = ch;
      break;
    case "none":
      dw = sw; dh = sh;
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
      break;
    case "cover":
    default: {
      const scale = Math.max(cw / sw, ch / sh);
      dw = sw * scale;
      dh = sh * scale;
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
      break;
    }
  }

  ctx.drawImage(source, dx, dy, dw, dh);
}

import qrcode from 'qrcode-generator';
import { warn } from './warnings';

/** Error-correction level: Q recovers ~25% damage — robust for an on-screen overlay. */
const EC_LEVEL = 'Q' as const;
/** Quiet-zone border around the code, in modules (the QR spec default is 4). */
const MARGIN_MODULES = 4;
/** Aim the rendered canvas near this many px square, so contain-scaling upward stays crisp. */
const TARGET_PX = 1024;

/**
 * Render a QR code for `data` to a canvas: white modules on a transparent
 * background (the quiet zone is transparent too, so Picodevil's own black canvas
 * shows through). Straight-alpha, no premultiply — composites like text().
 *
 * Deterministic in `data`, so the caller caches the canvas across frames.
 *
 * @param {string} data payload to encode (usually a URL)
 * @returns {HTMLCanvasElement} square canvas, white-on-transparent
 */
export function renderQrToCanvas(data: string): HTMLCanvasElement {
  const qr = qrcode(0, EC_LEVEL); // typeNumber 0 = auto-pick the smallest version that fits
  try {
    qr.addData(data);
    qr.make();
  } catch (e) {
    // Overflow (payload too long for a v40 code) or bad input — render nothing
    // rather than throwing into the frame loop.
    warn(`qr(): could not encode ${JSON.stringify(data).slice(0, 40)} — ${e}`);
    const empty = document.createElement('canvas');
    empty.width = empty.height = 1;
    return empty;
  }

  const count = qr.getModuleCount();
  const total = count + MARGIN_MODULES * 2;
  const cell = Math.max(2, Math.floor(TARGET_PX / total));
  const dim = total * cell;

  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, dim, dim); // transparent background + quiet zone
  ctx.fillStyle = 'white';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + MARGIN_MODULES) * cell, (r + MARGIN_MODULES) * cell, cell, cell);
      }
    }
  }
  // Edges stay crisp because the texture is sampled with NEAREST filtering (set in
  // TextureCache for kind:'qr') — a hard-edged module grid must not be bilinearly
  // interpolated, or the straight-alpha (0,0,0,0) background bleeds a dark fringe
  // into every module edge (and a premultiplied 2D canvas can't carry white in its
  // transparent texels to prevent it).
  return canvas;
}

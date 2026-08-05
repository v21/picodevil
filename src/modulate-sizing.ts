/**
 * Pure sizing maths for auto-modulator FBO passes.
 *
 * The frame pipeline is query-everything-then-draw, so every consumer's dest
 * rect is known before any FBO pass renders. These functions turn the
 * consumers of one auto FBO into a render plan: how many pixels the modulator
 * actually needs (fill cost scales with viewport), or that nobody visible
 * reads it at all (skip the pass entirely).
 *
 * Estimates are deliberately conservative — rotation shrink (rotateX/Y) is
 * ignored and rotated bounding boxes are taken at their widest, so an error
 * costs a little extra resolution, never a blurry or wrongly-skipped
 * modulator.
 */

const TAU = Math.PI * 2;

/** Minimum modulator resolution per axis — ladder/rounding sanity for
 *  tiny-but-visible consumers. */
export const MOD_RES_FLOOR = 16;

export interface Footprint {
  /** On-screen bounding-box size in pixels (unclamped — density, not crop). */
  wPx: number;
  hPx: number;
  /** True when the box intersects the canvas with positive area. */
  visible: boolean;
}

const num = (v: unknown, dflt: number): number => {
  if (v === undefined) return dflt;
  const n = Number(v);
  return isNaN(n) ? dflt : n;
};

/**
 * On-screen pixel bounding box of one consumer event's dest rect.
 * Reads the same raw event fields buildTileParams does (x/y/width/height/
 * scaleX/scaleY/rotateZ), in normalised canvas space.
 */
export function consumerFootprint(ev: any, canvasW: number, canvasH: number): Footprint {
  const x = num(ev.x, 0.5), y = num(ev.y, 0.5);
  const w = Math.abs(num(ev.width, 1) * num(ev.scaleX, 1));
  const h = Math.abs(num(ev.height, 1) * num(ev.scaleY, 1));
  let wPx = w * canvasW;
  let hPx = h * canvasH;

  const rotZ = num(ev.rotateZ, 0);
  if (rotZ !== 0) {
    const c = Math.abs(Math.cos(rotZ * TAU));
    const s = Math.abs(Math.sin(rotZ * TAU));
    const bw = c * wPx + s * hPx;
    const bh = s * wPx + c * hPx;
    wPx = bw; hPx = bh;
  }

  const cx = x * canvasW, cy = y * canvasH;
  const visible = wPx > 0 && hPx > 0 &&
    cx + wPx / 2 > 0 && cx - wPx / 2 < canvasW &&
    cy + hPx / 2 > 0 && cy - hPx / 2 < canvasH;

  return { wPx, hPx, visible };
}

export interface ModPlan {
  /** Required modulator viewport, in pixels (floored, canvas-clamped). */
  reqW: number;
  reqH: number;
  /** True when no visible consumer reads this modulator — skip its pass. */
  skip: boolean;
}

/**
 * Required modulator resolution for one auto FBO, from its consumer events.
 * Per consumer:
 *   'screen' → full canvas (rects map 1:1 to the full-frame image)
 *   'tile'   → footprint (the whole modulator squeezed into the tile)
 *   'uv'     → footprint × max(1, 1/|cropw|, 1/|croph|) — an uncropped tile
 *              reads at exactly tile density; crop-zoom magnifies the need
 * Max over visible consumers; zero visible consumers ⇒ skip.
 */
export function requiredModRes(events: any[], canvasW: number, canvasH: number): ModPlan {
  let reqW = 0, reqH = 0;
  let anyVisible = false;

  for (const ev of events) {
    const f = consumerFootprint(ev, canvasW, canvasH);
    if (!f.visible) continue;
    anyVisible = true;

    const space = ev.modSpace !== undefined ? String(ev.modSpace) : 'uv';
    let w: number, h: number;
    if (space === 'screen') {
      w = canvasW; h = canvasH;
    } else if (space === 'tile') {
      w = f.wPx; h = f.hPx;
    } else {
      const cropw = Math.abs(num(ev.cropw, 1));
      const croph = Math.abs(num(ev.croph, 1));
      w = f.wPx * Math.max(1, cropw > 0 ? 1 / cropw : Infinity);
      h = f.hPx * Math.max(1, croph > 0 ? 1 / croph : Infinity);
    }
    reqW = Math.max(reqW, w);
    reqH = Math.max(reqH, h);
  }

  if (!anyVisible) return { reqW: 0, reqH: 0, skip: true };
  return {
    reqW: Math.round(Math.min(canvasW, Math.max(MOD_RES_FLOOR, reqW))),
    reqH: Math.round(Math.min(canvasH, Math.max(MOD_RES_FLOOR, reqH))),
    skip: false,
  };
}

/**
 * Quantise a required size to the allocation ladder {1/8, 1/4, 1/2, 1} × full.
 * Textures are allocated at ladder sizes (render uses a sub-viewport inside),
 * so a smoothly-animating consumer doesn't realloc every frame.
 */
export function ladderStep(req: number, full: number): number {
  for (const div of [8, 4, 2]) {
    const step = Math.ceil(full / div);
    if (req <= step) return step;
  }
  return full;
}

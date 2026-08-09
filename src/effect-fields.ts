/**
 * The set of event-value fields that are *pixel effects* — operations the
 * fragment-shader VM bakes into the tile's colour/UV (see effect-compiler.ts).
 *
 * `.render()` treats these specially: it snapshots them into a bake segment and
 * clears them, so effects written before and after a `.render()` boundary become
 * separate rendered passes instead of colliding on one field. Everything NOT in
 * this set — source identity, playback (speed/begin/end/sync), geometry
 * (x/y/w/h/scale/rotate), fit, alpha, blend — stays on the one tile value and is
 * therefore transparent to `.render()` ordering.
 *
 * **Crop is included** (cropx/cropy/cropw/croph): it's a UV-window stage of the
 * chain, so a crop written *before* a `.render()` is baked (crop the source, then
 * bake) while a crop *after* one crops the baked result (warp-the-whole-frame-
 * then-slice). Without a boundary it's just the cell frame the cell-local effects
 * sit in, as before. See `renderBakeChain` (it canvas-sizes the bake when a crop
 * samples it downstream).
 *
 * Alpha and blend are deliberately excluded: they are *compositing*, applied when
 * the final tile lands on the canvas, not baked into the intermediate texture.
 */
export const EFFECT_FIELDS: ReadonlySet<string> = new Set([
  'grey',
  'huerot',
  'contrast',
  'brightness',
  'tintHue',
  'tintStrength',
  'barrel',
  'pixelate',
  'smear',
  'smearAngle',
  'smearJitter',
  'smearMode',
  'modSrc',
  'modAmt',
  'modSpace',
  'cropx',
  'cropy',
  'cropw',
  'croph',
]);

/** One baked effect pass: the FBO it renders into and the effect fields applied. */
export interface BakeSegment {
  name: string;
  effects: Record<string, unknown>;
}

/**
 * Split a tile value into its effect fields and everything else. Returns fresh
 * objects; `rest` preserves any existing `_bakeSegments`.
 */
export function splitEffects(v: Record<string, any>): {
  effects: Record<string, unknown>;
  rest: Record<string, any>;
} {
  const effects: Record<string, unknown> = {};
  const rest: Record<string, any> = {};
  for (const k in v) {
    if (EFFECT_FIELDS.has(k)) effects[k] = v[k];
    else rest[k] = v[k];
  }
  return { effects, rest };
}

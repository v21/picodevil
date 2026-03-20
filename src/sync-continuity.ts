/**
 * Sync mode playhead continuity: compute a distance offset that makes
 * computeExpectedTime return the same position after a speed/range change.
 *
 * This is a pure function for testability. The offset is stored on video
 * element state and passed to computeExpectedTime as `distOffset`.
 */

export interface SyncDistOffsetParams {
  elapsedSec: number;
  oldSpeed: number;
  newSpeed: number;
  /** Old loop start (seconds). */
  oldBegin: number;
  /** New loop start (seconds). */
  newBegin: number;
  /** Old loop end (seconds). */
  oldEnd: number;
  /** New loop end (seconds). */
  newEnd: number;
  oldLoopLen: number;
  newLoopLen: number;
  /** Phase offset in seconds (from sync(fraction) * duration). */
  syncOffset: number;
  /** Previous distOffset (from prior speed/range changes). */
  oldDistOffset: number;
}

/** Positive-modulo helper: always returns a value in [0, m). */
function posMod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

/**
 * Compute the distance offset needed to maintain playhead continuity
 * when speed and/or loop bounds change in sync mode.
 */
export function computeSyncDistOffset(p: SyncDistOffsetParams): number {
  if (p.newLoopLen <= 0) return 0;

  // 1. Compute old position
  let oldPos: number;
  if (p.oldSpeed === 0 || p.oldLoopLen <= 0) {
    oldPos = p.oldBegin;
  } else {
    const oldDist = p.elapsedSec * Math.abs(p.oldSpeed) + p.syncOffset + p.oldDistOffset;
    const oldDistInLoop = posMod(oldDist, p.oldLoopLen);
    oldPos = p.oldSpeed > 0
      ? p.oldBegin + oldDistInLoop
      : p.oldEnd - oldDistInLoop;
  }

  // 2. Clamp old position into new range [newBegin, newEnd).
  //    newEnd itself is not a valid position (distInLoop is always in [0, loopLen)
  //    due to modulo), so clamp to just under newEnd when position >= newEnd.
  const maxPos = p.newEnd - 1e-9;
  const clampedPos = Math.max(p.newBegin, Math.min(maxPos, oldPos));

  // 3. Compute target distInLoop for new speed direction
  const targetDistInLoop = p.newSpeed > 0
    ? clampedPos - p.newBegin
    : p.newEnd - clampedPos;

  // 4. Compute new base distInLoop (without any offset)
  if (p.newSpeed === 0) return 0; // speed=0 always returns loopStart, no offset needed
  const newBaseDist = p.elapsedSec * Math.abs(p.newSpeed) + p.syncOffset;
  const newBaseDistInLoop = posMod(newBaseDist, p.newLoopLen);

  // 5. Offset = difference between target and base
  return targetDistInLoop - newBaseDistInLoop;
}

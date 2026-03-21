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
  /** Video duration in seconds (needed for inverted range wrapping). */
  duration?: number;
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
  const dur = p.duration ?? Infinity;
  const oldInverted = p.oldBegin > p.oldEnd;
  const newInverted = p.newBegin > p.newEnd;

  // 1. Compute old position (mirrors computeExpectedTime logic)
  let oldPos: number;
  if (p.oldSpeed === 0 || p.oldLoopLen <= 0) {
    oldPos = p.oldBegin;
  } else {
    const oldDist = p.elapsedSec * Math.abs(p.oldSpeed) + p.syncOffset + p.oldDistOffset;
    const oldDistInLoop = posMod(oldDist, p.oldLoopLen);
    oldPos = p.oldSpeed > 0
      ? p.oldBegin + oldDistInLoop
      : p.oldEnd - oldDistInLoop;
    // Wrap through video boundary for inverted ranges
    if (oldInverted && dur < Infinity) {
      if (oldPos >= dur) oldPos -= dur;
      else if (oldPos < 0) oldPos += dur;
    }
  }

  // 2. Check if old position is within new range; if not, clamp.
  //    For inverted ranges, valid positions are [newBegin, dur) ∪ [0, newEnd).
  let clampedPos: number;
  if (newInverted && dur < Infinity) {
    const inUpper = oldPos >= p.newBegin;
    const inLower = oldPos < p.newEnd;
    if (inUpper || inLower) {
      clampedPos = oldPos; // already in range
    } else {
      // Out of range — clamp to nearest edge
      const distToBegin = Math.abs(oldPos - p.newBegin);
      const distToEnd = Math.abs(oldPos - p.newEnd);
      clampedPos = distToBegin <= distToEnd ? p.newBegin : p.newEnd - 1e-9;
    }
  } else {
    const maxPos = p.newEnd - 1e-9;
    clampedPos = Math.max(p.newBegin, Math.min(maxPos, oldPos));
  }

  // 3. Compute target distInLoop for new speed direction.
  //    For inverted ranges, distInLoop wraps through the video boundary.
  let targetDistInLoop: number;
  if (newInverted && dur < Infinity) {
    if (p.newSpeed > 0) {
      targetDistInLoop = clampedPos >= p.newBegin
        ? clampedPos - p.newBegin
        : clampedPos + (dur - p.newBegin);
    } else {
      targetDistInLoop = clampedPos < p.newEnd
        ? p.newEnd - clampedPos
        : p.newEnd + (dur - clampedPos);
    }
  } else {
    targetDistInLoop = p.newSpeed > 0
      ? clampedPos - p.newBegin
      : p.newEnd - clampedPos;
  }

  // 4. Compute new base distInLoop (without any offset)
  if (p.newSpeed === 0) return 0;
  const newBaseDist = p.elapsedSec * Math.abs(p.newSpeed) + p.syncOffset;
  const newBaseDistInLoop = posMod(newBaseDist, p.newLoopLen);

  // 5. Offset = difference between target and base
  return targetDistInLoop - newBaseDistInLoop;
}

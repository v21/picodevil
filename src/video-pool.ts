/**
 * Score a free video element's suitability for reuse at a target time.
 * Lower score = better match. Prefers elements needing a forward seek
 * (forward seek is cheaper than backward seek due to keyframe decoding).
 *
 * @param currentTime the element's current playback position
 * @param targetTime the desired playback position
 * @param duration the video's total duration (for wrap-around scoring)
 * @returns a non-negative score (0 = perfect match)
 */
export function scoreFreeElement(currentTime: number, targetTime: number, duration: number): number {
  if (duration <= 0) return Math.abs(currentTime - targetTime);

  // Forward distance: how far to seek forward from current to target (wrapping)
  const forwardDist = ((targetTime - currentTime) % duration + duration) % duration;
  if (forwardDist === 0) return 0;

  // Backward distance
  const backwardDist = duration - forwardDist;

  // Backward seek requires decoding from nearest keyframe — penalize it
  const BACKWARD_PENALTY = 1.5;
  return Math.min(forwardDist, backwardDist * BACKWARD_PENALTY);
}

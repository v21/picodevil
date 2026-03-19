import { computeExpectedTime } from "./video-playback";

/**
 * Compute expected video currentTime from an event's properties, using
 * a cached duration. Returns null if duration is unknown.
 */
export function computeExpectedFromEvent(
  ev: any,
  currentCycle: number,
  eventBegin: number,
  cps: number,
  cachedDuration: number | undefined,
): number | null {
  const dur = cachedDuration;
  if (dur == null || dur <= 0) return null;

  const speed = ev.speed != null ? Number(ev.speed) : 1;
  const loopStart = (ev.begin ?? 0) * dur;
  const loopEnd = (ev.end ?? 1) * dur;
  const syncOffset = ev.sync != null && ev.sync !== true ? Number(ev.sync) * dur : 0;

  return computeExpectedTime({
    currentCycle, eventBegin, cps: cps || 0.5,
    speed, loopStart, loopEnd, duration: dur, syncOffset,
  });
}

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

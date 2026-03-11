import { computeExpectedTime } from "./video-playback";
import { parseTimeValue, resolveTime, type TimeValue } from "./time-value";

/** Parse a raw start/end value into a TimeValue. */
function toTimeValue(raw: any): TimeValue {
  if (raw == null) return { value: 0, unit: "rel" };
  if (typeof raw === "bigint") return { value: Number(raw), unit: "rel" };
  if (typeof raw === "object" && "unit" in raw) return raw;
  const n = Number(raw);
  if (!isNaN(n)) return { value: n, unit: "rel" };
  return parseTimeValue(String(raw));
}

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
  const startTV = ev.start != null ? toTimeValue(ev.start) : { value: 0, unit: "rel" as const };
  const endTV = ev.end != null ? toTimeValue(ev.end) : { value: 1, unit: "rel" as const };
  const endIsDuration = ev.endIsDuration ?? false;

  const loopStart = resolveTime(startTV, dur);
  const resolvedEnd = resolveTime(endTV, dur);
  const loopEnd = endIsDuration ? loopStart + resolvedEnd : resolvedEnd;

  return computeExpectedTime({
    currentCycle, eventBegin, cps: cps || 0.5,
    speed, loopStart, loopEnd, duration: dur,
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

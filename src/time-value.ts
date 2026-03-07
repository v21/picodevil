export type TimeUnit = "rel" | "s" | "ms";

export interface TimeValue {
  value: number;
  unit: TimeUnit;
}

const TIME_RE = /^([+-]?\d*\.?\d+)\s*(ms|millis|s|sec)?$/;

export function parseTimeValue(s: string): TimeValue {
  const m = s.trim().match(TIME_RE);
  if (!m) throw new Error(`Invalid time value: "${s}"`);
  const value = Number(m[1]);
  const suffix = m[2];
  if (suffix === "ms" || suffix === "millis") return { value, unit: "ms" };
  if (suffix === "s" || suffix === "sec") return { value, unit: "s" };
  return { value, unit: "rel" };
}

/** Resolve a TimeValue to seconds, given the video duration in seconds. */
export function resolveTime(tv: TimeValue, duration: number): number {
  switch (tv.unit) {
    case "rel": return tv.value * duration;
    case "s": return tv.value;
    case "ms": return tv.value / 1000;
  }
}

/** Default start: 0 relative */
export const TIME_ZERO: TimeValue = { value: 0, unit: "rel" };

/** Default end: full duration */
export const TIME_END: TimeValue = { value: 1, unit: "rel" };

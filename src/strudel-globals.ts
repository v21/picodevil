/**
 * Documentation for Strudel built-in signals and Pattern methods available in the editor.
 *
 * These are re-exported here purely so JSDoc can be extracted for the sidebar reference.
 * The actual implementations come from @strudel/core.
 */
import { Pattern as CorePattern, sine as _sine, cosine as _cosine,
  saw as _saw, isaw as _isaw, tri as _tri, square as _square,
  perlin as _perlin, time as _time, mouseX as _mouseX, mouseY as _mouseY,
  signal as _signal,
} from "@strudel/core";

const PatternProto = CorePattern.prototype as any;

// ── Signals ─────────────────────────────────────────────────────────────────

/**
 * Sine wave oscillating between 0 and 1 per cycle.
 * Use `.range(min, max)` to rescale and `.slow(n)` to change period.
 * @example
 * $: s("clip.mp4").alpha(sine)
 * @example
 * $: s("clip.mp4").x(sine.range(-0.5, 0.5).slow(2))
 */
export const sine = _sine;

/**
 * Alias for {@link sine}.
 * @example
 * $: s("clip.mp4").alpha(sin)
 */
export const sin = _sine;

/**
 * Cosine wave oscillating between 0 and 1 per cycle (sine shifted by a quarter cycle).
 * @example
 * $: s("clip.mp4").x(sine).y(cosine)
 */
export const cosine = _cosine;

/**
 * Alias for {@link cosine}.
 * @example
 * $: s("clip.mp4").x(sin).y(cos)
 */
export const cos = _cosine;

/**
 * Tangent wave — one period per cycle, pole at t=0.5 (values approach ±∞).
 * Use `.range()` to clip to a useful interval, or combine with `.segment()`.
 * @example
 * $: s("clip.mp4").x(tan.range(-2, 2).slow(4))
 */
export const tan = _signal((t: number) => Math.tan(Math.PI * t));

/**
 * Sawtooth wave rising from 0 to 1 over each cycle, then resetting.
 * @example
 * $: s("clip.mp4").scrub(saw)
 */
export const saw = _saw;

/**
 * Inverted sawtooth wave falling from 1 to 0 over each cycle.
 * @example
 * $: s("clip.mp4").alpha(isaw)
 */
export const isaw = _isaw;

/**
 * Triangle wave oscillating between 0 and 1 (rises then falls linearly).
 * @example
 * $: s("clip.mp4").alpha(tri)
 */
export const tri = _tri;

/**
 * Square wave alternating between 0 and 1 each half-cycle.
 * @example
 * $: s("clip.mp4").alpha(square)
 */
export const square = _square;

/**
 * Perlin noise signal oscillating smoothly between 0 and 1.
 * Unlike sine/tri, the shape varies organically over time.
 * @example
 * $: s("clip.mp4").alpha(perlin)
 */
export const perlin = _perlin;

/**
 * Current cycle position as a signal (ramps 0→1 then resets). Equivalent to `saw`.
 * Useful for driving parameters that track absolute cycle time.
 * @example
 * $: s("clip.mp4").scrub(time)
 */
export const time = _time;

/**
 * Horizontal mouse position as a signal, ranging 0 (left) to 1 (right).
 * @example
 * $: s("clip.mp4").x(mouseX.range(-0.5, 0.5))
 */
export const mouseX = _mouseX;

/**
 * Vertical mouse position as a signal, ranging 0 (top) to 1 (bottom).
 * @example
 * $: s("clip.mp4").y(mouseY.range(-0.5, 0.5))
 */
export const mouseY = _mouseY;

// ── Signal/Pattern methods ───────────────────────────────────────────────────

/**
 * Rescale a signal from its native [0, 1] range to [min, max].
 * @param min lower bound of output range
 * @param max upper bound of output range
 * @example
 * sine.range(0.3, 0.7)
 * @example
 * sine.range(0.3, 0.7).slow(2.3)
 */
PatternProto.range = PatternProto.range;

/**
 * Slow a pattern down by factor n (stretch it over n cycles).
 * @param n slowdown factor — 2 = half speed, 0.5 = double speed
 * @example
 * sine.slow(4)
 * @example
 * s("clip.mp4 other.mp4").slow(2)
 */
PatternProto.slow = PatternProto.slow;

/**
 * Speed a pattern up by factor n (compress it into 1/n of a cycle).
 * @param n speedup factor — 2 = double speed, 0.5 = half speed
 * @example
 * sine.fast(3)
 * @example
 * s("clip.mp4 other.mp4").fast(2)
 */
PatternProto.fast = PatternProto.fast;

/**
 * Sample a continuous signal into n discrete events per cycle.
 * Useful for turning a smooth signal into stepped values.
 * @param n number of samples per cycle
 * @example
 * sine.segment(8).range(0.2, 0.8)
 */
PatternProto.segment = PatternProto.segment;

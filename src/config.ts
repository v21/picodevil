/**
 * Server URL is configured at runtime — see ./server-config.ts.
 * Use `getVideoBase()` / `getImageBase()` / `resolveUrl()` from there
 * instead of compile-time constants.
 */

export const CYCLES_PER_SECOND = 0.5;
/** How far ahead to query patterns for video prewarming, in milliseconds. */
export const PREWARM_LOOKAHEAD_MS = 500;

/**
 * Max new video elements created (src set, decode triggered) per frame during prewarm.
 * Spreading element creation over multiple frames avoids decode hitches when many new
 * sources come into view at once (e.g. syncStack(10) switching sources).
 * Seeks on already-loaded free elements are not rate-limited — they're cheap.
 */
export const PREWARM_NEW_ELEMENTS_PER_FRAME = 2;

/**
 * Max idle (free) video elements held across all sources.
 * Needs to be >= the largest syncStack(N) you use — e.g. syncStack(10) needs 10 idle
 * elements for the outgoing source so they can be reused when it comes back.
 */
export const MAX_FREE_VIDEO_ELEMENTS = 64;

/**
 * Two NeededSources are considered shareable (can reuse the same pool element)
 * if their expected playhead positions are within this many seconds of each other.
 */
export const SHARE_TIME_THRESHOLD = 0.04;

/**
 * Penalty multiplier for backward seeks when scoring pool element candidates.
 * A backward seek of distance d costs the same as a forward seek of d * BACKWARD_PENALTY,
 * biasing the pool toward forward-continuity and reducing visible stutter.
 */
export const BACKWARD_PENALTY = 1.5;

/**
 * Fixed cost added to a candidate that would have to *seek* to reach its slot (vs. one that
 * can arrive by natural playback). The matcher minimises a global cost, so making any seek far
 * more expensive than any seek *distance* turns the objective into "minimise the number of
 * seeks": elements already tracking a slot lock in for free, and only genuinely-displaced ones
 * (e.g. a playhead wrapping the loop) seek. Must dominate the largest realistic total distance
 * sum (≈ slots × dur × BACKWARD_PENALTY); 1e6 clears that by orders of magnitude for clip-length
 * media while staying well within float precision.
 */
export const SEEK_PENALTY = 1e6;

/**
 * Cost of spawning a fresh element for a slot instead of reusing a pooled one. Set high enough
 * that reuse always wins when any candidate exists — reproducing the previous "create new only
 * when the pool is empty" behaviour. Lower it (toward ~SEEK_PENALTY + decode-from-scratch) to let
 * the matcher prefer a fresh decode over a very expensive backward-seek reuse.
 */
export const NEW_ELEMENT_COST = 1e9;

/** Runtime CPS — updated each frame by main.ts, read by fit()/loopAt(). */
let _runtimeCps = CYCLES_PER_SECOND;
export function getRuntimeCps(): number { return _runtimeCps; }
export function setRuntimeCps(v: number) { _runtimeCps = v; }

/** Set to false when deploying without the local Node server (e.g. public hosting). */
export const SERVER_ENABLED = true;

export const VIDEO_BASE = "http://localhost:3456/videos/";
export const IMAGE_BASE = "http://localhost:3456/images/";
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
 * Max total memory used by cached video blobs, in bytes.
 * Each entry holds the full video file — I-frame-only re-encoded files from the
 * server can be 100–500 MB each. Oldest entries are evicted when the limit is exceeded.
 * Default: 2 GB.
 */
export const MAX_BLOB_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

/** Runtime CPS — updated each frame by main.ts, read by fit()/loopAt(). */
let _runtimeCps = CYCLES_PER_SECOND;
export function getRuntimeCps(): number { return _runtimeCps; }
export function setRuntimeCps(v: number) { _runtimeCps = v; }

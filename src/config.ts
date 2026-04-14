/** Set to false when deploying without the local Node server (e.g. public hosting). */
export const SERVER_ENABLED = true;

export const VIDEO_BASE = "http://localhost:3456/videos/";
export const IMAGE_BASE = "http://localhost:3456/images/";
export const CYCLES_PER_SECOND = 0.5;
/** How far ahead to query patterns for video prewarming, in milliseconds. */
export const PREWARM_LOOKAHEAD_MS = 500;

/** Runtime CPS — updated each frame by main.ts, read by fit()/loopAt(). */
let _runtimeCps = CYCLES_PER_SECOND;
export function getRuntimeCps(): number { return _runtimeCps; }
export function setRuntimeCps(v: number) { _runtimeCps = v; }

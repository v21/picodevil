/**
 * Documentation stubs for runtime-injected globals (setCps, setCpm, hush).
 * These are provided by main.ts via the eval sandbox — not called from this file.
 */

/**
 * Sets the global cycles per second (tempo). Default is 0.5 (one cycle every 2 seconds).
 * Can be a number or a pattern of numbers for tempo automation.
 *
 * @param {number|Pattern} cps cycles per second
 * @example
 * setCps(1)     // one cycle per second
 * setCps(0.25)  // one cycle every 4 seconds
 * setCps(0)     // freeze at current position
 */
export function setCps(cps: number): void { void cps; }

/**
 * Sets the global cycles per minute (tempo). Equivalent to `setCps(cpm / 60)`.
 * Useful for thinking in BPM (120 bpm = 2 cps).
 *
 * @param {number|Pattern} cpm cycles per minute
 * @example
 * setCpm(120)   // 120 bpm (2 cps)
 * setCpm(60)    // 60 bpm (1 cps)
 */
export function setCpm(cpm: number): void { void cpm; }

/**
 * Clears all registered patterns. Equivalent to evaluating an empty editor.
 *
 * @example
 * hush()
 */
export function hush(): void {}

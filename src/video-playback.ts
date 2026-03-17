import { setPlaybackRate, isNativeRate } from "./playback-rate";

export type VideoEl = HTMLVideoElement & { _seeking?: boolean; _srcUrl?: string; _lastEventBegin?: number; _seekStartTime?: number; _lastLogTime?: number; _lastExpected?: number; _lastExpectedWall?: number };

export interface VideoFrameContext {
  ev: any;
  el: VideoEl;
  currentCycle: number;
  eventBegin: number;
  cps: number;
}


export interface ExpectedTimeParams {
  currentCycle: number;
  eventBegin: number;
  cps: number;
  speed: number;
  loopStart: number;
  loopEnd: number;
  duration: number;
}

/** Compute expected video currentTime from pattern timing. Pure function. */
export function computeExpectedTime(p: ExpectedTimeParams): number {
  if (p.speed === 0) return p.loopStart;
  const elapsedSec = (p.currentCycle - p.eventBegin) / p.cps;
  const loopLen = Math.abs(p.loopEnd - p.loopStart);
  if (loopLen === 0) return p.loopStart;
  const dist = elapsedSec * Math.abs(p.speed);
  const distInLoop = ((dist % loopLen) + loopLen) % loopLen; // always positive
  if (p.speed > 0) {
    return p.loopStart + distInLoop;
  } else {
    return p.loopEnd - distInLoop;
  }
}

/** Max allowed drift in seconds before we correct video position. */
const DRIFT_THRESHOLD = 0.15;

/** Rate mismatch threshold (s/s) above which we consider the playback window to be moving. */
const RATE_MISMATCH_THRESHOLD = 0.2;

/**
 * Detect whether the expected playback position is advancing at a rate different from
 * native playback speed — e.g. because .start() or .end() are dynamic patterns.
 * Pure function; element state tracking is the caller's responsibility.
 */
export function detectWindowMoving(p: {
  expected: number;
  prevExpected: number | undefined;
  wallDt: number;
  speed: number;
  loopLen: number;
}): boolean {
  if (p.prevExpected == null || p.wallDt < 0.005) return false;
  const delta = p.expected - p.prevExpected;
  // Ignore loop-boundary wraps — expected jumps by ~loopLen, which is not a real rate change
  if (p.loopLen > 0 && Math.abs(delta) >= p.loopLen / 2) return false;
  const effectiveRate = delta / p.wallDt;
  return Math.abs(effectiveRate - p.speed) > RATE_MISMATCH_THRESHOLD;
}

export function renderVideoFrame(c: VideoFrameContext): void {
  const speed = c.ev.speed != null ? Number(c.ev.speed) : 1;
  const beginVal = Number(c.ev.begin ?? 0);
  const endVal = Number(c.ev.end ?? 1);

  updateVideoPlayback(c.el, speed, beginVal, endVal, c.currentCycle, c.eventBegin, c.cps);
}

function updateVideoPlayback(
  el: VideoEl,
  speed: number,
  beginVal: number,
  endVal: number,
  currentCycle: number,
  eventBegin: number,
  cps: number,
): void {
  const dur = el.duration;
  const loopStart = beginVal * dur;
  const loopEnd = endVal * dur;
  const loopLen = Math.abs(loopEnd - loopStart);

  const expected = computeExpectedTime({
    currentCycle, eventBegin, cps: cps || 0.5,
    speed, loopStart, loopEnd, duration: dur,
  });

  // Detect event boundary: new event means force-seek to expected position
  const isNewEvent = el._lastEventBegin !== eventBegin;
  if (isNewEvent) {
    el._lastEventBegin = eventBegin;
    // Reset rate tracking so a position jump from a new event doesn't look like a moving window
    el._lastExpected = undefined;
    el._lastExpectedWall = undefined;
  }

  const src = el._srcUrl ?? el.src;
  const now = Date.now();
  const canLog = (now - (el._lastLogTime ?? 0)) > 300;

  const wallDt = el._lastExpectedWall != null ? (now - el._lastExpectedWall) / 1000 : 0;
  const windowIsMoving = detectWindowMoving({ expected, prevExpected: el._lastExpected, wallDt, speed, loopLen });
  el._lastExpected = expected;
  el._lastExpectedWall = now;

  if (speed < 0 || !isNativeRate(speed) || windowIsMoving) {
    // Non-native rate: pause and seek to computed position
    if (!el.paused) el.pause();
    if (el._seeking) {
      const seekAge = now - (el._seekStartTime ?? now);
      if (seekAge > 200 && canLog) {
        console.warn(`[uzuvid] ${src}: seeking is slow (${seekAge}ms pending) — playback will stutter [seeking mode, speed ${speed}x]`);
        el._lastLogTime = now;
      }
    } else {
      if (isNewEvent && canLog) {
        console.log(`[uzuvid] ${src}: using manual seeking (speed ${speed}x) — won't play smoothly`);
        el._lastLogTime = now;
      }
      if (Math.abs(el.currentTime - expected) > 0.01) {
        el._seekStartTime = now;
        el.currentTime = expected;
      }
    }
  } else {
    // Native rate: let browser play, correct drift
    if (el.paused) el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
    if (el.playbackRate !== speed) setPlaybackRate(el, speed);
    // Use loop-adjusted drift: near loop boundaries, currentTime may be near
    // loopEnd while expected has just wrapped to loopStart (or vice versa).
    // Comparing modular distance avoids a false drift spike at every loop boundary.
    const rawDrift = Math.abs(el.currentTime - expected);
    const drift = loopLen > 0
      ? Math.min(rawDrift, Math.abs(rawDrift - loopLen))
      : rawDrift;
    if (isNewEvent || drift > DRIFT_THRESHOLD) {
      if (!isNewEvent && drift > DRIFT_THRESHOLD && canLog) {
        const filename = src.split("/").pop() ?? src;
        console.warn(`[uzuvid] drift correction: ${filename} at ${el.currentTime.toFixed(3)}s / ${dur.toFixed(3)}s (expected ${expected.toFixed(3)}s, drift ${drift.toFixed(3)}s) [speed ${speed}x, window-stable native mode, src: ${src}]`);
        el._lastLogTime = now;
      }
      el.currentTime = expected;
    }
  }
}

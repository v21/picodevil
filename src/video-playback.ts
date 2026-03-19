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
  /** Phase offset in seconds (from sync(fraction) × duration). */
  syncOffset?: number;
}

/** Compute expected video currentTime from pattern timing. Pure function. */
export function computeExpectedTime(p: ExpectedTimeParams): number {
  if (p.speed === 0) return p.loopStart;
  const elapsedSec = (p.currentCycle - p.eventBegin) / p.cps;
  const loopLen = Math.abs(p.loopEnd - p.loopStart);
  if (loopLen === 0) return p.loopStart;
  const dist = elapsedSec * Math.abs(p.speed) + (p.syncOffset ?? 0);
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

  // DEBUG: log at loop boundaries to trace fit() vs fit().chop() divergence
  const dur = c.el.duration;
  if (isFinite(dur) && dur > 0) {
    const loopStart = beginVal * dur;
    const loopEnd = endVal * dur;
    const loopLen = Math.abs(loopEnd - loopStart);
    const syncOffset = c.ev.sync != null && c.ev.sync !== true ? Number(c.ev.sync) * dur : 0;
    const expected = computeExpectedTime({
      currentCycle: c.currentCycle, eventBegin: c.eventBegin, cps: c.cps || 0.5,
      speed, loopStart, loopEnd, duration: dur, syncOffset,
    });
    const prevExp = c.el._lastExpected;
    const jumped = prevExp != null && loopLen > 0 && (prevExp - expected) > loopLen / 2;
    const isNew = c.el._lastEventBegin !== c.eventBegin;
    if (jumped || isNew) {
      const src = (c.el._srcUrl ?? c.el.src).split("/").pop();
      console.log(`[DEBUG] ${src} seek: eventBegin=${c.eventBegin} begin=${beginVal} end=${endVal} speed=${speed.toFixed(3)} expected=${expected.toFixed(3)} ct=${c.el.currentTime.toFixed(3)} loopRange=[${loopStart.toFixed(1)},${loopEnd.toFixed(1)}] cycle=${c.currentCycle.toFixed(4)} isNew=${isNew} loopWrap=${jumped}`);
    }
  }

  const syncOffset = c.ev.sync != null && c.ev.sync !== true ? Number(c.ev.sync) * c.el.duration : 0;
  updateVideoPlayback(c.el, speed, beginVal, endVal, c.currentCycle, c.eventBegin, c.cps, syncOffset);
}

function updateVideoPlayback(
  el: VideoEl,
  speed: number,
  beginVal: number,
  endVal: number,
  currentCycle: number,
  eventBegin: number,
  cps: number,
  syncOffset: number = 0,
): void {
  const dur = el.duration;
  const loopStart = beginVal * dur;
  const loopEnd = endVal * dur;
  const loopLen = Math.abs(loopEnd - loopStart);

  const expected = computeExpectedTime({
    currentCycle, eventBegin, cps: cps || 0.5,
    speed, loopStart, loopEnd, duration: dur, syncOffset,
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

  const prevExpected = el._lastExpected;
  const wallDt = el._lastExpectedWall != null ? (now - el._lastExpectedWall) / 1000 : 0;
  const windowIsMoving = detectWindowMoving({ expected, prevExpected, wallDt, speed, loopLen });
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
    // Detect loop wrap: expected jumped backward by ~loopLen (e.g. from near loopEnd
    // to near loopStart). The browser doesn't loop for us, so we must seek immediately.
    // Without this, the modular drift check sees rawDrift ≈ loopLen and computes drift ≈ 0,
    // letting el.currentTime play past loopEnd uncorrected.
    // Note: prevExpected is captured above (before el._lastExpected is updated).
    const loopWrapped = loopLen > 0 && prevExpected != null &&
      (prevExpected - expected) > loopLen / 2;
    const rawDrift = Math.abs(el.currentTime - expected);
    const drift = loopLen > 0
      ? Math.min(rawDrift, Math.abs(rawDrift - loopLen))
      : rawDrift;
    if (isNewEvent || loopWrapped || drift > DRIFT_THRESHOLD) {
      if (!isNewEvent && drift > DRIFT_THRESHOLD && canLog) {
        const filename = src.split("/").pop() ?? src;
        console.warn(`[uzuvid] drift correction: ${filename} at ${el.currentTime.toFixed(3)}s / ${dur.toFixed(3)}s (expected ${expected.toFixed(3)}s, drift ${drift.toFixed(3)}s) [speed ${speed}x, window-stable native mode, src: ${src}]`);
        el._lastLogTime = now;
      }
      el.currentTime = expected;
    }
  }
}

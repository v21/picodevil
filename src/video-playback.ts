import { setPlaybackRate, isNativeRate } from "./playback-rate";
import { computeSyncDistOffset } from "./sync-continuity";
import type { VideoEl } from "./video-element-state";
export type { VideoEl } from "./video-element-state";

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
  /** Distance offset in seconds for sync mode continuity (from computeSyncDistOffset). */
  distOffset?: number;
}

/** Compute loop length, handling inverted (wrap-around) ranges. */
export function computeLoopLen(loopStart: number, loopEnd: number, duration: number): number {
  if (loopStart > loopEnd) return duration - loopStart + loopEnd;
  return Math.abs(loopEnd - loopStart);
}

/** Compute expected video currentTime from pattern timing. Pure function. */
export function computeExpectedTime(p: ExpectedTimeParams): number {
  if (p.speed === 0) return p.loopStart;
  const elapsedSec = (p.currentCycle - p.eventBegin) / p.cps;
  // Inverted range (begin > end) means wrap through the video boundary:
  // e.g. begin=0.8, end=0.2 on a 10s video → play [8,10) then [0,2), loopLen=4
  const inverted = p.loopStart > p.loopEnd;
  const loopLen = computeLoopLen(p.loopStart, p.loopEnd, p.duration);
  if (loopLen <= 0) return p.loopStart;
  const dist = elapsedSec * Math.abs(p.speed) + (p.syncOffset ?? 0) + (p.distOffset ?? 0);
  const distInLoop = ((dist % loopLen) + loopLen) % loopLen; // always positive
  let pos: number;
  if (p.speed > 0) {
    pos = p.loopStart + distInLoop;
  } else {
    pos = p.loopEnd - distInLoop;
  }
  // Wrap through video boundary for inverted ranges
  if (inverted) {
    if (pos >= p.duration) pos -= p.duration;
    else if (pos < 0) pos += p.duration;
  }
  return pos;
}

/** Max allowed drift in seconds before we correct video position. */
export const DRIFT_THRESHOLD = 0.15;

/**
 * Convert a video position to loop-space offset (0 to loopLen).
 * For inverted ranges, accounts for the wrap through the video boundary.
 */
export function toLoopOffset(pos: number, loopStart: number, loopEnd: number, duration: number): number {
  if (loopStart > loopEnd) {
    return pos >= loopStart ? pos - loopStart : pos + (duration - loopStart);
  }
  return pos - loopStart;
}

/**
 * Detect whether a loop wrap occurred: expected jumped by ~loopLen in loop-space.
 * Works for both normal and inverted (wrap-around) ranges.
 */
export function detectLoopWrap(p: {
  expected: number;
  prevExpected: number | undefined;
  loopStart: number;
  loopEnd: number;
  loopLen: number;
  duration: number;
}): boolean {
  if (p.loopLen <= 0 || p.prevExpected == null) return false;
  const prevOff = toLoopOffset(p.prevExpected, p.loopStart, p.loopEnd, p.duration);
  const curOff = toLoopOffset(p.expected, p.loopStart, p.loopEnd, p.duration);
  return (prevOff - curOff) > p.loopLen / 2;
}

/**
 * Compute drift between actual and expected position, accounting for
 * loop wraps and video boundary wraps (inverted ranges).
 */
export function computeDrift(p: {
  currentTime: number;
  expected: number;
  loopStart: number;
  loopEnd: number;
  loopLen: number;
  duration: number;
}): number {
  const rawDrift = Math.abs(p.currentTime - p.expected);
  if (p.loopLen <= 0) return rawDrift;
  let drift = Math.min(rawDrift, Math.abs(rawDrift - p.loopLen));
  if (p.loopStart > p.loopEnd) {
    drift = Math.min(drift, Math.abs(p.duration - rawDrift));
  }
  return drift;
}

/**
 * Compute the effective playback rate from frame-to-frame position deltas.
 * Returns the rate (seconds/second) at which the expected position is moving.
 * Falls back to nominalSpeed when no previous frame exists or on loop wraps.
 */
export function computeEffectiveRate(p: {
  expected: number;
  prevExpected: number | undefined;
  wallDt: number;
  loopStart: number;
  loopEnd: number;
  loopLen: number;
  duration: number;
  nominalSpeed: number;
}): number {
  if (p.prevExpected == null || p.wallDt < 0.005) return p.nominalSpeed;
  // Use loop-space offsets to handle both normal and inverted ranges
  const curOff = toLoopOffset(p.expected, p.loopStart, p.loopEnd, p.duration);
  const prevOff = toLoopOffset(p.prevExpected, p.loopStart, p.loopEnd, p.duration);
  const rawDelta = curOff - prevOff;
  // Ignore loop-boundary wraps (delta jumps by ~loopLen)
  if (p.loopLen > 0 && Math.abs(rawDelta) >= p.loopLen / 2) return p.nominalSpeed;
  return rawDelta / p.wallDt;
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
    const loopLen = computeLoopLen(loopStart, loopEnd, dur);
    const syncOffset = c.ev.sync != null && c.ev.sync !== true ? Number(c.ev.sync) * dur : 0;
    const expected = computeExpectedTime({
      currentCycle: c.currentCycle, eventBegin: c.eventBegin, cps: c.cps || 0.5,
      speed, loopStart, loopEnd, duration: dur, syncOffset,
    });
    const prevExp = c.el._state.lastExpected;
    const jumped = prevExp != null && loopLen > 0 && (prevExp - expected) > loopLen / 2;
    const isNew = c.el._state.lastEventBegin !== c.eventBegin;
    if (jumped || isNew) {
      const src = (c.el._state.srcUrl ?? c.el.src).split("/").pop();
      console.log(`[DEBUG] ${src} seek: eventBegin=${c.eventBegin} begin=${beginVal} end=${endVal} speed=${speed.toFixed(3)} expected=${expected.toFixed(3)} ct=${c.el.currentTime.toFixed(3)} loopRange=[${loopStart.toFixed(1)},${loopEnd.toFixed(1)}] cycle=${c.currentCycle.toFixed(4)} isNew=${isNew} loopWrap=${jumped}`);
    }
  }

  const synced = c.ev.sync != null;
  const syncOffset = synced && c.ev.sync !== true ? Number(c.ev.sync) * c.el.duration : 0;
  updateVideoPlayback(c.el, speed, beginVal, endVal, c.currentCycle, c.eventBegin, c.cps, syncOffset, synced);
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
  synced: boolean = false,
): void {
  const dur = el.duration;
  const loopStart = beginVal * dur;
  const loopEnd = endVal * dur;
  const loopLen = computeLoopLen(loopStart, loopEnd, dur);

  // Detect event boundary: new event means force-seek to expected position
  const st = el._state;
  const isNewEvent = st.lastEventBegin !== eventBegin;
  if (isNewEvent) {
    st.lastEventBegin = eventBegin;
    // Reset rate tracking so a position jump from a new event doesn't look like a moving window
    st.lastExpected = undefined;
    st.lastExpectedWall = undefined;
    // Reset sync continuity state for fresh events
    st.lastSyncSpeed = undefined;
    st.lastSyncBegin = undefined;
    st.lastSyncEnd = undefined;
    st.syncDistOffset = 0;
  }

  // Sync continuity: recompute distance offset when speed/begin/end change
  if (synced && loopLen > 0) {
    const speedChanged = st.lastSyncSpeed != null && st.lastSyncSpeed !== speed;
    const beginChanged = st.lastSyncBegin != null && st.lastSyncBegin !== beginVal;
    const endChanged = st.lastSyncEnd != null && st.lastSyncEnd !== endVal;

    if (speedChanged || beginChanged || endChanged) {
      const elapsedSec = (currentCycle - eventBegin) / (cps || 0.5);
      const oldBeginSec = (st.lastSyncBegin ?? beginVal) * dur;
      const oldEndSec = (st.lastSyncEnd ?? endVal) * dur;
      st.syncDistOffset = computeSyncDistOffset({
        elapsedSec,
        oldSpeed: st.lastSyncSpeed ?? speed,
        newSpeed: speed,
        oldBegin: oldBeginSec,
        newBegin: loopStart,
        oldEnd: oldEndSec,
        newEnd: loopEnd,
        oldLoopLen: computeLoopLen(oldBeginSec, oldEndSec, dur),
        newLoopLen: loopLen,
        syncOffset,
        oldDistOffset: st.syncDistOffset,
        duration: dur,
      });
    }

    st.lastSyncSpeed = speed;
    st.lastSyncBegin = beginVal;
    st.lastSyncEnd = endVal;
  } else {
    // Not in sync mode — reset continuity tracking
    st.lastSyncSpeed = undefined;
    st.lastSyncBegin = undefined;
    st.lastSyncEnd = undefined;
    st.syncDistOffset = 0;
  }

  const distOffset = synced ? st.syncDistOffset : 0;
  const expected = computeExpectedTime({
    currentCycle, eventBegin, cps: cps || 0.5,
    speed, loopStart, loopEnd, duration: dur, syncOffset, distOffset,
  });

  const src = st.srcUrl ?? el.src;
  const now = Date.now();
  const canLog = (now - (st.lastLogTime ?? 0)) > 300;

  const prevExpected = st.lastExpected;
  const wallDt = st.lastExpectedWall != null ? (now - st.lastExpectedWall) / 1000 : 0;
  const effectiveRate = computeEffectiveRate({
    expected, prevExpected, wallDt,
    loopStart, loopEnd, loopLen, duration: dur,
    nominalSpeed: speed,
  });
  st.lastExpected = expected;
  st.lastExpectedWall = now;

  const rateIsNative = effectiveRate > 0 && isNativeRate(effectiveRate);

  if (!rateIsNative) {
    // Manual seek mode: negative rate, out of native range, or erratic
    // Don't guard on st.seeking — just set currentTime unconditionally.
    // With all-keyframe video this is smooth; with non-keyframe video the
    // browser seeks to the nearest keyframe (better than skipping frames).
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - expected) > 0.01) {
      el.currentTime = expected;
    }
  } else {
    // Native playback at effective rate
    if (el.paused) el.play().catch((e: DOMException) => { if (e.name !== "AbortError") throw e; });
    if (Math.abs(el.playbackRate - effectiveRate) > 0.01) setPlaybackRate(el, effectiveRate);
    const loopWrapped = detectLoopWrap({
      expected, prevExpected, loopStart, loopEnd, loopLen, duration: dur,
    });
    const drift = computeDrift({
      currentTime: el.currentTime, expected, loopStart, loopEnd, loopLen, duration: dur,
    });
    if (isNewEvent || loopWrapped || drift > DRIFT_THRESHOLD) {
      if (!isNewEvent && drift > DRIFT_THRESHOLD && canLog) {
        const filename = src.split("/").pop() ?? src;
        console.warn(`[uzuvid] drift correction: ${filename} at ${el.currentTime.toFixed(3)}s / ${dur.toFixed(3)}s (expected ${expected.toFixed(3)}s, drift ${drift.toFixed(3)}s) [effective rate ${effectiveRate.toFixed(2)}x, src: ${src}]`);
        st.lastLogTime = now;
      }
      el.currentTime = expected;
    }
  }
}

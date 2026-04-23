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
  /** Called each time a seek (el.currentTime assignment) is triggered. */
  onSeek?: () => void;
  /** Called specifically when a drift-correction seek is triggered. */
  onDriftSeek?: () => void;
  /**
   * Wall-clock time for this frame in milliseconds (e.g. the rAF timestamp).
   * When provided, wallDt is computed from this value so it's consistent with
   * the cycle computation (both derived from the same rAF clock tick). When
   * omitted, falls back to performance.now() — which is correct for tests where
   * there's no real rAF loop.
   */
  frameWallTime?: number;
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
  if (p.speed === 0) {
    const loopLen = computeLoopLen(p.loopStart, p.loopEnd, p.duration);
    if (loopLen <= 0) return p.loopStart;
    const dist = (p.syncOffset ?? 0) + (p.distOffset ?? 0);
    if (dist === 0) return p.loopStart;
    const distInLoop = ((dist % loopLen) + loopLen) % loopLen;
    return p.loopStart + distInLoop;
  }
  const elapsedSec = (p.currentCycle - p.eventBegin) / p.cps;
  // Inverted range (begin > end) means wrap through the video boundary:
  // e.g. begin=0.8, end=0.2 on a 10s video → play [8,10) then [0,2), loopLen=4
  const inverted = p.loopStart > p.loopEnd;
  const loopLen = computeLoopLen(p.loopStart, p.loopEnd, p.duration);
  if (loopLen <= 0) return p.loopStart;
  const dist = elapsedSec * Math.abs(p.speed) + (p.syncOffset ?? 0) + (p.distOffset ?? 0);
  const distInLoop = ((dist % loopLen) + loopLen) % loopLen; // always in [0, loopLen)
  let pos: number;
  if (p.speed > 0) {
    pos = p.loopStart + distInLoop;
  } else {
    pos = p.loopEnd - distInLoop;
  }
  // Floating point: loopStart + distInLoop can round up to loopEnd (or beyond)
  // even when distInLoop < loopLen. Wrap back to loopStart.
  if (inverted) {
    if (pos >= p.duration) pos -= p.duration;
    else if (pos < 0) pos += p.duration;
  } else {
    if (pos >= p.loopEnd) pos -= loopLen;
    if (pos < p.loopStart) pos += loopLen;
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
 * Uses raw position delta (not loop-space offsets) so it works even when
 * loop bounds change between frames (e.g. begin(saw) sweeping).
 * Falls back to nominalSpeed when no previous frame exists.
 */
export function computeEffectiveRate(p: {
  expected: number;
  prevExpected: number | undefined;
  wallDt: number;
  duration: number;
  nominalSpeed: number;
}): number {
  if (p.prevExpected == null || p.wallDt < 0.005) return p.nominalSpeed;
  let delta = p.expected - p.prevExpected;
  // Unwrap through video duration boundary (for inverted ranges or loop wraps)
  if (delta > p.duration / 2) delta -= p.duration;
  else if (delta < -p.duration / 2) delta += p.duration;
  return delta / p.wallDt;
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
  const rolling = c.ev.rolling != null;
  const syncOffset = synced && c.ev.sync !== true ? Number(c.ev.sync) * c.el.duration : 0;
  updateVideoPlayback(c.el, speed, beginVal, endVal, c.currentCycle, c.eventBegin, c.cps, syncOffset, synced, rolling, c.onSeek, c.onDriftSeek, c.frameWallTime);
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
  rolling: boolean = false,
  onSeek?: () => void,
  onDriftSeek?: () => void,
  frameWallTime?: number,
): void {
  const dur = el.duration;
  // Skip until the video has loaded enough to report a usable duration.
  // Proceeding with NaN/0 duration would produce NaN seeks (corrupting el.currentTime)
  // and consume the isNewEvent signal prematurely — so lastEventBegin stays undefined
  // until the first frame with a real duration, letting isNewEvent fire correctly then.
  if (!isFinite(dur) || dur <= 0) return;

  const loopStart = beginVal * dur;
  const loopEnd = endVal * dur;
  const loopLen = computeLoopLen(loopStart, loopEnd, dur);

  // Detect event boundary.
  // In sync/rolling mode, eventBegin is always 0, so isNewEvent only fires on the first
  // frame after a fresh video element is assigned from the pool (when lastEventBegin=undefined).
  // It is NOT "new cycle" — re-eval with the same element has lastEventBegin=0 already.
  const st = el._state;
  const isNewEvent = st.lastEventBegin !== eventBegin;
  if (isNewEvent) {
    st.lastEventBegin = eventBegin;
    // Reset rate tracking so a position jump from a new event doesn't look like a moving window
    st.lastExpected = undefined;
    st.lastExpectedWall = undefined;
    if (!rolling) {
      // Reset sync continuity state. For sync: re-syncs to clock on new element.
      // For non-rolling/non-sync: restarts from loopStart each event.
      st.lastSyncSpeed = undefined;
      st.lastSyncBegin = undefined;
      st.lastSyncEnd = undefined;
      st.syncDistOffset = 0;
    } else if (loopLen > 0 && isFinite(el.currentTime) && st.lastSyncOffset === syncOffset) {
      // Rolling: seed syncDistOffset from el.currentTime so computeExpectedTime
      // returns the actual current position on this first frame.
      // Only applies when syncOffset matches what this element was last playing at —
      // if syncOffset differs (e.g. syncStack reassigned to a different phase slot),
      // fall through to reset so the desired phase takes effect instead.
      // (speed-change detection won't run since lastSyncSpeed=undefined on a fresh element)
      const clampedTime = Math.max(loopStart, Math.min(loopEnd - 1e-9, el.currentTime));
      const targetDistInLoop = speed >= 0 ? clampedTime - loopStart : loopEnd - clampedTime;
      const elapsedSec = (currentCycle - eventBegin) / (cps || 0.5);
      const baseDist = speed !== 0 ? elapsedSec * Math.abs(speed) + syncOffset : syncOffset;
      st.syncDistOffset = speed !== 0
        ? targetDistInLoop - (((baseDist % loopLen) + loopLen) % loopLen)
        : targetDistInLoop - syncOffset;
    } else {
      // syncOffset changed or no valid currentTime — reset like non-rolling sync
      // so the desired phase initialises correctly.
      st.lastSyncSpeed = undefined;
      st.lastSyncBegin = undefined;
      st.lastSyncEnd = undefined;
      st.syncDistOffset = 0;
    }
    st.lastSyncOffset = syncOffset;
  }

  // Recovery: if a rolling+synced element's syncOffset has changed since its last frame
  // (most commonly because duration was NaN on the first frame, making syncOffset=NaN,
  // and duration is now available), reset and seek to the correct phase.
  // Uses isFinite(syncOffset) to skip the NaN-to-NaN case (NaN !== NaN in JS).
  let needsReseek = false;
  if (!isNewEvent && rolling && synced && loopLen > 0 && isFinite(syncOffset) && st.lastSyncOffset !== syncOffset) {
    st.lastSyncSpeed = undefined;
    st.lastSyncBegin = undefined;
    st.lastSyncEnd = undefined;
    st.syncDistOffset = 0;
    st.lastSyncOffset = syncOffset;
    needsReseek = true;
  }

  // Sync/rolling continuity: recompute distance offset when speed/begin/end change
  if ((synced || rolling) && loopLen > 0) {
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
        rolling,
      });
    }

    st.lastSyncSpeed = speed;
    st.lastSyncBegin = beginVal;
    st.lastSyncEnd = endVal;
  } else {
    // Not in sync/rolling mode — reset continuity tracking
    st.lastSyncSpeed = undefined;
    st.lastSyncBegin = undefined;
    st.lastSyncEnd = undefined;
    st.syncDistOffset = 0;
  }

  const distOffset = (synced || rolling) ? st.syncDistOffset : 0;
  const expected = computeExpectedTime({
    currentCycle, eventBegin, cps: cps || 0.5,
    speed, loopStart, loopEnd, duration: dur, syncOffset, distOffset,
  });

  const now = frameWallTime ?? performance.now();
  const prevExpected = st.lastExpected;
  const wallDt = st.lastExpectedWall != null ? (now - st.lastExpectedWall) / 1000 : 0;
  const effectiveRate = computeEffectiveRate({
    expected, prevExpected, wallDt, duration: dur, nominalSpeed: speed,
  });
  st.lastExpected = expected;
  st.lastExpectedWall = now;
  const rateIsNative = effectiveRate > 0 && isNativeRate(effectiveRate);

  if (rateIsNative) {
    // Native playback at the effective rate (which may differ from nominal speed
    // when begin/end are dynamic, e.g. begin(saw) produces effective rate ~5)
    if (el.paused) el.play().catch((e: DOMException) => { if (e.name !== "AbortError") throw e; });
    if (Math.abs(el.playbackRate - effectiveRate) > 0.01) setPlaybackRate(el, effectiveRate);
    const loopWrapped = detectLoopWrap({
      expected, prevExpected, loopStart, loopEnd, loopLen, duration: dur,
    });
    if (rolling) {
      // Rolling: position is stateful — only seek on fresh element assignment (isNewEvent)
      // or genuine loop-boundary wrap (needed for custom begin/end ranges).
      // Never drift-correct: rolling means "let it play freely", and drift seeks cause
      // visible judder. The video's native playback handles timing; we only intervene
      // at boundaries.
      if (isNewEvent || loopWrapped || needsReseek) {
        el.currentTime = expected;
        if (onSeek) onSeek();
      }
    } else {
      const drift = computeDrift({
        currentTime: el.currentTime, expected, loopStart, loopEnd, loopLen, duration: dur,
      });
      if (isNewEvent || loopWrapped || drift > DRIFT_THRESHOLD) {
        el.currentTime = expected;
        if (onSeek) onSeek();
        if (drift > DRIFT_THRESHOLD && !isNewEvent && !loopWrapped && onDriftSeek) onDriftSeek();
      }
    }
  } else {
    // Non-native rate: pause and seek to computed position
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - expected) > 0.01) {
      el.currentTime = expected;
      if (onSeek) onSeek();
    }
  }
}

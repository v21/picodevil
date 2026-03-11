import { VIDEO_BASE } from "./config";
import { setPlaybackRate, isNativeRate } from "./playback-rate";
import { parseTimeValue, resolveTime, type TimeValue } from "./time-value";
import { drawFit } from "./draw-fit";

export type VideoEl = HTMLVideoElement & { _seeking?: boolean; _srcUrl?: string };

export interface VideoFrameContext {
  ev: any;
  videoPool: Map<string, VideoEl>;
  poolKeyPrefix: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  now: number;
  dt: number;
  currentCycle: number;
  eventBegin: number;
  cps: number;
  lastVideoVal: string | null;
  getOrCreateVideoEl: (name: string, base: string, keyPrefix: string, targetTime?: number) => VideoEl;
  /** Per-frame map for sharing video elements across identical draws. */
  frameShareMap: Map<string, VideoEl>;
}

export interface VideoFrameResult {
  lastVideoVal: string | null;
}

/** Parse a raw start/end value (string, number, or TimeValue) into a TimeValue. */
function toTimeValue(raw: any): TimeValue {
  if (raw == null) return { value: 0, unit: "rel" };
  if (typeof raw === "bigint") return { value: Number(raw), unit: "rel" };
  if (typeof raw === "object" && "unit" in raw) return raw;
  const n = Number(raw);
  if (!isNaN(n)) return { value: n, unit: "rel" };
  return parseTimeValue(String(raw));
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

export function renderVideoFrame(c: VideoFrameContext): VideoFrameResult {
  let lastVideoVal = c.lastVideoVal;
  const src = c.ev.src;
  const speed = c.ev.speed != null ? Number(c.ev.speed) : 1;
  const startRaw = c.ev.start;
  const endRaw = c.ev.end;
  const endIsDuration = c.ev.endIsDuration ?? false;

  const videoKey = `${src}|${speed}|${Number(startRaw)}|${Number(endRaw)}|${endIsDuration}`;
  if (videoKey !== lastVideoVal) {
    lastVideoVal = videoKey;
  }

  const base = c.ev.urlBase ?? VIDEO_BASE;

  // Share key: identical video+timing can reuse one element for drawing
  const shareKey = `${base}${src}|${speed}|${Number(startRaw)}|${Number(endRaw)}|${endIsDuration}|${c.eventBegin}`;
  const shared = c.frameShareMap.get(shareKey);

  let el: VideoEl;
  if (shared) {
    // Reuse already-configured element — just draw, no new pool entry needed
    el = shared;
  } else {
    // Compute a rough target time for pool selection
    const elapsedSec = (c.currentCycle - c.eventBegin) / (c.cps || 0.5);
    const roughTarget = speed === 0 ? 0 : Math.abs(elapsedSec * speed);

    el = c.getOrCreateVideoEl(src, base, c.poolKeyPrefix, roughTarget);

    if (el && isFinite(el.duration) && el.duration > 0) {
      const startTV = startRaw != null ? toTimeValue(startRaw) : { value: 0, unit: "rel" as const };
      const endTV = endRaw != null ? toTimeValue(endRaw) : { value: 1, unit: "rel" as const };
      updateVideoPlayback(el, speed, startTV, endTV, endIsDuration, c.currentCycle, c.eventBegin, c.cps);
    }

    c.frameShareMap.set(shareKey, el);
  }

  if (el && el.videoWidth > 0) {
    const fitMode = c.ev.fit ?? "cover";
    drawFit(c.ctx, el, el.videoWidth, el.videoHeight, c.canvas.width, c.canvas.height, fitMode);
  }

  return { lastVideoVal };
}

function updateVideoPlayback(
  el: VideoEl,
  speed: number,
  start: TimeValue,
  endTV: TimeValue,
  endIsDuration: boolean,
  currentCycle: number,
  eventBegin: number,
  cps: number,
): void {
  const dur = el.duration;
  const loopStart = resolveTime(start, dur);
  const resolvedEnd = resolveTime(endTV, dur);
  const loopEnd = endIsDuration ? loopStart + resolvedEnd : resolvedEnd;

  const expected = computeExpectedTime({
    currentCycle, eventBegin, cps: cps || 0.5,
    speed, loopStart, loopEnd, duration: dur,
  });

  if (speed < 0 || !isNativeRate(speed)) {
    // Non-native rate: pause and seek to computed position
    if (!el.paused) el.pause();
    if (!el._seeking && Math.abs(el.currentTime - expected) > 0.01) {
      el.currentTime = expected;
    }
  } else {
    // Native rate: let browser play, correct drift
    if (el.paused) el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
    if (el.playbackRate !== speed) setPlaybackRate(el, speed);
    const drift = Math.abs(el.currentTime - expected);
    if (drift > DRIFT_THRESHOLD) {
      el.currentTime = expected;
    }
  }
}

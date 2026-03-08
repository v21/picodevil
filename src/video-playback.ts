import { REVERSE_SEEK_INTERVAL, VIDEO_BASE } from "./config";
import { setPlaybackRate, isNativeRate } from "./playback-rate";
import { parseTimeValue, resolveTime, type TimeValue } from "./time-value";
import { drawFit } from "./draw-fit";

export type VideoEl = HTMLVideoElement & { _reverseAcc?: number; _seeking?: boolean; _srcUrl?: string };

export interface VideoFrameContext {
  ev: any;
  videoPool: Map<string, VideoEl>;
  poolKeyPrefix: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  now: number;
  dt: number;
  lastVideoVal: string | null;
  getOrCreateVideoEl: (name: string, base: string, keyPrefix: string) => VideoEl;
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
  const el = c.getOrCreateVideoEl(src, base, c.poolKeyPrefix);

  if (el && isFinite(el.duration) && el.duration > 0) {
    const startTV = startRaw != null ? toTimeValue(startRaw) : { value: 0, unit: "rel" as const };
    const endTV = endRaw != null ? toTimeValue(endRaw) : { value: 1, unit: "rel" as const };
    updateVideoPlayback(el, speed, startTV, endTV, endIsDuration, c.now, c.dt);
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
  now: number,
  dt: number,
): void {
  const dur = el.duration;
  const loopStart = resolveTime(start, dur);
  const resolvedEnd = resolveTime(endTV, dur);
  const loopEnd = endIsDuration ? loopStart + resolvedEnd : resolvedEnd;
  const wrapped = loopStart > loopEnd;

  function inRange(t: number): boolean {
    if (wrapped) return t >= loopStart || t <= loopEnd;
    return t >= loopStart && t <= loopEnd;
  }

  function wrapForward(t: number): number {
    if (wrapped) {
      if (t >= dur) return t - dur;
      if (t > loopEnd && t < loopStart) return loopStart;
    } else {
      if (t >= loopEnd) return loopStart + (t - loopEnd);
    }
    return t;
  }

  function wrapBackward(t: number): number {
    if (wrapped) {
      if (t < 0) return dur + t;
      if (t > loopEnd && t < loopStart) return loopEnd;
    } else {
      if (t <= loopStart) return loopEnd - (loopStart - t);
    }
    return t;
  }

  if (speed < 0 || !isNativeRate(speed)) {
    if (!el.paused) el.pause();
    if (!el._reverseAcc) el._reverseAcc = 0;
    el._reverseAcc += dt;

    let target = el.currentTime;
    let needsSeek = false;

    if (speed === 0) {
      if (target !== loopStart) {
        target = loopStart;
        needsSeek = true;
      }
    } else if (!inRange(target)) {
      target = speed < 0 ? loopEnd : loopStart;
      needsSeek = true;
      el._reverseAcc = 0;
    } else if (el._reverseAcc >= REVERSE_SEEK_INTERVAL) {
      const seekDelta = (el._reverseAcc / 1000) * Math.abs(speed);
      if (speed < 0) {
        target = wrapBackward(target - seekDelta);
      } else {
        target = wrapForward(target + seekDelta);
      }
      needsSeek = true;
      el._reverseAcc = 0;
    }

    if (needsSeek && !el._seeking) el.currentTime = target;
  } else {
    el._reverseAcc = 0;
    if (el.paused) el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
    if (el.playbackRate !== speed) setPlaybackRate(el, speed);
    if (!inRange(el.currentTime)) {
      el.currentTime = loopStart;
    }
    if (wrapped && el.currentTime >= dur - 0.05) {
      el.currentTime = 0;
    }
    if (!wrapped && el.currentTime >= loopEnd) {
      el.currentTime = loopStart;
    }
  }
}

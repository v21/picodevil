import { REVERSE_SEEK_INTERVAL, VIDEO_BASE } from "./config";
import { setPlaybackRate, isNativeRate } from "./playback-rate";
import { resolveTime } from "./time-value";
import { drawFit } from "./draw-fit";
import type { VideoPattern, VideoValue } from "./video-pattern";

type VideoEl = HTMLVideoElement & { _reverseAcc?: number; _seeking?: boolean };

export interface VideoFrameContext {
  ev: VideoValue;
  videoPattern: VideoPattern;
  videoPool: Map<string, VideoEl>;
  poolKeyPrefix: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  now: number;
  dt: number;
  lastVideoVal: string | null;
}

export interface VideoFrameResult {
  lastVideoVal: string | null;
}

export function renderVideoFrame(c: VideoFrameContext): VideoFrameResult {
  let lastVideoVal = c.lastVideoVal;
  const { src, speed, start, end: endTV, endIsDuration } = c.ev;
  const videoKey = JSON.stringify({ src, speed, start, end: endTV, endIsDuration });
  if (videoKey !== lastVideoVal) {
    lastVideoVal = videoKey;
  }
  const base = c.videoPattern.videoUrlBase ?? VIDEO_BASE;
  const el = c.videoPool.get(c.poolKeyPrefix + base + src);
  if (el && isFinite(el.duration) && el.duration > 0) {
    updateVideoPlayback(el, speed, start, endTV, endIsDuration, c.now, c.dt);
  }
  if (el && el.videoWidth > 0) {
    drawFit(c.ctx, el, el.videoWidth, el.videoHeight, c.canvas.width, c.canvas.height, c.videoPattern.fitMode);
  }

  return { lastVideoVal };
}

function updateVideoPlayback(
  el: VideoEl,
  speed: number,
  start: { value: number; unit: string },
  endTV: { value: number; unit: string },
  endIsDuration: boolean,
  now: number,
  dt: number,
): void {
  const dur = el.duration;
  const loopStart = resolveTime(start as any, dur);
  const resolvedEnd = resolveTime(endTV as any, dur);
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

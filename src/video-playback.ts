import { REVERSE_SEEK_INTERVAL } from "./config";
import { setPlaybackRate, isNativeRate } from "./playback-rate";
import { resolveTime } from "./time-value";
import type { VideoPattern, VideoValue } from "./video-pattern";

type VideoEl = HTMLVideoElement & { _reverseAcc?: number; _seeking?: boolean };

export interface VideoFrameContext {
  videoPattern: VideoPattern | null;
  videoPool: Map<string, VideoEl>;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  now: number;
  dt: number;
  cyclePos: number;
  cycleNum: number;
  lastVideoVal: string | null;
}

export interface VideoFrameResult {
  lastVideoVal: string | null;
}

export function renderVideoFrame(c: VideoFrameContext): VideoFrameResult {
  if (!c.videoPattern) return { lastVideoVal: c.lastVideoVal };

  let lastVideoVal = c.lastVideoVal;
  const vidEvents = c.videoPattern.queryArc(c.cycleNum + c.cyclePos, c.cycleNum + c.cyclePos + 0.001);

  for (const ev of vidEvents) {
    const { src, speed, start, end: endTV, endIsDuration } = ev.value as VideoValue;
    const videoKey = JSON.stringify({ src, speed, start, end: endTV, endIsDuration });
    if (videoKey !== lastVideoVal) {
      lastVideoVal = videoKey;
    }
    const el = c.videoPool.get(src);
    if (el && isFinite(el.duration) && el.duration > 0) {
      updateVideoPlayback(el, speed, start, endTV, endIsDuration, c.now, c.dt);
    }
    if (el && el.videoWidth > 0) {
      drawVideoCover(c.ctx, el, c.canvas.width, c.canvas.height);
    }
    break;
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

function drawVideoCover(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement,
  cw: number,
  ch: number,
): void {
  const vw = el.videoWidth;
  const vh = el.videoHeight;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(el, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

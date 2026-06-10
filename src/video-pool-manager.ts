import { type VideoEl, createVideoState, resetVideoState } from "./video-element-state";
import { scoreFreeElement } from "./video-pool";

export interface VideoPoolManagerConfig {
  /** Factory to create bare HTMLVideoElement. Default: () => document.createElement("video") */
  createElement?: () => HTMLVideoElement;
  /** Resolve a media name+base to a full URL. */
  resolveMediaUrl: (name: string, base: string) => string;
  /** Called when a video's duration is discovered from loadedmetadata. */
  onDurationDiscovered?: (srcUrl: string, duration: number) => void;
  /**
   * Called when an element is permanently torn down (pool eviction), so the
   * renderer can free its cached GPU texture. Without this the texture leaks.
   */
  onDestroyElement?: (el: VideoEl) => void;
  /** Max idle elements total across all srcs. Default: 16 */
  maxFreeTotal?: number;
}

export interface VideoPoolManager {
  /**
   * Take the best-matching idle video element for `srcUrl` from the free pool.
   * Returns null if the free pool has no elements for this src.
   * Caller is responsible for setting the element active and calling freeVideoEl when done.
   */
  takeFromFreePool(srcUrl: string, targetTime?: number): VideoEl | null;
  freeVideoEl(el: VideoEl): void;
  clearVideos(activeEls: VideoEl[]): void;
  makeVideoEl(name: string): VideoEl;
  destroyVideoEl(el: VideoEl): void;
  trimFreePool(): void;
  resolveMediaUrl(name: string, base: string): string;

  readonly freeVideoPool: Map<string, VideoEl[]>;
  readonly videoDurations: Map<string, number>;
}

export function createVideoPoolManager(config: VideoPoolManagerConfig): VideoPoolManager {
  const MAX_FREE_TOTAL = config.maxFreeTotal ?? 64;
  const createEl = config.createElement ?? (() => document.createElement("video"));
  const resolve = config.resolveMediaUrl;
  const onDuration = config.onDurationDiscovered;

  const freeVideoPool = new Map<string, VideoEl[]>();
  const videoDurations = new Map<string, number>();

  function destroyVideoEl(el: VideoEl) {
    el.pause();
    el.removeAttribute("src");
    el.load();
    // Free the element's cached GPU texture — this is the only point where an
    // element is permanently discarded, so it's where the renderer must release it.
    config.onDestroyElement?.(el);
  }

  function trimFreePool() {
    let total = 0;
    for (const list of freeVideoPool.values()) total += list.length;
    if (total <= MAX_FREE_TOTAL) return;
    for (const [src, list] of freeVideoPool) {
      while (list.length > 0 && total > MAX_FREE_TOTAL) {
        destroyVideoEl(list.pop()!);
        total--;
      }
      if (list.length === 0) freeVideoPool.delete(src);
      if (total <= MAX_FREE_TOTAL) break;
    }
  }

  function freeVideoEl(el: VideoEl) {
    el.pause();
    // Released to the pool: it's no longer committed to a slot, so the matcher should score
    // it on its real currentTime, not a stale target. (See VideoElementState.desiredTime.)
    el._state.desiredTime = undefined;
    const srcUrl = el._state.srcUrl ?? el.src;
    const freeList = freeVideoPool.get(srcUrl) ?? [];
    freeList.push(el);
    freeVideoPool.set(srcUrl, freeList);
    trimFreePool();
  }

  function makeVideoEl(name: string): VideoEl {
    const el = createEl() as unknown as VideoEl;
    el._state = createVideoState();
    el.loop = false;
    el.muted = true;
    el.playsInline = true;
    el.addEventListener("loadeddata", () => console.log("video loaded:", name));
    el.addEventListener("loadedmetadata", () => {
      if (el._state.srcUrl && isFinite(el.duration) && el.duration > 0) {
        videoDurations.set(el._state.srcUrl, el.duration);
        onDuration?.(el._state.srcUrl, el.duration);
      }
    });
    el.addEventListener("seeking", () => { el._state.seeking = true; });
    el.addEventListener("seeked", () => { el._state.seeking = false; });
    return el;
  }

  /**
   * Take the best-matching idle video element for `srcUrl` from the free pool.
   * Returns null if nothing is available. The caller must set the element active
   * and call freeVideoEl when done.
   */
  function takeFromFreePool(srcUrl: string, targetTime?: number): VideoEl | null {
    const freeList = freeVideoPool.get(srcUrl);
    if (!freeList || freeList.length === 0) return null;

    let bestIdx = freeList.length - 1;
    if (targetTime != null && freeList.length > 1) {
      let bestScore = Infinity;
      for (let i = 0; i < freeList.length; i++) {
        const el = freeList[i];
        const dur = isFinite(el.duration) ? el.duration : 0;
        const score = scoreFreeElement(el.currentTime, targetTime, dur);
        if (score < bestScore) { bestScore = score; bestIdx = i; }
      }
    }

    const el = freeList.splice(bestIdx, 1)[0];
    if (freeList.length === 0) freeVideoPool.delete(srcUrl);
    resetVideoState(el._state);
    el._state.srcUrl = srcUrl;
    el.playbackRate = 1;
    return el;
  }

  function clearVideos(activeEls: VideoEl[]) {
    for (const el of activeEls) freeVideoEl(el);
  }

  return {
    takeFromFreePool,
    freeVideoEl,
    clearVideos,
    makeVideoEl,
    destroyVideoEl,
    trimFreePool,
    resolveMediaUrl: resolve,
    freeVideoPool,
    videoDurations,
  };
}

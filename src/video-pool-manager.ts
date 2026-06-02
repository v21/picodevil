import { type VideoEl, createVideoState, resetVideoState } from "./video-element-state";
import { scoreFreeElement } from "./video-pool";

export interface VideoPoolManagerConfig {
  /** Factory to create bare HTMLVideoElement. Default: () => document.createElement("video") */
  createElement?: () => HTMLVideoElement;
  /** Resolve a media name+base to a full URL. */
  resolveMediaUrl: (name: string, base: string) => string;
  /** Called when a video's duration is discovered from loadedmetadata. */
  onDurationDiscovered?: (srcUrl: string, duration: number) => void;
  /** Max idle elements total across all srcs. Default: 16 */
  maxFreeTotal?: number;
  /** Max total blob memory in bytes. Oldest evicted when exceeded. Default: 2 GB. */
  maxBlobBytes?: number;
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
  fetchVideoBlob(srcUrl: string): void;
  evictOldestBlobs(): void;
  getBlobUrl(srcUrl: string): string | undefined;
  resolveMediaUrl(name: string, base: string): string;

  readonly freeVideoPool: Map<string, VideoEl[]>;
  readonly videoBlobUrls: Map<string, string>;
  readonly videoBlobSizes: Map<string, number>;
  readonly videoDurations: Map<string, number>;
}

export function createVideoPoolManager(config: VideoPoolManagerConfig): VideoPoolManager {
  const MAX_FREE_TOTAL = config.maxFreeTotal ?? 64;
  const MAX_BLOB_BYTES = config.maxBlobBytes ?? 2 * 1024 * 1024 * 1024;
  const createEl = config.createElement ?? (() => document.createElement("video"));
  const resolve = config.resolveMediaUrl;
  const onDuration = config.onDurationDiscovered;

  const freeVideoPool = new Map<string, VideoEl[]>();
  const videoBlobUrls = new Map<string, string>();
  const videoBlobSizes = new Map<string, number>(); // srcUrl → bytes
  const videoBlobPending = new Map<string, Promise<void>>();
  const videoDurations = new Map<string, number>();

  function destroyVideoEl(el: VideoEl) {
    el.pause();
    el.removeAttribute("src");
    el.load();
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

  function evictOldestBlobs() {
    let total = 0;
    for (const s of videoBlobSizes.values()) total += s;
    while (total > MAX_BLOB_BYTES && videoBlobUrls.size > 0) {
      const oldest = videoBlobUrls.keys().next().value!;
      URL.revokeObjectURL(videoBlobUrls.get(oldest)!);
      total -= videoBlobSizes.get(oldest) ?? 0;
      videoBlobUrls.delete(oldest);
      videoBlobSizes.delete(oldest);
    }
  }

  function fetchVideoBlob(srcUrl: string): void {
    if (videoBlobUrls.has(srcUrl) || videoBlobPending.has(srcUrl)) return;
    const p = fetch(srcUrl)
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        videoBlobUrls.set(srcUrl, blobUrl);
        videoBlobSizes.set(srcUrl, blob.size);
        videoBlobPending.delete(srcUrl);
        evictOldestBlobs();
      })
      .catch(e => {
        videoBlobPending.delete(srcUrl);
        console.error("video blob fetch failed:", srcUrl, e);
      });
    videoBlobPending.set(srcUrl, p);
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

  function getBlobUrl(srcUrl: string): string | undefined {
    const url = videoBlobUrls.get(srcUrl);
    if (url !== undefined) {
      // Touch for LRU: delete and re-insert moves entry to Map tail
      videoBlobUrls.delete(srcUrl);
      videoBlobUrls.set(srcUrl, url);
    }
    return url;
  }

  return {
    takeFromFreePool,
    freeVideoEl,
    clearVideos,
    makeVideoEl,
    destroyVideoEl,
    trimFreePool,
    fetchVideoBlob,
    evictOldestBlobs,
    getBlobUrl,
    resolveMediaUrl: resolve,
    freeVideoPool,
    videoBlobUrls,
    videoBlobSizes,
    videoDurations,
  };
}

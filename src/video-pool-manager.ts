import { type VideoEl, createVideoState, resetVideoState } from "./video-element-state";
import { scoreFreeElement } from "./video-pool";

export interface VideoPoolManagerConfig {
  /** Factory to create bare HTMLVideoElement. Default: () => document.createElement("video") */
  createElement?: () => HTMLVideoElement;
  /** Resolve a media name+base to a full URL. */
  resolveMediaUrl: (name: string, base: string) => string;
  /** Called when a video's duration is discovered from loadedmetadata. */
  onDurationDiscovered?: (srcUrl: string, duration: number) => void;
  /** Max idle elements per unique src URL. Default: 2 */
  maxFreePerSrc?: number;
  /** Max idle elements total. Default: 8 */
  maxFreeTotal?: number;
  /** Max blob cache entries. Oldest evicted when exceeded. Default: 20 */
  maxBlobEntries?: number;
}

export interface VideoPoolManager {
  getVideoEl(name: string, base: string, poolKey: string, targetTime?: number, autoPlay?: boolean): VideoEl;
  freeVideoEl(el: VideoEl): void;
  clearVideos(): void;
  makeVideoEl(name: string): VideoEl;
  destroyVideoEl(el: VideoEl): void;
  trimFreePool(): void;
  fetchVideoBlob(srcUrl: string): void;
  evictOldestBlobs(): void;
  resolveMediaUrl(name: string, base: string): string;

  readonly videoPool: Map<string, VideoEl>;
  readonly freeVideoPool: Map<string, VideoEl[]>;
  readonly videoBlobUrls: Map<string, string>;
  readonly videoDurations: Map<string, number>;
}

export function createVideoPoolManager(config: VideoPoolManagerConfig): VideoPoolManager {
  const MAX_FREE_PER_SRC = config.maxFreePerSrc ?? 2;
  const MAX_FREE_TOTAL = config.maxFreeTotal ?? 8;
  const MAX_BLOB_ENTRIES = config.maxBlobEntries ?? 20;
  const createEl = config.createElement ?? (() => document.createElement("video"));
  const resolve = config.resolveMediaUrl;
  const onDuration = config.onDurationDiscovered;

  const videoPool = new Map<string, VideoEl>();
  const freeVideoPool = new Map<string, VideoEl[]>();
  const videoBlobUrls = new Map<string, string>();
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
    const srcUrl = el._state.srcUrl ?? el.src;
    const freeList = freeVideoPool.get(srcUrl) ?? [];
    if (freeList.length >= MAX_FREE_PER_SRC) {
      destroyVideoEl(el);
      return;
    }
    freeList.push(el);
    freeVideoPool.set(srcUrl, freeList);
    trimFreePool();
  }

  function evictOldestBlobs() {
    while (videoBlobUrls.size > MAX_BLOB_ENTRIES) {
      const oldest = videoBlobUrls.keys().next().value!;
      const blobUrl = videoBlobUrls.get(oldest)!;
      URL.revokeObjectURL(blobUrl);
      videoBlobUrls.delete(oldest);
    }
  }

  function fetchVideoBlob(srcUrl: string): void {
    if (videoBlobUrls.has(srcUrl) || videoBlobPending.has(srcUrl)) return;
    const p = fetch(srcUrl)
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        videoBlobUrls.set(srcUrl, blobUrl);
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

  function getVideoEl(name: string, base: string, poolKey: string, targetTime?: number, autoPlay: boolean = true): VideoEl {
    const srcUrl = resolve(name, base);

    // Reuse an idle element with the same src, preferring one nearest the target time
    const freeList = freeVideoPool.get(srcUrl);
    if (freeList && freeList.length > 0) {
      let bestIdx = freeList.length - 1;
      if (targetTime != null && freeList.length > 1) {
        let bestScore = Infinity;
        for (let i = 0; i < freeList.length; i++) {
          const el = freeList[i];
          const dur = isFinite(el.duration) ? el.duration : 0;
          const score = scoreFreeElement(el.currentTime, targetTime, dur);
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
      }
      const el = freeList.splice(bestIdx, 1)[0];
      if (freeList.length === 0) freeVideoPool.delete(srcUrl);
      resetVideoState(el._state);
      el._state.srcUrl = srcUrl;
      el.playbackRate = 1;
      if (autoPlay) el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
      videoPool.set(poolKey, el);
      return el;
    }

    // Create new element; use blob URL if cached, otherwise stream directly + background blob fetch
    const el = makeVideoEl(name);
    el._state.srcUrl = srcUrl;
    const blobUrl = videoBlobUrls.get(srcUrl);
    el.src = blobUrl ?? srcUrl;
    if (!blobUrl) fetchVideoBlob(srcUrl);
    if (autoPlay) el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
    videoPool.set(poolKey, el);
    return el;
  }

  function clearVideos() {
    for (const el of videoPool.values()) freeVideoEl(el);
    videoPool.clear();
  }

  return {
    getVideoEl,
    freeVideoEl,
    clearVideos,
    makeVideoEl,
    destroyVideoEl,
    trimFreePool,
    fetchVideoBlob,
    evictOldestBlobs,
    resolveMediaUrl: resolve,
    videoPool,
    freeVideoPool,
    videoBlobUrls,
    videoDurations,
  };
}

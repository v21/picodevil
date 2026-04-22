import { scoreFreeElement } from "./video-pool";
import { createVideoState, type VideoEl } from "./video-element-state";
import type { NeededSource } from "./source-query";

/** Free pool: maps srcUrl → available elements (video or image). */
export type FreePool = Map<string, Array<VideoEl | HTMLImageElement>>;

/** Result of matching one NeededSource to an element. */
export interface Assignment {
  needed: NeededSource;
  el: VideoEl | HTMLImageElement;
  /** true when the element was freshly created (not taken from free pool). */
  isNew: boolean;
}

/**
 * Greedily match each NeededSource to the best available element from the free pool,
 * or create a new element if none is available.
 *
 * The free pool is mutated in place: matched entries are removed; unmatched entries
 * remain so the caller can return them to the pool or destroy them.
 *
 * @param needed         Sources needed this frame (from queryNeeded).
 * @param freePool       Available idle elements keyed by srcUrl. Mutated in place.
 * @param durations      Cached video durations, keyed by srcUrl.
 * @param frameDt        Seconds elapsed since the last frame (used for forward prediction).
 * @param makeVideoEl    Optional factory for creating new video elements. Defaults to
 *                       document.createElement("video"). Pass pool.makeVideoEl to get
 *                       duration-discovery and seeking listeners wired up.
 */
export function matchSources(
  needed: NeededSource[],
  freePool: FreePool,
  durations: Map<string, number>,
  frameDt: number,
  makeVideoEl?: (name: string) => VideoEl,
): Assignment[] {
  const assignments: Assignment[] = [];

  for (const ns of needed) {
    const candidates = freePool.get(ns.srcUrl);

    if (!candidates || candidates.length === 0) {
      // Nothing available — create fresh element
      assignments.push({ needed: ns, el: createFreshElement(ns, makeVideoEl), isNew: true });
      continue;
    }

    if (ns.kind === "image") {
      // Images have no playback state — take from the front
      const el = candidates.splice(0, 1)[0];
      if (candidates.length === 0) freePool.delete(ns.srcUrl);
      assignments.push({ needed: ns, el, isNew: false });
      continue;
    }

    // Video: score each candidate and pick the best
    if (ns.expectedTime === null) {
      // Rolling: any element for this src is fine.
      // Take from the FRONT because the renderer prepends previously-active elements
      // there. Reusing the previously-active element preserves its _state (lastEventBegin=0),
      // preventing a spurious isNewEvent=true → seek on the next frame.
      const el = candidates.splice(0, 1)[0];
      if (candidates.length === 0) freePool.delete(ns.srcUrl);
      assignments.push({ needed: ns, el, isNew: false });
      continue;
    }

    const dur = durations.get(ns.srcUrl) ?? 0;
    let bestIdx = candidates.length - 1;
    let bestScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] as VideoEl;
      // Predict where the element will be at render time
      const predictedTime = c.currentTime + (c._state?.lastSyncSpeed ?? 1) * frameDt;
      const score = dur > 0
        ? scoreFreeElement(predictedTime, ns.expectedTime, dur)
        : Math.abs(predictedTime - ns.expectedTime);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const el = candidates.splice(bestIdx, 1)[0];
    if (candidates.length === 0) freePool.delete(ns.srcUrl);
    assignments.push({ needed: ns, el, isNew: false });
  }

  return assignments;
}

/** Create a fresh element for a NeededSource. */
function createFreshElement(
  ns: NeededSource,
  makeVideoEl?: (name: string) => VideoEl,
): VideoEl | HTMLImageElement {
  if (ns.kind === "image") {
    const img = new Image();
    img.src = ns.srcUrl;
    return img;
  }
  // Video: use provided factory (for duration-discovery listeners), or fall back to bare createElement
  if (makeVideoEl) {
    const el = makeVideoEl(ns.srcUrl);
    el._state.srcUrl = ns.srcUrl;
    return el;
  }
  const el = document.createElement("video") as unknown as VideoEl;
  el._state = createVideoState();
  el._state.srcUrl = ns.srcUrl;
  el.loop = false;
  el.muted = true;
  el.playsInline = true;
  return el;
}

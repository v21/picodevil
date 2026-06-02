import { scoreFreeElement } from "./video-pool";
import { createVideoState, type VideoEl } from "./video-element-state";
import type { NeededSource } from "./source-query";
import { minCostAssignment } from "./assignment";
import { SEEK_PENALTY, NEW_ELEMENT_COST } from "./config";
import { DRIFT_THRESHOLD } from "./video-playback";

/** Tiny per-id perturbation to break exact cost ties deterministically (lower id wins). */
const ID_EPS = 1e-9;

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
 * Match each NeededSource to a free-pool element (or a fresh one), minimising the number of
 * *seeks* on drawn elements. Matching decomposes per srcUrl. Within a source, images and rolling
 * videos front-take (no scoring); the remaining non-rolling videos are solved as one minimum-cost
 * assignment whose cost makes any seek dominate any seek distance (see SEEK_PENALTY) — so elements
 * already tracking a slot lock in for free and only genuinely-displaced playheads (e.g. a loop
 * wrap) move. This avoids the greedy cascade where assigning an early slot to its locally-closest
 * element shoves still-tracking neighbours into needless seeks.
 *
 * The free pool is mutated in place: matched entries are removed; unmatched entries remain so the
 * caller can return them to the pool or destroy them. Assignments are returned in `needed` order.
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
  const result = new Map<NeededSource, Assignment>();

  // Group by source — candidates only ever come from the same srcUrl, so each source is an
  // independent (small) assignment problem.
  const bySrc = new Map<string, NeededSource[]>();
  for (const ns of needed) {
    const list = bySrc.get(ns.srcUrl);
    if (list) list.push(ns); else bySrc.set(ns.srcUrl, [ns]);
  }

  for (const [srcUrl, group] of bySrc) {
    const candidates = freePool.get(srcUrl);
    const scored: NeededSource[] = [];

    // Front-take images and rolling videos (no playback target to score against).
    for (const ns of group) {
      if (ns.kind === "image" || ns.expectedTime === null) {
        if (candidates && candidates.length > 0) {
          result.set(ns, { needed: ns, el: candidates.splice(0, 1)[0], isNew: false });
        } else {
          result.set(ns, { needed: ns, el: createFreshElement(ns, makeVideoEl), isNew: true });
        }
      } else {
        scored.push(ns);
      }
    }

    // Optimal (minimum-seek) assignment for the remaining non-rolling videos.
    if (scored.length > 0) {
      assignOptimal(scored, candidates ?? [], durations.get(srcUrl) ?? 0, frameDt, makeVideoEl, result);
    }

    if (candidates && candidates.length === 0) freePool.delete(srcUrl);
  }

  return needed.map(ns => result.get(ns)!);
}

/**
 * Solve one source's non-rolling-video assignment. `cands` is the (mutated) free-pool array for
 * the source; taken elements are spliced out. Rows = needed slots; columns = real candidates plus
 * one "spawn fresh" virtual column per row.
 */
function assignOptimal(
  scored: NeededSource[],
  cands: Array<VideoEl | HTMLImageElement>,
  dur: number,
  frameDt: number,
  makeVideoEl: ((name: string) => VideoEl) | undefined,
  result: Map<NeededSource, Assignment>,
): void {
  const R = scored.length;
  const K = cands.length;
  const C = K + R; // K real candidates + R virtual "new element" columns

  const cost: number[][] = new Array(R);
  for (let r = 0; r < R; r++) {
    const target = scored[r].expectedTime as number;
    const row = new Array<number>(C);
    for (let c = 0; c < K; c++) row[c] = candidateCost(cands[c] as VideoEl, target, dur, frameDt);
    for (let c = K; c < C; c++) row[c] = NEW_ELEMENT_COST;
    cost[r] = row;
  }

  const assign = minCostAssignment(cost); // length R; assign[r] ∈ [0, C)
  const taken: number[] = [];
  for (let r = 0; r < R; r++) {
    const col = assign[r];
    if (col < K) {
      result.set(scored[r], { needed: scored[r], el: cands[col], isNew: false });
      taken.push(col);
    } else {
      result.set(scored[r], { needed: scored[r], el: createFreshElement(scored[r], makeVideoEl), isNew: true });
    }
  }
  // Remove taken candidates from the pool array (descending so earlier indices stay valid).
  taken.sort((a, b) => b - a);
  for (const idx of taken) cands.splice(idx, 1);
}

/**
 * Cost of assigning a candidate element to a slot. A candidate that can reach the slot by natural
 * playback (no seek) costs only its distance; one that must seek costs SEEK_PENALTY on top — so
 * the global optimum minimises the seek count. Distance uses the committed `desiredTime` (the
 * storm fix: a mid-seek element's decoded currentTime is stranded, so scoring on it would reshuffle
 * the binding); the no-seek test uses the real currentTime, since that is what renderVideoFrame's
 * drift check actually keys on. A tiny id term breaks exact ties deterministically.
 */
function candidateCost(c: VideoEl, target: number, dur: number, frameDt: number): number {
  const st = c._state;
  const speed = st?.lastSyncSpeed ?? 1;
  const actual = c.currentTime + speed * frameDt;
  // No NEW seek is needed if the element is already at the slot (its real position is within drift)
  // OR it is already committed to this slot and converging on it (desiredTime within drift). The
  // latter is essential: a committed element still mid-seek toward its own slot must not be charged
  // SEEK_PENALTY, or a surplus free element coincidentally parked near the slot would out-score and
  // evict it — churning the active set every frame.
  const desired = st?.desiredTime;
  const noSeek = withinDrift(actual, target, dur)
    || (desired != null && withinDrift(desired, target, dur));
  const basePos = desired ?? c.currentTime;
  const predicted = basePos + speed * frameDt;
  const dist = dur > 0
    ? scoreFreeElement(predicted, target, dur)
    : Math.abs(predicted - target);
  return (noSeek ? dist : SEEK_PENALTY + dist) + (st?.id ?? 0) * ID_EPS;
}

/** True if `pos` is within the drift threshold of `target`, accounting for the video-boundary wrap. */
function withinDrift(pos: number, target: number, dur: number): boolean {
  let d = Math.abs(pos - target);
  if (dur > 0) d = Math.min(d, Math.abs(d - dur));
  return d < DRIFT_THRESHOLD;
}

/** Create a fresh element for a NeededSource. */
function createFreshElement(
  ns: NeededSource,
  makeVideoEl?: (name: string) => VideoEl,
): VideoEl | HTMLImageElement {
  if (ns.kind === "image") {
    const img = new Image();
    img.crossOrigin = "anonymous";
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

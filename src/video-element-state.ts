/** Playback tracking state for a video element. Stored as `el._state`. */
export interface VideoElementState {
  /** Stable debug id, assigned at creation. For instrumentation only. */
  id: number;
  seeking: boolean;
  srcUrl: string | undefined;
  /** Debug: reason for the most recent seek (instrumentation only). */
  lastSeekReason?: string;
  lastEventBegin: number | undefined;
  lastExpected: number | undefined;
  lastExpectedWall: number | undefined;
  seekStartTime: number | undefined;
  lastLogTime: number | undefined;
  /** Sync continuity: last speed seen while in sync mode. */
  lastSyncSpeed: number | undefined;
  /** Sync continuity: last begin value (fraction) while in sync mode. */
  lastSyncBegin: number | undefined;
  /** Sync continuity: last end value (fraction) while in sync mode. */
  lastSyncEnd: number | undefined;
  /** Sync continuity: distance offset (seconds) to maintain playhead position across changes. */
  syncDistOffset: number;
  /**
   * The slot this element is committed to, as `NeededSource.expectedTime` — set by the renderer
   * right after assignment, cleared (undefined) when the element is returned to the free pool.
   *
   * Why it exists: `el.currentTime = x` is an *async* seek that doesn't land within a frame. When
   * several same-source playheads (e.g. `begin().syncStack()`) sit close together, the element
   * matcher — which scores candidates by position — would read each element's *stranded* mid-seek
   * `currentTime`, reshuffle the element→slot binding every frame, and trigger a nonnative seek
   * storm (nothing ever settles). Scoring a committed element on `desiredTime` instead pins it to
   * the slot it already holds (it scores ~0 against its own slot), so the binding stays stable and
   * each element settles into native playback. Uncommitted pool elements (desiredTime undefined)
   * still match on their real `currentTime` for normal seek-cost reuse.
   *
   * Critically, this must be `NeededSource.expectedTime` (the "pure" expected position the matcher
   * scores against), NOT the `expected` computed inside `renderVideoFrame`: the latter folds in the
   * element's per-element `syncDistOffset`, putting it in a different reference frame than the slot
   * positions the matcher compares against — which silently breaks the match.
   *
   * It is a distinct field rather than reusing `lastExpected` because the lifecycles differ:
   * `lastExpected` is owned by the velocity detector (reset on new event, never cleared on free,
   * and carries the distOffset), so a pooled element keeps a stale value that would corrupt
   * matching. `desiredTime`'s set-on-commit / clear-on-release lifecycle is the signal the matcher
   * needs. Rolling sources are excluded: they have expectedTime=null (bypass scored matching) and
   * play freely, so their real `currentTime` is the position to match on.
   */
  desiredTime: number | undefined;
}

/** Default values for all tracking fields except srcUrl. Single source of truth. */
function defaultTrackingFields() {
  return {
    seeking: false,
    lastEventBegin: undefined as number | undefined,
    lastExpected: undefined as number | undefined,
    lastExpectedWall: undefined as number | undefined,
    seekStartTime: undefined as number | undefined,
    lastLogTime: undefined as number | undefined,
    lastSyncSpeed: undefined as number | undefined,
    lastSyncBegin: undefined as number | undefined,
    lastSyncEnd: undefined as number | undefined,
    syncDistOffset: 0,
    desiredTime: undefined as number | undefined,
  };
}

let _dbgIdCounter = 0;

/** Create a fresh state object with all tracking fields at their defaults. */
export function createVideoState(): VideoElementState {
  return { id: _dbgIdCounter++, srcUrl: undefined, ...defaultTrackingFields() };
}

/** Reset all tracking fields so the element behaves as "new" when recycled.
 * Note: srcUrl is NOT reset — it's set explicitly by the caller after reset. */
export function resetVideoState(s: VideoElementState): void {
  Object.assign(s, defaultTrackingFields());
}

export type VideoEl = HTMLVideoElement & { _state: VideoElementState };

/** Playback tracking state for a video element. Stored as `el._state`. */
export interface VideoElementState {
  seeking: boolean;
  srcUrl: string | undefined;
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
  };
}

/** Create a fresh state object with all tracking fields at their defaults. */
export function createVideoState(): VideoElementState {
  return { srcUrl: undefined, ...defaultTrackingFields() };
}

/** Reset all tracking fields so the element behaves as "new" when recycled.
 * Note: srcUrl is NOT reset — it's set explicitly by the caller after reset. */
export function resetVideoState(s: VideoElementState): void {
  Object.assign(s, defaultTrackingFields());
}

export type VideoEl = HTMLVideoElement & { _state: VideoElementState };

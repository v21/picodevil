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

/** Create a fresh state object with all tracking fields undefined. */
export function createVideoState(): VideoElementState {
  return {
    seeking: false,
    srcUrl: undefined,
    lastEventBegin: undefined,
    lastExpected: undefined,
    lastExpectedWall: undefined,
    seekStartTime: undefined,
    lastLogTime: undefined,
    lastSyncSpeed: undefined,
    lastSyncBegin: undefined,
    lastSyncEnd: undefined,
    syncDistOffset: 0,
  };
}

/** Reset all tracking fields so the element behaves as "new" when recycled. */
export function resetVideoState(s: VideoElementState): void {
  s.seeking = false;
  s.lastEventBegin = undefined;
  s.lastExpected = undefined;
  s.lastExpectedWall = undefined;
  s.seekStartTime = undefined;
  s.lastLogTime = undefined;
  s.lastSyncSpeed = undefined;
  s.lastSyncBegin = undefined;
  s.lastSyncEnd = undefined;
  s.syncDistOffset = 0;
  // Note: srcUrl is NOT reset here — it's set explicitly by the caller after reset.
}

export type VideoEl = HTMLVideoElement & { _state: VideoElementState };

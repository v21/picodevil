import { VIDEO_BASE, IMAGE_BASE } from "./config";
import { eventBeginFromHap } from "./event-begin";
import { computeExpectedFromEvent } from "./video-pool";
import { warn } from "./warnings";

/** A single media source needed for the current frame (or lookahead frame). */
export interface NeededSource {
  kind: "video" | "image";
  /** Fully resolved URL. */
  srcUrl: string;
  /**
   * Expected playback position in seconds.
   * null for rolling sources (stateful; the matcher will assign based on current element state).
   * 0 for images (no playback).
   */
  expectedTime: number | null;
  /** Playback speed. 0 for images; 1 for sync videos by default. */
  speed: number;
  /** Original event value from the pattern. */
  ev: any;
  /** Original hap, needed for eventBeginFromHap. */
  hap: any;
}

/** A single resolved pattern event, before deduplication. */
export interface FrameEvent {
  screenIndex: number;
  eventIndex: number;
  ev: any;
  hap: any;
}

/** Result of queryNeeded. */
export interface QueryResult {
  needed: NeededSource[];
  /** Maps each NeededSource to the FrameEvents that share it. */
  eventMap: Map<NeededSource, FrameEvent[]>;
  /**
   * All valid frame events in draw order, including colors and streams
   * (which are not represented in `needed` but still need to be rendered).
   */
  allEvents: FrameEvent[];
}

/**
 * Distance threshold (seconds) below which two video events are considered
 * close enough to share a single media element within a frame.
 */
const SHARE_TIME_THRESHOLD = 0.04;

type Screen = { queryArc(begin: number, end: number): any[] };

/**
 * Query all screens at cycle position `t` and compute the list of media sources
 * needed for this frame. Deduplicates events that share the same source (same URL,
 * speed, and expected playhead position within SHARE_TIME_THRESHOLD).
 *
 * Colors are excluded — they have no element lifecycle and are handled by TextureCache.
 * Streams are excluded — they are managed separately by getStreamVideoEl.
 *
 * @param screens        Active screen patterns to query.
 * @param t              Current cycle position.
 * @param cps            Cycles per second (for expected-time computation).
 * @param durations      Cached video durations, keyed by resolved srcUrl.
 * @param resolveMediaUrl Resolve a media name + base URL to a full URL (e.g. via media registry).
 *                        Defaults to simple concatenation if omitted.
 */
export function queryNeeded(
  screens: Screen[],
  t: number,
  cps: number,
  durations: Map<string, number>,
  resolveMediaUrl?: (name: string, base: string) => string,
): QueryResult {
  const needed: NeededSource[] = [];
  const eventMap = new Map<NeededSource, FrameEvent[]>();
  const allEvents: FrameEvent[] = [];

  for (let si = 0; si < screens.length; si++) {
    let events: any[];
    try {
      events = screens[si].queryArc(t, t);
      if (!events || !Array.isArray(events)) continue;
    } catch (e) {
      warn(`queryNeeded: screen ${si} queryArc failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    for (let ei = 0; ei < events.length; ei++) {
      const hap = events[ei];
      const ev = hap?.value;
      if (ev == null || typeof ev !== "object") continue;
      if (!ev._type) continue;

      const fe: FrameEvent = { screenIndex: si, eventIndex: ei, ev, hap };
      allEvents.push(fe);

      const type = ev._type;
      if (type !== "video" && type !== "image") continue; // color/stream: in allEvents only

      const ns = resolveNeededSource(ev, hap, t, cps, durations, resolveMediaUrl);

      // Try to share with an existing NeededSource
      const existing = findShareable(needed, ns);
      if (existing) {
        eventMap.get(existing)!.push(fe);
      } else {
        needed.push(ns);
        eventMap.set(ns, [fe]);
      }
    }
  }

  return { needed, eventMap, allEvents };
}

/** Resolve one event into a NeededSource (before deduplication). */
function resolveNeededSource(
  ev: any,
  hap: any,
  t: number,
  cps: number,
  durations: Map<string, number>,
  resolveMediaUrl?: (name: string, base: string) => string,
): NeededSource {
  const resolve = resolveMediaUrl ?? resolveUrl;
  const isImage = ev._type === "image";

  if (isImage) {
    const base = ev.urlBase ?? IMAGE_BASE;
    const srcUrl = resolve(ev.src, base);
    return { kind: "image", srcUrl, expectedTime: 0, speed: 0, ev, hap };
  }

  // video
  const base = ev.urlBase ?? VIDEO_BASE;
  const srcUrl = resolve(ev.src, base);
  const speed = ev.speed != null ? Number(ev.speed) : 1;
  const isRolling = ev.rolling != null;

  let expectedTime: number | null = null;
  if (!isRolling) {
    const cachedDur = durations.get(srcUrl);
    const eventBegin = eventBeginFromHap(ev, hap, t);
    expectedTime = computeExpectedFromEvent(ev, t, eventBegin, cps, cachedDur);
  }

  return { kind: "video", srcUrl, expectedTime, speed, ev, hap };
}

/** Resolve a media name + base URL to a full URL. */
function resolveUrl(name: string, base: string): string {
  if (!name) return base;
  if (/^(https?:|blob:|data:)/.test(name)) return name;
  return base + name;
}

/**
 * Find an existing NeededSource that is close enough to share with the candidate.
 * Two sources share if they have the same kind, srcUrl, speed, and expected time
 * within SHARE_TIME_THRESHOLD. Rolling sources (expectedTime=null) share only with
 * other rolling entries of the same src+speed.
 */
function findShareable(
  existing: NeededSource[],
  candidate: NeededSource,
): NeededSource | undefined {
  for (const ns of existing) {
    if (ns.kind !== candidate.kind) continue;
    if (ns.srcUrl !== candidate.srcUrl) continue;
    if (ns.speed !== candidate.speed) continue;
    // Both rolling → share
    if (ns.expectedTime === null && candidate.expectedTime === null) return ns;
    // One rolling, one not → don't share
    if (ns.expectedTime === null || candidate.expectedTime === null) continue;
    // Both sync: share if close enough
    if (Math.abs(ns.expectedTime - candidate.expectedTime) < SHARE_TIME_THRESHOLD) return ns;
  }
  return undefined;
}
